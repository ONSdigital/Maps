// Add a config option to enable debug output for map logic
// config.debugInfo = true; // Set to true to enable debug output in the console
import { drawKeyScale } from "./legend.js";

const CHANGE_DISPLAY_KEY_MAP = {
    valueFormat: 'changeFormat',
    valuePrefix: 'changePrefix',
    valueSuffix: 'changeSuffix',
    legendFormat: 'changeLegendFormat',
    legendPrefix: 'changeLegendPrefix',
    legendSuffix: 'changeLegendSuffix'
};

/**
 * Fetches data from a URL and detects if it is GeoJSON, TopoJSON, or general JSON.
 * It also handles the vector tile (.pbf) case.
 *
 * @param {string | null} url The URL of the geographic data source.
 * @returns {Promise<"geojson" | "topojson" | "json" | "vector" | "error: fetch failed" | "error: parse failed" | "error: invalid url">}
 */
export async function detectGeographySource(url) {
    if (!url) {
        return "error: invalid url";
    }

    if (url.endsWith('.pbf')) {
        return "vector"; // Mapbox Vector Tile format
    }

    let data;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        data = await response.json();
    } catch (e) {
        if (e.message.includes('HTTP error')) {
            console.error(`Fetch failed for ${url}:`, e.message);
            return "error: fetch failed";
        }
        console.error(`Failed to parse JSON for ${url}:`, e.message);
        return "error: parse failed";
    }

    if (typeof data !== 'object' || data === null || !data.type) {
        return "json"; // Default if not a recognized structure or simply plain JSON
    }

    if (data.type === "Topology" && Array.isArray(data.arcs)) {
        return "topojson";
    }

    const geoJsonTypes = new Set([
        "FeatureCollection", "Feature", "Point", "MultiPoint",
        "LineString", "MultiLineString", "Polygon", "MultiPolygon",
        "GeometryCollection"
    ]);

    if (geoJsonTypes.has(data.type)) {
        return "geojson";
    }

    return "json";
}

const __UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/;

function normalizePostcode(input) {
    if (input === null || typeof input === 'undefined') return '';
    return String(input)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function isLikelyUkPostcode(input) {
    const normalized = normalizePostcode(input);
    return __UK_POSTCODE_RE.test(normalized);
}

// Function to get postcode list from postcodes.io autocomplete
export async function fetchPostcodes(query) {
    const q = (query === null || typeof query === 'undefined') ? '' : String(query).trim();
    if (!q) return [];
    const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(q)}/autocomplete`;
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const json = await response.json();
        return json && Array.isArray(json.result) ? json.result : [];
    } catch (e) {
        // Silent failure (network/CSP) - suggestions are optional.
        return [];
    }
}

export function getElementHeightById(id) {
    const element = document.getElementById(id);
    return element ? element.getBoundingClientRect().height : 0;
}

/**
 * Sets the value of the autocomplete input and updates its state.
 * @param {string} value - The text to set.
 */
export async function setSearchText(value) {
    const searchBox = document.getElementById('search-box');
    if (searchBox) {
        // Avoid focusing the input here: on mobile/narrow layouts this can
        // expand the autocomplete dropdown and obscure the map after a map click.
        searchBox.value = value || "";
        // Ensure any UI that depends on input value (e.g. clear button) updates
        searchBox.dispatchEvent(new Event('input', { bubbles: true }));
        searchBox.dispatchEvent(new Event('change', { bubbles: true }));

        if (document.activeElement === searchBox) searchBox.blur();

        // Force-close the accessible-autocomplete menu if it is open.
        forceHideSearchMenuUntilUserInteracts();
    }
}

function forceHideSearchMenuUntilUserInteracts() {
    const input = document.getElementById('search-box');
    if (!input) return;

    const hide = () => {
        const menu = document.querySelector('#search-container .autocomplete__menu');
        const listbox = document.getElementById('search-box__listbox');
        input.setAttribute('aria-expanded', 'false');
        if (menu) menu.style.display = 'none';
        if (listbox) listbox.style.display = 'none';
    };

    const unhide = () => {
        const menu = document.querySelector('#search-container .autocomplete__menu');
        const listbox = document.getElementById('search-box__listbox');
        if (menu) menu.style.display = '';
        if (listbox) listbox.style.display = '';
    };

    hide();

    // Re-enable on next real user interaction with the input.
    // (Use once listeners so we don't accumulate handlers.)
    input.addEventListener('focus', unhide, { once: true });
    input.addEventListener('input', unhide, { once: true });
    input.addEventListener('keydown', unhide, { once: true });
}

// Sleep function. Used to synchronise actions
const sleep = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

// Simple point-in-polygon test (ray casting)
export function pointInPolygon(point, vs) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0], yi = vs[i][1];
        const xj = vs[j][0], yj = vs[j][1];
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

export function yearFilter(props, year) {
    if (!props.start && !props.end) return true;
    if (!props.start && props.end) return year <= props.end;
    if (props.start && !props.end) return year >= props.start;
    return year >= props.start && year <= props.end;
}

export function collectCoords(geometry) {
    let allCoords = [];
    function collect(geom) {
        if (geom.type === 'Polygon') {
            allCoords.push(...geom.coordinates[0]);
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(poly => {
                allCoords.push(...poly[0]);
            });
        }
    }
    collect(geometry);
    return allCoords;
}

export function calculateBounds(coords) {
    if (!coords.length) return null;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    for (const coord of coords) {
        if (!Array.isArray(coord) || coord.length < 2) continue;
        const lon = coord[0];
        const lat = coord[1];
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }

    if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
    return [[minLon, minLat], [maxLon, maxLat]];
}

export function boundsContain(outer, inner) {
    if (!Array.isArray(outer) || !Array.isArray(inner)) return false;
    if (!outer[0] || !outer[1] || !inner[0] || !inner[1]) return false;
    return outer[0][0] <= inner[0][0]
        && outer[0][1] <= inner[0][1]
        && outer[1][0] >= inner[1][0]
        && outer[1][1] >= inner[1][1];
}

export function calculateBoundsFromGeojson(areas) {
    if (!areas) return null;
    let allCoords = [];

    if (areas.type === 'FeatureCollection' && Array.isArray(areas.features)) {
        areas.features.forEach(feature => {
            if (!feature || !feature.geometry) return;
            allCoords.push(...collectCoords(feature.geometry));
        });
    } else if (areas.type === 'Feature' && areas.geometry) {
        allCoords = collectCoords(areas.geometry);
    } else if (areas.type) {
        allCoords = collectCoords(areas);
    }

    if (!allCoords.length) return null;
    return calculateBounds(allCoords);
}

export function resolveAutoMapBounds(config, areas, geographySource) {
    if (!config || typeof config.mapBounds !== 'string') return;
    if (config.mapBounds.toLowerCase() !== 'auto') return;

    if (geographySource === 'vector') {
        if (config.debugInfo) {
            console.warn("[Map Debug] mapBounds 'auto' is only supported for GeoJSON/TopoJSON sources. Falling back to maxBounds.");
        }
        if (Array.isArray(config.maxBounds)) {
            config.mapBounds = config.maxBounds;
        }
        return;
    }

    const autoBounds = calculateBoundsFromGeojson(areas);
    if (autoBounds) {
        config.mapBounds = autoBounds;
        config.__autoMapBounds = autoBounds;
        if (config.debugInfo) {
            console.log('[Map Debug] mapBounds auto resolved to:', autoBounds);
        }
        if (Array.isArray(config.maxBounds) && !boundsContain(config.maxBounds, autoBounds)) {
            if (config.debugInfo) {
                console.warn("[Map Debug] mapBounds 'auto' exceeds maxBounds; map view may be constrained.");
            }
        }
    } else if (config.debugInfo) {
        console.warn("[Map Debug] mapBounds 'auto' could not be resolved from the provided geography.");
    }
}


export function calculateZoomPadding(map, padPercent = 0.3) {
    const mapCanvas = map.getContainer();
    const mapWidth = mapCanvas.offsetWidth;
    const mapHeight = mapCanvas.offsetHeight;
    const padX = Math.round(mapWidth * padPercent);
    const padY = Math.round(mapHeight * padPercent);
    return { top: padY, bottom: padY, left: padX, right: padX };
}

export function getLegendDecimals(format) {
    const match = format && format.match(/\.([0-9]+)/);
    return match ? parseInt(match[1], 10) : 0;
}

export function validateBreaksArray(breaks, label = 'breaks') {
    if (!Array.isArray(breaks)) {
        console.error(`[Map Config] Invalid ${label}: expected an array of numbers (e.g. [0, 10, 20]). Got:`, breaks);
        return false;
    }
    if (breaks.length < 2) {
        console.error(`[Map Config] Invalid ${label}: expected at least 2 break values. Got:`, breaks);
        return false;
    }

    for (let i = 0; i < breaks.length; i++) {
        const v = breaks[i];
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            console.error(
                `[Map Config] Invalid ${label}: all breaks must be finite numbers. ` +
                `Found ${JSON.stringify(v)} (type: ${typeof v}) at index ${i}. ` +
                `Remove quotation marks if you used strings. Full value:`,
                breaks
            );
            return false;
        }
        if (i > 0 && !(breaks[i] > breaks[i - 1])) {
            console.error(
                `[Map Config] Invalid ${label}: breaks must be strictly increasing. ` +
                `Found ${breaks[i - 1]} then ${breaks[i]} at index ${i}. Full value:`,
                breaks
            );
            return false;
        }
    }
    return true;
}

export function getBreaks(config, data, palette, state) {
    const debug = config.debugInfo === true;
    const dataValues = data.map(d => state.selectedValueColumn ? +d[state.selectedValueColumn] : +d.value).filter(v => !isNaN(v)).sort(d3.ascending);

    const selectedIndex = (() => {
        if (!state) return 0;
        if (typeof state.selectedValueColumn === 'number') return state.selectedValueColumn;
        if (Array.isArray(state.valueColumns) && state.selectedValueColumn) {
            const idx = state.valueColumns.indexOf(state.selectedValueColumn);
            return idx >= 0 ? idx : 0;
        }
        return 0;
    })();

    const breaksNumberForDataset = (() => {
        if (Array.isArray(config.breaksNumber)) {
            const v = config.breaksNumber[selectedIndex];
            if (typeof v === 'number' && v > 1) return v;
            const fallback = config.breaksNumber[0];
            return (typeof fallback === 'number' && fallback > 1) ? fallback : undefined;
        }
        return (typeof config.breaksNumber === 'number' && config.breaksNumber > 1) ? config.breaksNumber : undefined;
    })();

    if (Array.isArray(config.breaks)) {
        const selectedBreaks = config.breaks[selectedIndex] ?? config.breaks[0];

        if (Array.isArray(selectedBreaks)) {
            // Case 1: The element at the index is the custom break array (e.g., [0, 10, 20])
            if (debug) {
                console.log(`[Map Debug] Using custom breaks for dataset index ${selectedIndex}:`, selectedBreaks);
            }

            if (!validateBreaksArray(selectedBreaks, `config.breaks[${selectedIndex}]`)) {
                return null;
            }
            return selectedBreaks;
        } else if (typeof selectedBreaks === 'string') {
            // Case 2: The element at the index is a break calculation method (e.g., "jenks")
            // Use config.breaksNumber if palette is not an array or not suitable
            let n;
            if (Array.isArray(palette) && palette.length > 1) {
                n = palette.length;
	        } else if (typeof breaksNumberForDataset === 'number') {
	            n = breaksNumberForDataset;
            } else {
                n = 5;
            }
            const calculated = calculateBreaks(dataValues, selectedBreaks, n);
            if (debug) {
				console.log(`[Map Debug] Calculated breaks for dataset index ${selectedIndex} using method '${selectedBreaks}' and n=${n}:`, calculated);
            }
            return calculated;
        } else {
            if (debug) console.log("[Map Debug] Unexpected format for breaks", selectedBreaks);
        }
    } else {
        // Handle the string case (e.g., "jenks", "equal")
        let n;
        if (Array.isArray(palette) && palette.length > 1) {
            n = palette.length;
	    } else if (typeof breaksNumberForDataset === 'number') {
	        n = breaksNumberForDataset;
        } else {
            n = 5;
        }
        const calculated = calculateBreaks(dataValues, config.breaks, n);
        if (debug) {
            console.log(`[Map Debug] Calculated breaks using method '${config.breaks}' and n=${n}:`, calculated);
        }
        return calculated;
    }
}

/**
 * Calculate class breaks for a threshold scale.
 *
 * Breaks are *data-space* numbers.
 * Formatting (e.g. `legendFormat: ",.0%"`) is for display only and should not change
 * the numeric breakpoints used by the scale.
 */
export function calculateBreaks(values, method, numClasses) {
    if (method === 'equal') {
        const min = d3.min(values), max = d3.max(values);
        return Array.from({ length: numClasses + 1 }, (_, i) => {
            const val = min + i * (max - min) / numClasses;
            return val;
        });
    } else if (method === 'jenks' && typeof ss !== 'undefined') {
        const sorted = values.filter(v => !isNaN(v)).sort(d3.ascending);
        let clusters = ss.ckmeans(sorted, numClasses);
        let breaks = [];
        clusters.forEach((cluster, i) => {
            if (i < numClasses - 1) {
                breaks.push(cluster[0]);
            } else {
                breaks.push(cluster[0]);
                breaks.push(cluster[cluster.length - 1]);
            }
        });
        return breaks;
    }
    return null;
}

export function setupSearch(areas, config, state, rateById, areaById) {
    // Pym renderCallback can fire repeatedly on resize.
    // Search UI (DOM + document-level key handlers) must only be wired once.
    if (document.getElementById('search-container')) {
        if (state) state.__onsSearchWired = true;
        return;
    }
    if (state && state.__onsSearchWired) return;

    const { areaNames = [], areaNameToCode = {}, areaCodeToFeature = {} } = setupAreaSearchIndex(areas) || {};

    addSearchBox(areaNames, state)
    if (state) state.__onsSearchWired = true;

    function setupAreaSearchIndex(areas) {
        if (!areas || !areas.features) return {};
        if (!areas.features.length) return {};
        const firstProps = areas.features[0].properties;
        if (!(config.geoIdField in firstProps) || !(config.geoNameField in firstProps)) {
            console.error(`Mismatched geoIdField ('${config.geoIdField}') or geoNameField ('${config.geoNameField}') in config. Available keys:`, Object.keys(firstProps));
            return;
        }

        return buildAreaLookups(areas.features, config.geoIdField, config.geoNameField)
    }

    function buildAreaLookups(features, geoIdField, geoNameField) {
        let areaNames = [];
        let areaNameToCode = {};
        let areaCodeToFeature = {};

        features.forEach(f => {
            const code = f.properties[geoIdField];
            const name = f.properties[geoNameField];
            areaNames.push(name);
            areaNameToCode[name.toLowerCase()] = code;
            areaCodeToFeature[code] = f;
        });

        areaNames.sort((a, b) => a.localeCompare(b));
        return { areaNames, areaNameToCode, areaCodeToFeature };
    }

    function addSearchBox(areaNames, state) {
        const searchBoxId = 'search-box';
        const searchStyleId = 'ons-map-search-clear-styles';
        const mapWrapper = document.getElementById('mapwrapper') || document.body;
        const searchDiv = document.createElement('div');
        const searchLabel = document.createElement('label');
        searchLabel.className = "visuallyhidden";
        searchLabel.htmlFor = searchBoxId;
        searchLabel.innerHTML = "Select an area";
        searchDiv.id = 'search-container';

        // Provide a positioned wrapper so we can place an "x" clear button inside the input
        searchDiv.classList.add('ons-autocomplete');

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'autocomplete__input-wrapper';
        searchDiv.appendChild(inputWrapper);

        // Inline error message (replaces modal alerts)
        const errorEl = document.createElement('div');
        errorEl.className = 'autocomplete__error hidden';
        errorEl.setAttribute('role', 'status');
        errorEl.setAttribute('aria-live', 'polite');
        searchDiv.appendChild(errorEl);

        let searchInputEl = null;
        const setSearchError = (message) => {
            const msg = (message === null || typeof message === 'undefined') ? '' : String(message);
            if (!msg) {
                clearSearchError();
                return;
            }
            errorEl.textContent = msg;
            errorEl.classList.remove('hidden');
            if (searchInputEl) {
                searchInputEl.setAttribute('aria-invalid', 'true');
            }
        };

        const clearSearchError = () => {
            errorEl.textContent = '';
            errorEl.classList.add('hidden');
            if (searchInputEl) {
                searchInputEl.removeAttribute('aria-invalid');
            }
        };

        // Will be wired up once the input exists
        let toggleClearButton = null;

        // Used to prevent the menu popping open as a side-effect of programmatic changes
        // (e.g. setSearchText from map click, then clearing via the x button)
        let suppressSuggestionsUntil = 0;

        const suppressSuggestions = (ms = 300) => {
            suppressSuggestionsUntil = Date.now() + ms;
        };

        const suggestionsSuppressed = () => Date.now() < suppressSuggestionsUntil;

        const closeListboxTemporarily = (ms = 250) => {
            const listbox = document.getElementById(`${searchBoxId}__listbox`);
            if (!listbox) return;
            listbox.style.display = 'none';
            listbox.style.visibility = 'hidden';
            setTimeout(() => {
                listbox.style.display = '';
                listbox.style.visibility = 'visible';
            }, ms);
        };

        const ensureSearchStyles = () => {
            if (document.getElementById(searchStyleId)) return;
            const styleEl = document.createElement('style');
            styleEl.id = searchStyleId;
            styleEl.textContent = `
                #search-container { width: 100%; }
                #search-container .autocomplete__wrapper { width: 100%; flex: 1 1 auto; }
                #search-container .autocomplete__input { width: 100% !important; box-sizing: border-box; padding-right: 30px; }
                #search-container .autocomplete__hint { pointer-events: none; }
                #search-container .autocomplete__input-wrapper { position: relative; display: flex; width: 100%; }
                #search-container .autocomplete__error { margin-top: 4px; font-size: 0.875em; }
                #search-container .autocomplete__error.hidden { display: none; }
                #search-container .autocomplete__clear-button {
                    position: absolute;
                    right: 10px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: none;
                    border: none;
                    padding: 4px;
                    cursor: pointer;
                    color: #222222;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    z-index: 10;
                    pointer-events: auto;
                }
                #search-container .autocomplete__clear-button:hover { background-color: rgba(0, 0, 0, 0.1); }
                #search-container .autocomplete__clear-button:focus { outline: 2px solid var(--ons-color-focus); outline-offset: 2px; }
                #search-container .autocomplete__clear-button.hidden { display: none; }
                #search-container .autocomplete__input-wrapper.visible-clear .autocomplete__dropdown-arrow-down { display: none; }
            `;
            document.head.appendChild(styleEl);
        };

        const findAutocompleteUiWrapper = (root) => (
            root.querySelector('.autocomplete__wrapper .autocomplete__input-wrapper')
            || root.querySelector('.autocomplete__input-wrapper')
            || root
        );

        const findAutocompleteInput = (uiWrapper, root) => (
            uiWrapper.querySelector('.autocomplete__input')
            || root.querySelector('.autocomplete__input')
            || null
        );

        const createClearButton = () => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'autocomplete__clear-button hidden';
            btn.setAttribute('aria-label', 'Clear selection');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            `;
            return btn;
        };

        const stopEvent = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        };

        if (mapWrapper === document.body) {
            document.body.appendChild(searchLabel);
            document.body.appendChild(searchDiv);
        } else {
            mapWrapper.parentNode.insertBefore(searchLabel, mapWrapper);
            mapWrapper.parentNode.insertBefore(searchDiv, mapWrapper);
        }

        const isVectorSearch = !!(state && state.geographySource === 'vector');
        const placeholderText = isVectorSearch ? 'Enter a postcode' : 'Type a place name or postcode';

        // Initialise the accessible autocomplete
        accessibleAutocomplete({
            element: inputWrapper,
            id: searchBoxId,
            source: searchSuggest,
            placeholder: placeholderText,
            showAllValues: true,
            autoselect: true,
            confirmOnBlur: false,
            displayMenu: "overlay",
            onConfirm: (name) => {
                clearSearchError();
                if (!name) {
                    if (typeof toggleClearButton === 'function') toggleClearButton();
                    return;
                }

                const normalizedPostcode = normalizePostcode(name);
                if (isLikelyUkPostcode(normalizedPostcode)) {
                    selectAreaByPostcode(normalizedPostcode);
                } else if (!isVectorSearch) {
                    // Area-name search only works when we have the full GeoJSON feature list.
                    selectAreaByName(name);
                }

                // accessible-autocomplete can update the input value without firing input/change.
                // Force a UI refresh so the chevron/clear button state matches.
                if (typeof toggleClearButton === 'function') {
                    setTimeout(() => toggleClearButton(), 0);
                }
            },
            dropdownArrow: (opts) =>
                `<svg class="${opts?.className}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 11.75 7.7" width="18" style="z-index:1"><path fill="currentColor" d="m1.37.15 4.5 5.1 4.5-5.1a.37.37 0 0 1 .6 0l.7.7a.45.45 0 0 1 0 .5l-5.5 6.2a.37.37 0 0 1-.6 0l-5.5-6.1a.64.64 0 0 1 0-.6l.7-.7a.64.64 0 0 1 .6 0Z"></path></svg>`
        });

        setupSearchClearButton(inputWrapper);

        function setupSearchClearButton(root) {
            const uiWrapper = findAutocompleteUiWrapper(root);
            const input = findAutocompleteInput(uiWrapper, root);
            if (!input) return;

            searchInputEl = input;

            ensureSearchStyles();

            const clearButton = createClearButton();

            const toggle = () => {
                const hasValue = !!input.value;
                clearButton.classList.toggle('hidden', !hasValue);
                uiWrapper.classList.toggle('visible-clear', hasValue);
            };

            toggleClearButton = toggle;

            let clearedByPointer = false;

            const clearSelectionAndReset = () => {
                suppressSuggestions(300);

                clearSearchError();

                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));

                if (typeof state.map !== 'undefined' && state.map !== null) {
                    clearAreaSelection(state, config.geoLayer);
                    state.hoveredAreaCode = null;
                    state.selectedAreaCode = null;
                    state.selectedAreaName = null;
                    updateKeyInfo(undefined, undefined, state);

                    const homeBounds = config.mapBounds || config.__autoMapBounds || config.maxBounds;
                    if (homeBounds) {
                        const padding = calculateZoomPadding(state.map);
                        state.map.fitBounds(homeBounds, { padding, animate: true });
                    }
                }

                toggle();
                closeListboxTemporarily(300);
                input.blur();
            };

            // Capture-phase intercept so accessible-autocomplete can't open the menu first
            clearButton.addEventListener('pointerdown', (e) => {
                stopEvent(e);
                clearedByPointer = true;
                clearSelectionAndReset();
            }, { capture: true });

            clearButton.addEventListener('mousedown', stopEvent, { capture: true });
            clearButton.addEventListener('mouseup', stopEvent, { capture: true });
            clearButton.addEventListener('touchstart', stopEvent, { capture: true, passive: false });
            clearButton.addEventListener('touchend', stopEvent, { capture: true, passive: false });

            // Keyboard activation (Enter/Space) triggers click
            clearButton.addEventListener('click', (e) => {
                stopEvent(e);
                if (clearedByPointer) {
                    clearedByPointer = false;
                    return;
                }
                clearSelectionAndReset();
            });

            input.addEventListener('input', toggle);
            input.addEventListener('change', toggle);
            input.addEventListener('input', clearSearchError);
            input.addEventListener('change', clearSearchError);
            uiWrapper.appendChild(clearButton);
            toggle();
        }

        const searchInput = document.getElementById(searchBoxId);
        const listboxId = `${searchBoxId}__listbox`;

        const syncAutocompleteTabOrder = () => {
            const listbox = document.getElementById(listboxId);
            if (!listbox) return;
            listbox.setAttribute('tabindex', '-1');
            listbox.querySelectorAll('[role="option"]').forEach(option => {
                option.setAttribute('tabindex', '-1');
            });
        };

        if (searchInput) {
            const scheduleSync = () => requestAnimationFrame(syncAutocompleteTabOrder);
            ['focus', 'blur', 'input', 'keydown', 'keyup', 'change'].forEach(evt => {
                searchInput.addEventListener(evt, scheduleSync);
            });
            scheduleSync();

            // On Windows browsers, grabbing the listbox scrollbar can blur the input,
            // which makes accessible-autocomplete collapse the menu. This keeps focus on the input so the menu stays open
            const attachScrollbarFocusGuard = () => {
                const listbox = document.getElementById(listboxId);
                if (!listbox || listbox.__onsScrollbarFocusGuard) return;
                listbox.__onsScrollbarFocusGuard = true;

                const guard = (e) => {
                    // Only relevant for mouse interactions (touch doesn't have a scrollbar).
                    if (e.pointerType && e.pointerType !== 'mouse') return;
                    if (e.type === 'mousedown' && typeof e.button === 'number' && e.button !== 0) return;

                    // If the event originates from an option element, let accessible-autocomplete
                    // handle selection normally.
                    if (e.target && e.target !== listbox) return;

                    // Prevent focus from leaving the input (blur closes the menu).
                    if (typeof e.preventDefault === 'function') e.preventDefault();
                    try {
                        searchInput.focus({ preventScroll: true });
                    } catch (err) {
                        try { searchInput.focus(); } catch (err2) { /* ignore */ }
                    }
                };

                // Capture-phase so we run before blur handlers.
                listbox.addEventListener('pointerdown', guard, { capture: true });
                listbox.addEventListener('mousedown', guard, { capture: true });
            };

            // Listbox is created by accessible-autocomplete; ensure we attach after init and
            // again whenever the input is focused (in case of re-render).
            setTimeout(attachScrollbarFocusGuard, 0);
            searchInput.addEventListener('focus', attachScrollbarFocusGuard);
        }

        // Function to populate search results
        async function searchSuggest(query, populateResults) {
            if (suggestionsSuppressed()) {
                populateResults([]);
                return;
            }
            const safeQuery = query.replace(/[^\w\s]/gi, ""); // Remove special characters

            // Vector tiles do not ship a full area-name list, so only suggest postcodes.
            // Also avoid hitting the API for empty/very short queries (e.g. on focus).
            if (isVectorSearch) {
                const q = (safeQuery || '').trim();
                if (q.length < 2) {
                    populateResults([]);
                    return;
                }
                const results = await fetchPostcodes(q);
                populateResults(results);
                return;
            }

            let results = !safeQuery || query === state.selectedAreaName ? areaNames :
                areaNames.filter((name) =>
                    name.match(new RegExp(`\\b${safeQuery}`, "i"))
                );

            if (results.length === 0) results = await fetchPostcodes(safeQuery);
            populateResults(results);
        }

        async function selectAreaByPostcode(code) {
            clearSearchError();

            const normalized = normalizePostcode(code);
            if (!isLikelyUkPostcode(normalized)) {
                setSearchError('Invalid postcode');
                return;
            }

            const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(normalized)}`;
            let response;
            try {
                response = await fetch(url);
            } catch (e) {
                if (config && config.debugInfo) console.warn('[Map Debug] Postcode lookup failed (fetch error):', e);
                setSearchError('Area unavailable');
                return;
            }

            if (!response.ok) {
                if (config && config.debugInfo) console.warn('[Map Debug] Postcode lookup failed (HTTP):', response.status, url);
                setSearchError('Invalid postcode');
                return;
            }

            let json;
            try {
                json = await response.json();
            } catch (e) {
                if (config && config.debugInfo) console.warn('[Map Debug] Postcode lookup failed (bad JSON):', e);
                setSearchError('Area unavailable');
                return;
            }

            if (!json || !json.result) {
                setSearchError('Invalid postcode');
                return;
            }

            const lon = +json.result.longitude;
            const lat = +json.result.latitude;
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
                setSearchError('Area unavailable');
                return;
            }

            selectAreaByLngLat(lon, lat);
        }

        let __postcodeTilePoll = null;

        function clearPostcodeTilePoll() {
            if (__postcodeTilePoll) {
                try { clearInterval(__postcodeTilePoll); } catch (e) { /* ignore */ }
                __postcodeTilePoll = null;
            }
        }

        function applySelectionForFeature(feature, source) {
            if (!feature || !feature.properties) return;
            if (!state || !state.map) return;

            const disableSelectionZoom = (config && config.disableSelectionZoom) || (state && state.disableSelectionZoom);
            const code = feature.properties[config.geoIdField];
            const areaName = feature.properties[config.geoNameField];
            if (!code) return;

            // Always ensure areaById is set for this code
            if (!areaById[code] && areaName) areaById[code] = areaName;

            // Clear previous selected state if different
            if (state.selectedAreaCode && state.selectedAreaCode !== code) {
                state.map.setFeatureState({
                    source: 'area',
                    sourceLayer: (state.geographySource === "vector" ? config.geoLayer : ""),
                    id: state.selectedAreaCode
                }, { selected: false });
            }

            // Clear hover state
            if (state.hoveredAreaCode) {
                state.map.setFeatureState({
                    source: 'area',
                    sourceLayer: (state.geographySource === "vector" ? config.geoLayer : ""),
                    id: state.hoveredAreaCode
                }, { hovered: false });
                state.hoveredAreaCode = null;
            }

            state.selectedAreaCode = code;
            state.selectedAreaName = areaName;

            state.map.setFeatureState({
                source: 'area',
                sourceLayer: (state.geographySource === "vector" ? config.geoLayer : ""),
                id: code
            }, { selected: true });

            const selectedVal = rateById[code];
            window.moveKeyIndicator(undefined);
            window.moveKeyIndicatorSelected(selectedVal);
            updateKeyInfo(selectedVal, areaName, state);
            clearSearchError();

            if (typeof state.onAreaSelected === 'function') {
                state.onAreaSelected({ code, areaName, value: selectedVal, source: source || 'search' });
            }

            if (!disableSelectionZoom && feature && feature.geometry) {
                const allCoords = collectCoords(feature.geometry);
                if (allCoords.length) {
                    const bounds = calculateBounds(allCoords);
                    const padding = calculateZoomPadding(state.map);
                    state.map.fitBounds(bounds, { padding, animate: true, duration: 900 });
                }
            }
        }

        function selectAreaByLngLat(lon, lat) {
            // Postcode selection: for vector tiles we need to pan to the location and wait
            // for the relevant tile to load before queryRenderedFeatures can find it.
            if (state.geographySource === 'vector') {
                if (!state.map) return;

                clearPostcodeTilePoll();

                // Pan immediately to ensure the relevant tile is requested (old-template behaviour)
                const minZoom = (typeof config.minZoom === 'number') ? config.minZoom : 0;
                const maxZoom = (typeof config.maxZoom === 'number') ? config.maxZoom : 24;

                // Use a slightly lower default zoom than the old template.
                // At very high zooms, vector tile geometries are heavily tile-clipped, which can
                // underestimate bounds for large areas. Starting a bit wider helps fitBounds.
                const requestedZoom = (config && typeof config.postcodeSearchZoom === 'number')
                    ? config.postcodeSearchZoom
                    : 9;
                const targetZoom = Math.max(minZoom, Math.min(maxZoom, requestedZoom));
                try {
                    // Smooth pan/zoom (jumpTo feels crunchy because it snaps instantly).
                    state.map.easeTo({ center: [lon, lat], zoom: targetZoom, duration: 650 });
                } catch (e) {
                    // If jumpTo fails for any reason, continue and attempt lookup anyway.
                }

                const startedAt = Date.now();
                const intervalMs = 150;
                const timeoutMs = 5000;

                const trySelect = () => {
                    if (!state.map) {
                        clearPostcodeTilePoll();
                        setSearchError('Area unavailable');
                        return;
                    }

                    const elapsed = Date.now() - startedAt;
                    if (elapsed > timeoutMs) {
                        clearPostcodeTilePoll();
                        setSearchError('Area unavailable');
                        return;
                    }

                    let features = [];
                    try {
                        const point = state.map.project([lon, lat]);
                        features = state.map.queryRenderedFeatures(point, { layers: ['area'] }) || [];
                    } catch (e) {
                        // ignore and keep polling
                        features = [];
                    }

                    if (features && features.length > 0) {
                        clearPostcodeTilePoll();
                        applySelectionForFeature(features[0], 'postcode');
                    }
                };

                // Run once immediately, then poll until the relevant tile is available.
                trySelect();
                __postcodeTilePoll = setInterval(trySelect, intervalMs);
                return;
            }

            // Fallback: GeoJSON/TopoJSON point-in-polygon
            if (!areas || !areas.features) return;
            const pt = [lon, lat];
            const found = areas.features.find(f => {
                if (!f.geometry) return false;
                if (f.geometry.type === 'Polygon') {
                    return pointInPolygon(pt, f.geometry.coordinates[0]);
                } else if (f.geometry.type === 'MultiPolygon') {
                    return f.geometry.coordinates.some(poly => pointInPolygon(pt, poly[0]));
                }
                return false;
            });
            if (found) {
                applySelectionForFeature(found, 'postcode');
            } else {
                setSearchError('Area unavailable');
            }
        }

        function selectAreaByName(name) {
            const code = areaNameToCode[name.toLowerCase()];
            if (!code) return;
            const feature = areaCodeToFeature[code];
            if (!feature) return;
            // Simulate click on area
            applySelectionForFeature(feature, 'search');
        }

        // Listen for ESC key to clear selection
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' || e.key === 'Esc') {
                // Clear both selection and hover feature-state and info
                if (typeof state.map !== 'undefined' && state.map !== null) {
                    suppressSuggestions(300);
                    clearSearchError();

                    // Clear the search input but keep focus there after clearing.
                    const input = document.getElementById(searchBoxId);
                    if (input) {
                        input.value = '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    clearAreaSelection(state, config.geoLayer);
                    state.hoveredAreaCode = null;
                    state.selectedAreaCode = null;
                    state.selectedAreaName = null;
                    // Always clear explainer and value immediately
                    updateKeyInfo(undefined, undefined, state);

                    // Reset view back to the configured "home" bounds (matches the clear button behaviour)
                    const homeBounds = config.mapBounds || config.__autoMapBounds || config.maxBounds;
                    if (homeBounds) {
                        const padding = calculateZoomPadding(state.map);
                        state.map.fitBounds(homeBounds, { padding, animate: true });
                    }

                    if (typeof toggleClearButton === 'function') {
                        setTimeout(() => toggleClearButton(), 0);
                    }
                    closeListboxTemporarily(300);

                    // Put focus back in the (now cleared) input.
                    if (input) {
                        try { input.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
                        // Keep the autocomplete menu closed until the user interacts again.
                        forceHideSearchMenuUntilUserInteracts();
                    }

                    try { e.preventDefault(); } catch (err) { /* ignore */ }
                }
            }
        });

    }
}

function isKeyInfoEnabled() {
    // Default: enabled.
    // Templates can disable this by setting either:
    // - config.showKeyInfo = false
    // - config.keyInfo = false
    // (Both supported to avoid forcing a naming convention across templates.)
    if (config && typeof config.showKeyInfo === 'boolean') return config.showKeyInfo;
    if (config && typeof config.keyInfo === 'boolean') return config.keyInfo;
    return true;
}

let __keyInfoSel = null;
let __valueSel = null;
let __explainerSel = null;
let __explainerLine1 = null;
let __explainerLine2 = null;

function ensureKeyInfoDom() {
    const enabled = isKeyInfoEnabled();
    const keyInfoNode = document.getElementById('keyinfo');

    // If the template doesn't include the element, nothing to do.
    if (!keyInfoNode) return null;

    // Hide the block entirely if disabled.
    if (!enabled) {
        keyInfoNode.style.display = 'none';
        return null;
    }

    // Re-enable if it was previously hidden.
    if (keyInfoNode.style.display === 'none') keyInfoNode.style.display = '';

    // Use D3 to populate the info area above the keyscale
    __keyInfoSel = __keyInfoSel && !__keyInfoSel.empty() ? __keyInfoSel : d3.select('#keyinfo');
    __keyInfoSel
        .classed('keyinfo', true)
        .style('margin-left', (config.keyScaleMargin && typeof config.keyScaleMargin.left === 'number') ? config.keyScaleMargin.left + 'px' : null);

    // Value
    __valueSel = __keyInfoSel.select('#keyinfo-value');
    if (__valueSel.empty()) {
        __valueSel = __keyInfoSel.append('div').attr('id', 'keyinfo-value');
    }
    // Explainer
    __explainerSel = __keyInfoSel.select('#keyinfo-explainer');
    if (__explainerSel.empty()) {
        __explainerSel = __keyInfoSel.append('div').attr('id', 'keyinfo-explainer');
    }
    // Two lines for explainer
    __explainerLine1 = __explainerSel.select('span.line1');
    if (__explainerLine1.empty()) __explainerLine1 = __explainerSel.append('span').classed('line1', true);
    __explainerLine2 = __explainerSel.select('span.line2');
    if (__explainerLine2.empty()) __explainerLine2 = __explainerSel.append('span').classed('line2', true);

    return {
        keyInfoNode,
        valueSel: __valueSel,
        explainerSel: __explainerSel,
        explainerLine1: __explainerLine1,
        explainerLine2: __explainerLine2
    };
}


export function updateKeyInfo(value, areaName, state) {
    const keyInfo = ensureKeyInfoDom();
    if (!keyInfo) return;

    const { valueSel, explainerLine1, explainerLine2 } = keyInfo;

    // Alignment logic for explainer/value
    const keyInfoNode = document.getElementById('keyinfo');
    const valueNode = document.getElementById('keyinfo-value');
    const explainerNode = document.getElementById('keyinfo-explainer');
    if (keyInfoNode && valueNode && explainerNode) {
        // Set right margin from config.keyScaleMargin.right
        if (config.keyScaleMargin && typeof config.keyScaleMargin.right === 'number') {
            keyInfoNode.style.marginRight = 'calc(' + config.keyScaleMargin.right + 'px - 1rem)';
        } else {
            keyInfoNode.style.marginRight = '';
        }
        if (config.explainerAlignment === 'right') {
            keyInfoNode.style.flexDirection = 'row-reverse';
            keyInfoNode.style.justifyContent = 'flex-end';
            valueNode.style.textAlign = 'left';
            explainerNode.style.textAlign = 'right';
        } else {
            keyInfoNode.style.flexDirection = 'row';
            keyInfoNode.style.justifyContent = '';
            valueNode.style.textAlign = 'right';
            explainerNode.style.textAlign = 'left';
        }
    }
    const explainerPlaceholder = getConfigValue('explainerPlaceholder', state) || '';
    const explainerPlaceholderTextSize = getConfigValue('explainerPlaceholderTextSize', state);
    const explainerPlaceholderFontSize = (typeof explainerPlaceholderTextSize === 'number')
        ? `${explainerPlaceholderTextSize}px`
        : explainerPlaceholderTextSize;
    const explainerPlaceholderStyle = explainerPlaceholderFontSize
        ? ` style="font-size:${explainerPlaceholderFontSize};"`
        : '';
    const explainerPrefix = getConfigValue('explainerPrefix', state) || '';
    const explainerSuffix = getConfigValue('explainerSuffix', state) || '';
    const unavailablePrefix = getConfigValue('unavailablePrefix', state) || '';
    const unavailableSuffix = getConfigValue('unavailableSuffix', state) || '';

    if (typeof value === 'undefined' || value === null || isNaN(value)) {
        // If areaName is provided, show unavailable message; else show placeholder
        if (areaName) {
            const areaLabel = areaName || 'this area';
            valueSel.html(`<span class="keyinfo-placeholder"></span>`); // No value shown
            explainerLine1.html('');
            explainerLine1.html(`${unavailablePrefix} <strong>${d3.create('span').text(areaName).node().textContent}</strong> ${unavailableSuffix}`);
            explainerLine2.text('');
        } else {
            // Show placeholder in valueSel, clear explainer
            valueSel.html(`<span class="keyinfo-placeholder"${explainerPlaceholderStyle}>${explainerPlaceholder}</span>`);
            explainerLine1.html('');
            explainerLine2.text('');
        }
        // Always clear explainer lines if both arguments are undefined
        if (typeof value === 'undefined' && typeof areaName === 'undefined') {
            explainerLine1.html('');
            explainerLine2.text('');
        }
        return;
    }
    // Format value with prefix/suffix for value display (supports arrays per dataset)
    let fmt = d3.format(getConfigValue('valueFormat', state) || ',.0f');
    let valuePrefix = getConfigValue('valuePrefix', state) || '';
    let valueSuffix = getConfigValue('valueSuffix', state) || '';
    valueSel.html(
        `<span style="font-size:0.6em;vertical-align:middle;">${valuePrefix}</span>` +
        `<span style="font-size:1em;">${fmt(value)}</span>` +
        `<span style="font-size:0.6em;vertical-align:middle;">${valueSuffix}</span>`
    );

    // Explainer: explainerPrefix, area name (bold), explainerSuffix (all in one container, prefix/suffix can be HTML)
    let explainerHtml = '';
    explainerHtml += explainerPrefix;
    if (areaName) {
        explainerHtml += '<strong>' + d3.create('span').text(areaName).node().textContent + '</strong>';
    }
    explainerHtml += explainerSuffix;
    explainerLine1.html(explainerHtml);
    explainerLine2.text('');
}

function resolveBaseConfigValue(key, state) {
    const datasetCfg = (state && typeof state.datasetIndex === 'number' && Array.isArray(config.datasets))
        ? (config.datasets[state.datasetIndex] || config.datasets[0] || null)
        : null;
    if (datasetCfg && Object.prototype.hasOwnProperty.call(datasetCfg, key) && typeof datasetCfg[key] !== 'undefined') {
        return datasetCfg[key];
    }

    const val = config[key];
    if (!Array.isArray(val)) return val;

    // Multi-value-column dataset switching (valueColumns + selectedValueColumn)
    if (state && state.selectedValueColumn && Array.isArray(state.valueColumns)) {
        const idx = state.valueColumns.indexOf(state.selectedValueColumn);
        if (idx >= 0 && idx < val.length) return val[idx];
        return val[0];
    }

    // File-based dataset switching (e.g. time-series template uses config.datasets)
    if (state && typeof state.datasetIndex === 'number') {
        const idx = state.datasetIndex;
        if (idx >= 0 && idx < val.length) return val[idx];
        return val[0];
    }

    return val[0];
}

function getConfigValue(key, state) {
    const changeKey = (state && state.displayValueMode === 'change') ? CHANGE_DISPLAY_KEY_MAP[key] : null;
    if (changeKey) {
        const changeValue = resolveBaseConfigValue(changeKey, state);
        if (changeValue !== null && typeof changeValue !== 'undefined') return changeValue;
    }
    return resolveBaseConfigValue(key, state);
}

export function clearAreaSelection(state, geoLayer) {
    if (state.hoveredAreaCode) {
        state.map.setFeatureState({
            source: 'area',
            sourceLayer: (state.geographySource === "vector" ? geoLayer : ""),
            id: state.hoveredAreaCode
        }, { hovered: false });
    }
    if (state.selectedAreaCode) {
        state.map.setFeatureState({
            source: 'area',
            sourceLayer: (state.geographySource === "vector" ? geoLayer : ""),
            id: state.selectedAreaCode
        }, { selected: false });
    }
    if (state.map.getCanvas) state.map.getCanvas().style.cursor = '';
    if (window.moveKeyIndicator) window.moveKeyIndicator(undefined);
    if (window.moveKeyIndicatorSelected) window.moveKeyIndicatorSelected(undefined);

    if (typeof state.onAreaSelected === 'function') {
        state.onAreaSelected({ code: null, areaName: null, value: null, source: 'clear' });
    }
}



export function getPalette(config, state) {
    const debug = config.debugInfo === true;
    const cp = config.colourPalette;

    const isColourString = (s) => (
        typeof s === 'string'
        && (/^#/.test(s) || /^rgb\(/i.test(s) || /^hsl\(/i.test(s))
    );
    const looksLikeColourArray = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every(isColourString);
    const inferPaletteMode = () => {
        if (config.paletteMode === 'single' || config.paletteMode === 'multiple') {
            return config.paletteMode;
        }

        if (!Array.isArray(cp)) return 'single';

        // A flat array of colour strings is one palette for all datasets.
        if (looksLikeColourArray(cp)) return 'single';

        // Otherwise treat an array value as a per-dataset palette list.
        // Examples:
        // - [ONScolours.sequential.alternative[5], ONScolours.diverging.declineToGrowth[5]]
        // - ["YlGnBu", "RdBu"]
        // - [[...], [...]]
        return 'multiple';
    };
    const paletteMode = inferPaletteMode();

    // Helper to resolve a palette from a string or array
    function resolvePalette(p, idx = null) {
        let resolved;
        // Determine number of breaks to use for d3 scheme or ONScolours
        let k = 7;
        if (Array.isArray(config.breaksNumber)) {
            k = (idx !== null && typeof config.breaksNumber[idx] === 'number') ? config.breaksNumber[idx] : config.breaksNumber[0] || 7;
        } else if (typeof config.breaksNumber === 'number') {
            k = config.breaksNumber;
        }
        // Clamp k to available range for d3 schemes (usually 3-9)
        if (k < 3) {
            if (debug) console.log(`[Map Debug] breaksNumber (k=${k}) is less than 3, clamping to 3.`);
            k = 3;
        }
        if (k > 9) {
            if (debug) console.log(`[Map Debug] breaksNumber (k=${k}) is greater than 9, clamping to 9.`);
            k = 9;
        }
        if (typeof p === 'string') {
            if (p.startsWith('ONScolours')) {
                try {
                    // eslint-disable-next-line no-eval
                    let paletteObj = eval(p);
                    if (paletteObj && typeof paletteObj === 'object' && paletteObj[k]) {
                        resolved = paletteObj[k];
                        if (debug) console.log(`[Map Debug] Using ONScolours palette '${p}' with k=${k}`, resolved, idx !== null ? `(dataset index ${idx})` : '');
                    } else if (Array.isArray(paletteObj)) {
                        resolved = paletteObj;
                        if (debug) console.log(`[Map Debug] Using ONScolours palette '${p}' as array`, resolved, idx !== null ? `(dataset index ${idx})` : '');
                    } else {
                        resolved = ONScolours.sequential.standard[k] || ONScolours.sequential.standard[5];
                        if (debug) console.log(`[Map Debug] Fallback to ONScolours.sequential.standard[${k}] for ONScolours palette '${p}'`, resolved, idx !== null ? `(dataset index ${idx})` : '');
                    }
                } catch (e) {
                    resolved = ONScolours.sequential.standard[k] || ONScolours.sequential.standard[5];
                    if (debug) console.log(`[Map Debug] Error evaluating ONScolours palette '${p}', fallback to ONScolours.sequential.standard[${k}]`, resolved, idx !== null ? `(dataset index ${idx})` : '', e);
                }
            } else if (d3[`scheme${p}`]) {
                resolved = d3[`scheme${p}`][k] || d3[`scheme${p}`][7];
                if (debug) console.log(`[Map Debug] Using d3.scheme (ColorBrewer) palette '${p}' with k=${k}`, resolved, idx !== null ? `(dataset index ${idx})` : '');
            }
        }
        if (!resolved && Array.isArray(p)) {
            // If it's [["PuRd"]], treat as preset name
            if (p.length === 1 && typeof p[0] === 'string' && d3[`scheme${p[0]}`]) {
                resolved = d3[`scheme${p[0]}`][k] || d3[`scheme${p[0]}`][7];
                if (debug) console.log(`[Map Debug] Using d3.scheme (ColorBrewer) palette '${p[0]}' (wrapped in array) with k=${k}`, resolved, idx !== null ? `(dataset index ${idx})` : '');
            } else {
                resolved = p;
                if (debug) console.log(`[Map Debug] Using custom palette array`, resolved, idx !== null ? `(dataset index ${idx})` : '');
            }
        }
        if (!resolved) {
            resolved = ONScolours.sequential.standard[k] || ONScolours.sequential.standard[5];
            if (debug) console.log(`[Map Debug] Fallback to ONScolours.sequential.standard[${k}]`, resolved, idx !== null ? `(dataset index ${idx})` : '');
        }
        return resolved;
    }
    // Multiple mode: pick palette by dataset index.
    // Supports:
    // - value-column dataset switching (state.valueColumns + state.selectedValueColumn)
    // - file-based dataset switching (state.datasetIndex)
    if (paletteMode === 'multiple' && state) {
        const idx = (() => {
            if (Array.isArray(state.valueColumns) && state.valueColumns.length > 1) {
                if (typeof state.selectedValueColumn === 'number') return state.selectedValueColumn;
                if (typeof state.selectedValueColumn === 'string') {
                    const i = state.valueColumns.indexOf(state.selectedValueColumn);
                    return i >= 0 ? i : 0;
                }
                return 0;
            }

            if (typeof state.datasetIndex === 'number') return state.datasetIndex;

            return 0;
        })();

        // If the user provided a single palette as an array of colours (e.g. ["#...", "#..."])
        // treat it as "use this palette for all datasets".
        if (looksLikeColourArray(cp)) return resolvePalette(cp, idx);

        // If the user provided multiple palettes (array-of-palettes or array of palette names), select by dataset.
        if (Array.isArray(cp)) return resolvePalette(cp[idx] ?? cp[0], idx);
    }

    // Single mode or fallback
    return resolvePalette(cp);
}

export function convertTopoJSONtoGeojson(areas, geographySource) {
    const debug = config.debugInfo === true;
    if (debug) {
        console.log('[Map Debug] Geography source:', geographySource, '| geoUrl:', config.geoUrl || '(default master-topo.json)', '| geoLayer:', config.geoLayer, '| geoYear:', config.geoYear);
    }
    if (geographySource !== "vector") {
        // Convert TopoJSON to GeoJSON
        if (areas.type !== "FeatureCollection") {
            const key = areas.objects[config.geoLayer] ? config.geoLayer : Object.keys(areas.objects)[0];
            if (debug && key !== config.geoLayer) {
                console.log('[Map Debug] geoLayer not found in topojson. Falling back to object key:', key);
            }
            areas = topojson.feature(areas, areas.objects[key]);
        }

        if (config.geoYear && Array.isArray(areas.features)) {
            const beforeCount = areas.features.length;
            areas.features = areas.features.filter(d => yearFilter(d.properties || {}, config.geoYear));
            if (debug) {
                console.log('[Map Debug] Applied geoYear filter:', config.geoYear, '| features before:', beforeCount, '| after:', areas.features.length);
            }
        }

        if (config.geoCountries.length < 4) {
            const beforeCount = areas.features.length;
            areas.features = areas.features.filter(d => config.geoCountries.includes(d.properties[config.geoIdField][0]));
            if (debug) {
                console.log('[Map Debug] Applied geoCountries filter:', config.geoCountries.join(','), '| features before:', beforeCount, '| after:', areas.features.length);
            }
        }
    }
    return areas;
}

export function buildValueAndAreaLookups(data, config, state) {
    const rateById = {};
    const areaById = {};
    data.forEach((d) => {
        rateById[d[config.dataIdField]] = state.selectedValueColumn ? +d[state.selectedValueColumn] : +d.value;
        areaById[d[config.dataIdField]] = d[config.dataNameField] ?? d[config.geoNameField];
    });
    return { rateById, areaById };
}

function debugReportDataGeographyMatch({ data, areas, config, state, rateById, areaById }) {
    if (!config || config.debugInfo !== true) return;

    // For vector tiles we don't have the full feature list client-side.
    if (state && state.geographySource === 'vector') {
        console.log('[Map Debug] Skipping data↔geography match report (vector tiles do not expose full feature list).');
        return;
    }

    if (!areas || !Array.isArray(areas.features)) {
        console.log('[Map Debug] Skipping data↔geography match report (no GeoJSON features available).');
        return;
    }

    const dataIdField = config.dataIdField;
    const geoIdField = config.geoIdField;
    const geoNameField = config.geoNameField;

    const limit = (typeof config.debugMatchLimit === 'number' && Number.isFinite(config.debugMatchLimit))
        ? Math.max(10, Math.floor(config.debugMatchLimit))
        : 200;

    const dataCodes = new Set();
    let blankDataCodes = 0;
    for (const row of (Array.isArray(data) ? data : [])) {
        const raw = row ? row[dataIdField] : null;
        const code = (raw === null || typeof raw === 'undefined') ? '' : String(raw).trim();
        if (!code) {
            blankDataCodes += 1;
            continue;
        }
        dataCodes.add(code);
    }

    const geoCodes = new Set();
    const geoNameByCode = {};
    let blankGeoCodes = 0;
    for (const f of areas.features) {
        const props = (f && f.properties) ? f.properties : {};
        const raw = props ? props[geoIdField] : null;
        const code = (raw === null || typeof raw === 'undefined') ? '' : String(raw).trim();
        if (!code) {
            blankGeoCodes += 1;
            continue;
        }
        geoCodes.add(code);
        if (!geoNameByCode[code]) {
            const nm = props ? (props[geoNameField] ?? props[config.dataNameField]) : null;
            if (nm !== null && typeof nm !== 'undefined' && String(nm).trim()) {
                geoNameByCode[code] = String(nm);
            }
        }
    }

    const dataNotInGeo = [];
    for (const code of dataCodes) {
        if (!geoCodes.has(code)) {
            const rawVal = rateById ? rateById[code] : undefined;
            const v = (rawVal === null || typeof rawVal === 'undefined' || rawVal === '') ? NaN : +rawVal;
            dataNotInGeo.push({
                code,
                name: (areaById && areaById[code]) ? areaById[code] : undefined,
                value: Number.isFinite(v) ? v : null
            });
        }
    }
    dataNotInGeo.sort((a, b) => String(a.code).localeCompare(String(b.code)));

    const geoMissingFromData = [];
    const geoPresentButNoValue = [];
    for (const code of geoCodes) {
        const presentInData = dataCodes.has(code);
        const rawVal = rateById ? rateById[code] : undefined;
        const v = (rawVal === null || typeof rawVal === 'undefined' || rawVal === '') ? NaN : +rawVal;
        const name = (geoNameByCode && geoNameByCode[code])
            ? geoNameByCode[code]
            : (areaById && areaById[code])
                ? areaById[code]
                : undefined;

        if (!presentInData) {
            geoMissingFromData.push({ code, name });
            continue;
        }

        if (!Number.isFinite(v)) {
            geoPresentButNoValue.push({ code, name });
        }
    }
    geoMissingFromData.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    geoPresentButNoValue.sort((a, b) => String(a.code).localeCompare(String(b.code)));

    const commonNote = `data rows: ${(Array.isArray(data) ? data.length : 0)}, unique data codes: ${dataCodes.size}${blankDataCodes ? ` (${blankDataCodes} blank)` : ''} | geography features: ${areas.features.length}, unique geo codes: ${geoCodes.size}${blankGeoCodes ? ` (${blankGeoCodes} blank)` : ''}`;

    // Entry 1: data IDs missing from geography
    console.groupCollapsed(`[Map Debug] Data IDs not found in geography (${dataNotInGeo.length})`);
    console.log(commonNote);
    if (dataNotInGeo.length) {
        console.table(dataNotInGeo.slice(0, limit));
        if (dataNotInGeo.length > limit) console.log(`…and ${dataNotInGeo.length - limit} more`);
    } else {
        console.log('None');
    }
    console.groupEnd();

    // Entry 2: geography IDs with no data
    const geoNoDataTotal = geoMissingFromData.length + geoPresentButNoValue.length;
    console.groupCollapsed(`[Map Debug] Geography IDs with no data value (${geoNoDataTotal})`);
    console.log(commonNote);
    console.log(`Missing from data (no row/code): ${geoMissingFromData.length} | Present in data but value is null/blank/NaN: ${geoPresentButNoValue.length}`);

    if (!geoNoDataTotal) {
        console.log('None');
        console.groupEnd();
        return;
    }

    if (geoMissingFromData.length) {
        console.groupCollapsed('Missing from data');
        console.table(geoMissingFromData.slice(0, limit));
        if (geoMissingFromData.length > limit) console.log(`…and ${geoMissingFromData.length - limit} more`);
        console.groupEnd();
    }

    if (geoPresentButNoValue.length) {
        console.groupCollapsed('Present in data but no value');
        console.table(geoPresentButNoValue.slice(0, limit));
        if (geoPresentButNoValue.length > limit) console.log(`…and ${geoPresentButNoValue.length - limit} more`);
        console.groupEnd();
    }
    console.groupEnd();
}


export function setupMap(config, data, rateById, areaById, areas, colour, state) {
    state.map.on('load', () => {
        const currentData = (state && Array.isArray(state.dataForMap) && state.dataForMap.length)
            ? state.dataForMap
            : data;
        const currentRateById = (state && state.rateById) || rateById;
        const currentAreaById = (state && state.areaById) || areaById;
        const currentColour = (state && state.colour) || colour;

        // Optional debug report to help diagnose ID mismatches between the data and the geography.
        debugReportDataGeographyMatch({ data: currentData, areas, config, state, rateById: currentRateById, areaById: currentAreaById });

        if (config.debugInfo && Array.isArray(config.__autoMapBounds)) {
            const viewBounds = state.map.getBounds().toArray();
            if (!boundsContain(viewBounds, config.__autoMapBounds)) {
                let zoomNote = '';
                const z = state.map.getZoom();
                if (typeof config.minZoom === 'number' && z <= config.minZoom + 1e-6) {
                    zoomNote = ' Current zoom is at minZoom.';
                } else if (typeof config.maxZoom === 'number' && z >= config.maxZoom - 1e-6) {
                    zoomNote = ' Current zoom is at maxZoom.';
                }
                console.warn("[Map Debug] mapBounds 'auto' exceeds the initial view; maxBounds/minZoom/maxZoom may be constraining the fit." + zoomNote);
            }
        }

        if (state.geographySource === "vector") {

            state.map.addSource('area', { type: 'vector', tiles: [config.geoUrl], promoteId: { [config.geoLayer]: config.geoIdField } });

        } else {

            state.map.addSource('area', { type: 'geojson', data: areas, promoteId: config.geoIdField });

        }

        const unavailableColour = getConfigValue('colourUnavailable', state) ?? config.colourUnavailable ?? ONScolours.noData;

        // Initialise feature-state values/colours.
        // - For GeoJSON we can iterate every feature, including those missing from the data entirely.
        // - For vector tiles we can only set feature-state for IDs we have in the data.
        if (state.geographySource !== 'vector' && areas && Array.isArray(areas.features)) {
            for (const f of areas.features) {
                const props = (f && f.properties) ? f.properties : null;
                const rawCode = props ? props[config.geoIdField] : null;
                const code = (rawCode === null || typeof rawCode === 'undefined') ? '' : String(rawCode).trim();
                if (!code) continue;

                const raw = currentRateById ? currentRateById[code] : undefined;
                const value = (raw === null || typeof raw === 'undefined' || raw === '') ? NaN : +raw;
                const hasData = Number.isFinite(value);
                const fillColor = hasData ? currentColour(value) : unavailableColour;

                state.map.setFeatureState(
                    { source: 'area', sourceLayer: '', id: code },
                    { value: hasData ? value : null, color: fillColor }
                );
            }
        } else {
            (Array.isArray(currentData) ? currentData : []).forEach(d => {
                const rawCode = d ? d[config.dataIdField] : null;
                const code = (rawCode === null || typeof rawCode === 'undefined') ? '' : String(rawCode).trim();
                if (!code) return;

                const raw = currentRateById ? currentRateById[code] : (d ? d.value : undefined);
                const value = (raw === null || typeof raw === 'undefined' || raw === '') ? NaN : +raw;
                const hasData = Number.isFinite(value);
                const fillColor = hasData ? currentColour(value) : unavailableColour;
                state.map.setFeatureState(
                    { source: 'area', sourceLayer: (state.geographySource === "vector" ? config.geoLayer : ""), id: code },
                    { value: hasData ? value : null, color: fillColor }
                );
            });
        }

        const baseFillOpacity = (typeof config.fillOpacity === 'number') ? config.fillOpacity : 0.8;
        const dimFillOpacity = (typeof config.legendDimOpacity === 'number') ? config.legendDimOpacity : 0.5;

        state.map.addLayer({
            id: 'area',
            type: 'fill',
            source: 'area',
            "source-layer": state.geographySource === "vector" ? config.geoLayer : "",
            layout: {},
            paint: {
                // If feature-state isn't set (e.g. geography areas missing from the data entirely),
                // fall back to the configured unavailable colour.
                'fill-color': ['coalesce', ['feature-state', 'color'], unavailableColour],
                'fill-opacity': [
                    'case',
                    ['==', ['feature-state', 'legendActive'], true],
                    [
                        'case',
                        ['==', ['feature-state', 'legendMatch'], true],
                        baseFillOpacity,
                        dimFillOpacity
                    ],
                    baseFillOpacity
                ],
                // 'fill-outline-color': ONScolours.grey100
            }
        }, 'place_town');

 

        state.map.addLayer({
            id: 'area-border',
            type: 'line',
            source: 'area',
            "source-layer": state.geographySource === "vector" ? config.geoLayer : "",
            layout: {},
            paint: {
                'line-color': 'grey',
                'line-opacity': [
                    'case',
                    ['==', ['feature-state', 'legendActive'], true],
                    [
                        'case',
                        ['==', ['feature-state', 'legendMatch'], true],
                        1,
                        dimFillOpacity
                    ],
                    1
                ],
                'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.2, 11, 1]
            }
        }, 'place_town');

               // White outline below grey outline on hover
        state.map.addLayer({
            id: 'area-hover-white',
            type: 'line',
            source: 'area',
            "source-layer": state.geographySource === "vector" ? config.geoLayer : "",
            layout: {},
            paint: {
                'line-color': 
                'white',
                // "#F39431",
                'line-width': 3,
                'line-opacity': [
                    'case',
                    ['==', ['feature-state', 'hovered'], true], 0.8, 0],
                }
            })

        // Add hover layer
        state.map.addLayer({
            id: 'area-hover',
            type: 'line',
            source: 'area',
            "source-layer": state.geographySource === "vector" ? config.geoLayer : "",
            layout: {},
            paint: {
                'line-color': ONScolours.grey100,
                'line-width': 2,
                'line-opacity': [
                    'case',
                    ['==', ['feature-state', 'hovered'], true], 1, 0],
            }
        });

        // Add selected border layer (below hover)

        // white one
        state.map.addLayer({
            id: 'area-selected-white',
            type: 'line',
            source: 'area',
            "source-layer": state.geographySource === "vector" ? config.geoLayer : "",
            layout: {},
            paint: {
                'line-color': "white",
                'line-width': 5,
                'line-opacity': ['case', ['==', ['feature-state', 'selected'], true], 0.8, 0],
            }
        }, 'area-hover');

        // grey one
        state.map.addLayer({
            id: 'area-selected-grey',
            type: 'line',
            source: 'area',
            "source-layer": state.geographySource === "vector" ? config.geoLayer : "",
            layout: {},
            paint: {
                'line-color': ONScolours.grey100,
                'line-width': 3,
                'line-opacity': ['case', ['==', ['feature-state', 'selected'], true], 1, 0],
            }
        }, 'area-hover');
        
        // Legend hover outline layer (below hover outline)
        state.map.addLayer({
            id: 'area-legend-match',
            type: 'line',
            source: 'area',
            "source-layer": state.geographySource === "vector" ? config.geoLayer : "",
            layout: {},
            paint: {
                'line-color': ONScolours.grey100,
                'line-width': 1.5,
                'line-opacity': [
                    'case',
                    ['==', ['feature-state', 'legendMatch'], true],
                    1,
                    0
                ]
            }
        }, 'area-hover');

        //Get current year for attributions
        let today = new Date();
        state.map.getSource('area').attribution = "Contains OS data &copy; Crown copyright and database right " + today.getFullYear();

        //add compact attribution
        state.map.addControl(new maplibregl.AttributionControl({
            compact: false
        }), 'bottom-right');

        state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
        state.map.dragRotate.disable();
        state.map.touchZoomRotate.disableRotation();
        // map.addControl(new maplibregl.GeolocateControl({
        // 	positionOptions: {
        // 		enableHighAccuracy: true
        // 	}
        // }));

        // Home/reset control removed: reset is now handled via the search clear (x)

        // Interactivity
        state.map.on('mousemove', 'area', (e) => {
            state.map.getCanvas().style.cursor = 'pointer';
            const code = e.features[0].properties[config.geoIdField];

            // Remove hover state from previous feature
            if (state.hoveredAreaCode && state.hoveredAreaCode !== code) {
                state.map.setFeatureState({
                    source: 'area',
                    sourceLayer: (state.geographySource === "vector" ? config.geoLayer : ""),
                    id: state.hoveredAreaCode
                }, { hovered: false });
            }
            state.hoveredAreaCode = code;

            state.map.setFeatureState({
                source: 'area',
                sourceLayer: (state.geographySource === "vector" ? config.geoLayer : ""),
                id: state.hoveredAreaCode
            }, { hovered: true });
            const areaName = e.features[0].properties[config.geoNameField];
            const value = currentRateById[e.features[0].properties[config.geoIdField]];

            // Always show hover info if hovering, but if an area is selected, show faded indicator for it
            if (typeof value !== 'undefined' && value !== null && !isNaN(value)) {
                window.moveKeyIndicator(value);
                if (state.selectedAreaCode && state.selectedAreaCode !== code) {
                    const selectedVal = currentRateById[state.selectedAreaCode];
                    window.moveKeyIndicatorSelected(selectedVal);
                } else {
                    window.moveKeyIndicatorSelected(undefined);
                }
                updateKeyInfo(value, areaName, state);
            } else {
                // Value is missing, show unavailable message
                window.moveKeyIndicator(undefined);
                if (state.selectedAreaCode && state.selectedAreaCode !== code) {
                    const selectedVal = currentRateById[state.selectedAreaCode];
                    window.moveKeyIndicatorSelected(selectedVal);
                } else {
                    window.moveKeyIndicatorSelected(undefined);
                }
                updateKeyInfo(undefined, areaName, state);
            }
        });
        state.map.on('mouseleave', 'area', () => {
            state.map.getCanvas().style.cursor = '';
            if (state.hoveredAreaCode) {
                state.map.setFeatureState({
                    source: 'area',
                    sourceLayer: (state.geographySource === "vector" ? config.geoLayer : ""),
                    id: state.hoveredAreaCode
                }, { hovered: false });
                state.hoveredAreaCode = null;
            }
            // If an area is selected, show its info and indicator; otherwise clear
            if (state.selectedAreaCode) {
                const selectedVal = currentRateById[state.selectedAreaCode];
                window.moveKeyIndicator(undefined);
                window.moveKeyIndicatorSelected(selectedVal);
                updateKeyInfo(selectedVal, currentAreaById[state.selectedAreaCode], state);
            } else {
                window.moveKeyIndicator(undefined);
                window.moveKeyIndicatorSelected(undefined);
                updateKeyInfo(undefined, undefined, state);
            }
        });
        state.map.on('click', 'area', (e) => {
            const disableSelectionZoom = (config && config.disableSelectionZoom) || (state && state.disableSelectionZoom);
            // On click, lock the info display to this area until mouse leaves
            const code = e.features[0].properties[config.geoIdField];
            const areaName = e.features[0].properties[config.geoNameField];

            // Reset search box to placeholder
            setSearchText(areaName);

            // Always ensure areaById is set for this code
            if (!areaById[code]) {
                areaById[code] = areaName;
            }
            // Remove previous selected state
            if (state.selectedAreaCode && state.selectedAreaCode !== code) {
                state.map.setFeatureState({
                    source: 'area',
                    sourceLayer: (state.geographySource === "vector" ? config.geoLayer : ""),
                    id: state.selectedAreaCode
                }, { selected: false });
            }
            state.selectedAreaCode = code;
            state.selectedAreaName = areaName;
            state.map.setFeatureState({
                source: 'area',
                sourceLayer: (state.geographySource === "vector" ? config.geoLayer : ""),
                id: state.selectedAreaCode
            }, { selected: true });			// Remove hover state (if any)
            if (state.hoveredAreaCode) {
                state.map.setFeatureState({
                    source: 'area',
                    sourceLayer: (state.geographySource === "vector" ? config.geoLayer : ""),
                    id: state.hoveredAreaCode
                }, { hovered: false });
                state.hoveredAreaCode = null;
            }
            // Show faded indicator for selected, hide hover indicator
            const selectedVal = currentRateById[e.features[0].properties[config.geoIdField]];
            window.moveKeyIndicator(undefined);
            window.moveKeyIndicatorSelected(selectedVal);
            // Show explainer for selected area
            updateKeyInfo(selectedVal, areaName, state);

            if (typeof state.onAreaSelected === 'function') {
                state.onAreaSelected({ code, areaName, value: selectedVal, source: 'map' });
            }

            // --- Zoom to area bounds (40% of map, centered on unobscured area) ---
            if (!disableSelectionZoom) {
                const feature = e.features[0];
                if (feature && feature.geometry) {
                // Collect all coordinates from all polygons (Polygon or MultiPolygon)
                let allCoords = [];
                function collectCoords(geom) {
                    if (geom.type === 'Polygon') {
                        // geom.coordinates: [ [ [lon,lat], ... ] ]
                        allCoords.push(...geom.coordinates[0]);
                    } else if (geom.type === 'MultiPolygon') {
                        // geom.coordinates: [ [ [ [lon,lat], ... ] ], ... ]
                        geom.coordinates.forEach(poly => {
                            allCoords.push(...poly[0]);
                        });
                    }
                }
                collectCoords(feature.geometry);
                // If geometry has more than one part (e.g., MultiPolygon), ensure all are included
                if (allCoords.length) {
                    let bounds = calculateBounds(allCoords)
                    const padding = calculateZoomPadding(state.map);
                    const options = {
                        padding,
                        animate: true
                    };

                    state.map.fitBounds(bounds, options);

                }
            }
            }
        });

        // Legend hover handlers (from keyscale)
        const sourceLayerName = (state.geographySource === "vector" ? config.geoLayer : "");
        const legendCodes = currentData.map(d => d[config.dataIdField]);

        function setLegendHover(range) {
            if (!state.map) return;
            const min = range.min;
            const max = range.max;
            const isLast = range.isLast === true;

            for (const code of legendCodes) {
                const raw = currentRateById ? currentRateById[code] : null;
                const value = (raw === null || typeof raw === 'undefined' || raw === '') ? NaN : +raw;
                const match = Number.isFinite(value) && value >= min && (isLast ? value <= max : value < max);
                state.map.setFeatureState(
                    { source: 'area', sourceLayer: sourceLayerName, id: code },
                    { legendActive: true, legendMatch: match }
                );
            }
        }

        function clearLegendHover() {
            if (!state.map) return;
            for (const code of legendCodes) {
                state.map.setFeatureState(
                    { source: 'area', sourceLayer: sourceLayerName, id: code },
                    { legendActive: false, legendMatch: false }
                );
            }
        }

        state.onLegendRangeHover = setLegendHover;
        state.onLegendRangeLeave = clearLegendHover;

        if (state.pymChild) state.pymChild.sendHeight();

    })
}


export function detectValueColumns(csv) {
    if (!csv || !csv.columns) return [];
    return csv.columns.filter(col => col !== config.dataIdField && col !== config.geoNameField && col.toLowerCase() !== config.dataNameField);
}

export function addDatasetSwitchButtons(data, state, keyscale) {
    const mapWrapper = document.getElementById('mapwrapper') || document.body;

    let container = document.getElementById('dataset-switch-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'dataset-switch-container';
        container.style = 'margin: 10px 0 10px 0;';

        if (mapWrapper === document.body) {
            document.body.insertBefore(container, document.body.firstChild);
        } else {
            mapWrapper.parentNode.insertBefore(container, mapWrapper);
        }
    }

    if (state.valueColumns.length <= 1) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = '';

    const fieldset = document.createElement('fieldset');
    fieldset.className = 'dataset-switch-fieldset';
    fieldset.style = 'border: none; padding: 0; margin: 0;';
    fieldset.setAttribute('role', 'radiogroup');

    const legend = document.createElement('legend');
    legend.textContent = 'Select data variable';
    fieldset.appendChild(legend);

    const buttonsWrapper = document.createElement('div');
    buttonsWrapper.id = 'dataset-switch-buttons';
    buttonsWrapper.className = 'dataset-switch-buttons';

    const groupName = 'dataset-switch-group';

    state.valueColumns.forEach((col, idx) => {
        const id = `dataset-switch-${idx}`;

        const wrapper = document.createElement('div');
        wrapper.className = 'dataset-switch-option';
        wrapper.style = 'display: flex; align-items: center; gap: 6px;';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = groupName;
        radio.id = id;
        radio.value = col;
        radio.checked = col === state.selectedValueColumn;

        const label = document.createElement('label');
    label.className = 'dataset-switch-button';
        label.setAttribute('for', id);
        label.style = 'font-size: 15px; cursor: pointer;';

    const labelText = document.createElement('span');
    labelText.className = 'dataset-switch-button-text';
    labelText.textContent = col;
    label.appendChild(labelText);

        // Mark label as selected if its radio is initially checked
        if (radio.checked) {
            label.classList.add('selected');
        }

        // Handle change
        radio.addEventListener('change', () => {
            if (state.selectedValueColumn !== col) {
                state.selectedValueColumn = col;

                // Remove "selected" from all labels in this group
                buttonsWrapper.querySelectorAll('label').forEach(l =>
                    l.classList.remove('selected')
                );

                // Add "selected" to the clicked one
                label.classList.add('selected');

                updateDataset(keyscale, data, state);
            }
        });

        wrapper.appendChild(radio);
        wrapper.appendChild(label);
        buttonsWrapper.appendChild(wrapper);
    });

    fieldset.appendChild(buttonsWrapper);
    container.appendChild(fieldset);
}




export function setupDatasetSwitch(csv, state, keyscale) {
    state.valueColumns = detectValueColumns(csv);
    state.selectedValueColumn = state.valueColumns[0];
    addDatasetSwitchButtons(csv, state, keyscale);
}

export function redrawMapFill(data, rateById, colour, state) {
    if (!state.map || !data || !colour || !config.dataIdField) return;
    if (!state.map.isStyleLoaded()) {
        state.map.once('load', () => redrawMapFill(data, rateById, colour, state));
        return;
    }
    if (!state.map.getSource('area')) {
        state.map.once('load', () => redrawMapFill(data, rateById, colour, state));
        return;
    }
    data.forEach(d => {
        const code = d[config.dataIdField];
        const raw = rateById[code];
        const value = (raw === null || typeof raw === 'undefined' || raw === '') ? NaN : +raw;
        const hasData = Number.isFinite(value);
        const unavailableColour = getConfigValue('colourUnavailable', state) ?? config.colourUnavailable ?? ONScolours.noData;
        const fillColor = hasData ? colour(value) : unavailableColour;
        state.map.setFeatureState(
            { source: 'area', sourceLayer: (state.geographySource === "vector" ? config.geoLayer : ""), id: code },
            { value: hasData ? value : null, color: fillColor }
        );
    });
}

export function redeclareMouseEvents(rateById, state) {
    state.map.on('mousemove', 'area', (e) => {
        const feature = e.features && e.features[0];
        if (!feature || !feature.properties) return;

        const areaName = feature.properties[config.geoNameField];
        const hoveredCode = feature.properties[config.geoIdField];
        const value = rateById[hoveredCode];

        const showSelectedIndicatorIfNeeded = () => {
            const isHoveringSelected = !!(state.selectedAreaCode && hoveredCode && state.selectedAreaCode === hoveredCode);
            if (state.selectedAreaCode && !isHoveringSelected) {
                const selectedVal = rateById[state.selectedAreaCode];
                window.moveKeyIndicatorSelected(selectedVal);
            } else {
                window.moveKeyIndicatorSelected(undefined);
            }
        };

        // Always show hover info if hovering, but if an area is selected, show faded indicator for it
        if (typeof value !== 'undefined' && value !== null && !isNaN(value)) {
            window.moveKeyIndicator(value);
            showSelectedIndicatorIfNeeded();
            updateKeyInfo(value, areaName, state);
        } else {
            // Value is missing, show unavailable message
            window.moveKeyIndicator(undefined);
            showSelectedIndicatorIfNeeded();
            updateKeyInfo(undefined, areaName, state);
        }
    });
    state.map.on('click', 'area', (e) => {
        const areaName = e.features[0].properties[config.geoNameField];

        const value = rateById[e.features[0].properties[config.geoIdField]];
        // window.moveKeyIndicator(undefined);
        window.moveKeyIndicatorSelected(value);
        // Show explainer for selected area
        updateKeyInfo(value, areaName, state);

    })
}

function restoreKeyInfoAfterDatasetSwitch(rateById, areaById, state) {
    if (state.selectedAreaCode) {
        const selectedAreaName = areaById[state.selectedAreaCode] || state.selectedAreaName || null;
        const rawSelectedValue = rateById[state.selectedAreaCode];
        const hasSelectedValue = rawSelectedValue !== null && typeof rawSelectedValue !== 'undefined' && rawSelectedValue !== '' && !isNaN(+rawSelectedValue);
        const selectedValue = hasSelectedValue ? +rawSelectedValue : undefined;

        if (window.moveKeyIndicator) window.moveKeyIndicator(undefined);
        if (window.moveKeyIndicatorSelected) window.moveKeyIndicatorSelected(selectedValue);
        updateKeyInfo(selectedValue, selectedAreaName, state);
        return;
    }

    if (window.moveKeyIndicator) window.moveKeyIndicator(undefined);
    if (window.moveKeyIndicatorSelected) window.moveKeyIndicatorSelected(undefined);
    updateKeyInfo(undefined, undefined, state);
}

export function updateDataset(keyscale, data, state) {
    const { rateById: nextRateById, areaById: nextAreaById } = buildValueAndAreaLookups(data, config, state)

    // Keep object identity stable so existing map event handlers (closures) keep working.
    const rateById = state.rateById || (state.rateById = {});
    const areaById = state.areaById || (state.areaById = {});
    for (const k of Object.keys(rateById)) delete rateById[k];
    for (const k of Object.keys(areaById)) delete areaById[k];
    Object.assign(rateById, nextRateById);
    Object.assign(areaById, nextAreaById);

    let palette = getPalette(config, state);
    let breaks = getBreaks(config, data, palette, state)
    let colour = d3.scaleThreshold()
        .domain(breaks.slice(1))
        .range(palette);

    // Persist for resize/redraw handlers in templates.
    if (state) {
        state.breaks = breaks;
        state.colour = colour;
    }

    drawKeyScale({ keyscale, breaks, colour, config, window, state });
    redrawMapFill(data, rateById, colour, state);
    restoreKeyInfoAfterDatasetSwitch(rateById, areaById, state);
}
// helpers.js (example structure)

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

 // Function to get postcode list from postcodes.io autocomplete
export async function fetchPostcodes(query) {
	const url = `https://api.postcodes.io/postcodes/${query}/autocomplete`;
	try {
		const json = await (await fetch(url)).json();
		return json.result || [];
	} catch {
		console.log("Failed to fetch postcodes");
	}
}

export function getElementHeightById(id){
    const element = document.getElementById(id);
    return element ? element.getBoundingClientRect().height : 0;
}

/**
 * Sets the value of the autocomplete input and updates its state.
 * @param {string} value - The text to set.
 */
export async function setSearchText(value) {
	const searchBox = document.getElementById('search-box');
	const searchDropdown = document.getElementById('search-box__listbox');
	if (searchBox && searchDropdown) {
		searchDropdown.style.visibility = "hidden";
		searchBox.value = value || "";
		await sleep(110);
		searchBox.focus({ preventScroll: true });
		searchBox.blur();
		searchDropdown.style.visibility = "visible";
	}
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
    let lons = coords.map(c => c[0]);
    let lats = coords.map(c => c[1]);
    let minLon = Math.min(...lons), maxLon = Math.max(...lons);
    let minLat = Math.min(...lats), maxLat = Math.max(...lats);
    return [[minLon, minLat], [maxLon, maxLat]];
}


export function calculateZoomPadding(map, keyOverlayId = 'keycontainer', padPercent = 0.3) {
    const mapCanvas = map.getContainer();
    const mapWidth = mapCanvas.offsetWidth;
    const mapHeight = mapCanvas.offsetHeight;
    const padX = Math.round(mapWidth * padPercent);
    const padY = Math.round(mapHeight * padPercent);
    const keyPad = getElementHeightById(keyOverlayId);
    return { top: padY, bottom: padY + keyPad, left: padX, right: padX };
}

export function getLegendDecimals(format) {
    const match = format && format.match(/\.([0-9]+)/);
    return match ? parseInt(match[1], 10) : 0;
}

export function calculateBreaks(values, method, numClasses, decimals) {
    if (method === 'equal') {
        const min = d3.min(values), max = d3.max(values);
        return Array.from({length: numClasses + 1}, (_, i) => {
            const val = min + i * (max - min) / numClasses;
            return +val.toFixed(decimals);
        });
    } else if (method === 'jenks' && typeof ss !== 'undefined') {
        const sorted = values.filter(v => !isNaN(v)).sort(d3.ascending);
        let clusters = ss.ckmeans(sorted, numClasses);
        let breaks = [];
        clusters.forEach((cluster, i) => {
            if (i < numClasses - 1) {
                breaks.push(+cluster[0].toFixed(decimals));
            } else {
                breaks.push(+cluster[0].toFixed(decimals));
                breaks.push(+cluster[cluster.length - 1].toFixed(decimals));
            }
        });
        return breaks;
    }
    return null;
}

export function buildAreaLookups(features, geoIdField, geoNameField) {
    const areaNames = [];
    const areaNameToCode = {};
    const areaCodeToFeature = {};

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

export function clearAreaSelection(map, geographySource, geoLayer, hoveredAreaCode, selectedAreaCode) {
    if (hoveredAreaCode) {
        map.setFeatureState({ 
            source: 'area', 
            sourceLayer: (geographySource === "vector" ? geoLayer : ""), 
            id: hoveredAreaCode 
        }, { hovered: false });
    }
    if (selectedAreaCode) {
        map.setFeatureState({ 
            source: 'area', 
            sourceLayer: (geographySource === "vector" ? geoLayer : ""), 
            id: selectedAreaCode 
        }, { selected: false });
    }
    if (map.getCanvas) map.getCanvas().style.cursor = '';
    if (window.moveKeyIndicator) window.moveKeyIndicator(undefined);
    if (window.moveKeyIndicatorSelected) window.moveKeyIndicatorSelected(undefined);
}

export function setAreaFeatureState(map, geographySource, geoLayer, areaCode, state) {
    if (!map || !map.setFeatureState) return;
    map.setFeatureState({ 
        source: 'area', 
        sourceLayer: (geographySource === "vector" ? geoLayer : ""), 
        id: areaCode 
    }, state);
}

// export function loadGeography(url) { ... }
// export function loadData(url) { ... }

// export function computeEqualBreaks(values, n, decimals) { ... }
// export function computeJenksBreaks(values, n) { ... }
// export function getBreaks(config, data, field, palette, decimals) { ... }
// export function createColourScale(palette, breaks) { ... }

// export function buildLookup(data, keyField, valueField) { ... }
// export function buildAreaNameIndex(data, idField, nameField) { ... }
// export function buildValueIndex(data, idField, valueField) { ... }

// export function getKeyOverlayHeight() { ... }
// export function updateKeyInfo(name, value) { ... }
// export function setSearchText(text) { ... }
// export function debounce(fn, ms) { ... }

// export function addMapHoverEvents(map, layerName, handlers) { ... }
// export function addMapClickEvents(map, layerName, handlers) { ... }

// export function formatNumber(value, decimals) { ... }
// export function formatPercentage(value) { ... }
import { initialise, addSource } from "../lib/helpers.js";
import { detectGeographySource, fetchPostcodes, getElementHeightById, setSearchText, pointInPolygon, yearFilter, collectCoords, calculateBounds, calculateZoomPadding, getLegendDecimals, calculateBreaks, buildValueAndAreaLookups, getPalette, convertTopoJSONtoGeojson, setupSearch, updateKeyInfo } from "../lib-maps/map-helpers.js";
import { drawKeyScale } from "./legend.js";

let pymChild = null;

let map;
let hoveredAreaCode = null; // Track hovered area code
let selectedAreaCode = null; // Track selected area code
let selectedAreaName = null; // Track selected area name

let geographySource = detectGeographySource(config.geoUrl);

const keyscale = d3.select('#keyscale');
const graphic = d3.select('#graphic');

console.log('Geography source type:', geographySource);



// --- Autocomplete and search logic ---











// Clear info on load
updateKeyInfo(undefined, undefined);

graphic.style('width', '100%')
	.style('height', config.mapHeight || '650px')
	.style('max-width', '800px');

function drawMap(rateById, areaById, colour, data, breaks, areas) {
	//Initialise for pym, not sure if it should go here, just copied from drawGraphic() on other templates
	const size = initialise();

	// Calculate bottom padding for overlay
	const bottomPad = getElementHeightById('keycontainer') + 85; // extra for spacing

	// Set up source text
	addSource('source', config.sourceText || 'Office for National Statistics.');

	// Set up Maplibre GL map
	map = new maplibregl.Map({
		container: 'graphic',
		style: 'style.json',
		cooperativeGestures: config.scrollZoomGuard || false,
		minZoom: config.minZoom || 3.5,
		maxZoom: config.maxZoom || 13,
		bounds: config.mapBounds, // UK bounds
		maxBounds: config.maxBounds || undefined,
		fitBoundsOptions: { padding: { top: 10, left: 10, right: 10, bottom: bottomPad } },
		attributionControl: false,
	});

	// Build area search index after geojson is loaded
	// setupAreaSearchIndex(areas);

	// Draw the key scale
	drawKeyScale({ keyscale, breaks, colour, config, window });

	// Add search box (requires search index)
	setupSearch(areas,config, hoveredAreaCode, selectedAreaName, selectedAreaCode, rateById, areaById ,map, geographySource)

	// Add area source and layer, and fit bounds with bottom padding after map and overlay are rendered
	map.on('load', () => {

		if (geographySource === "vector") {

			map.addSource('area', { type: 'vector', tiles: [config.geoUrl], promoteId: { [config.geoLayer]: config.geoIdField } });

		} else {

			map.addSource('area', { type: 'geojson', data: areas, promoteId: config.geoIdField });

		}

		data.forEach(d => {
			const fillColor = colour(d.value);
			map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: d[config.dataIdField] }, { value: d.value, color: fillColor });
		})

		map.addLayer({
			id: 'area',
			type: 'fill',
			source: 'area',
			"source-layer": geographySource === "vector" ? config.geoLayer : "",
			layout: {},
			paint: {
				'fill-color': ['feature-state', 'color'],
				'fill-opacity': config.fillOpacity || 0.8,
				'fill-outline-color': ONScolours.grey100
			}
		}, 'place_town');

		// Add hover layer
		map.addLayer({
			id: 'area-hover',
			type: 'line',
			source: 'area',
			"source-layer": geographySource === "vector" ? config.geoLayer : "",
			layout: {},
			paint: {
				'line-color': '#000',
				'line-width': 2,
				'line-opacity': [
					'case',
					['==', ['feature-state', 'hovered'], true], 1, 0],
			}
		});

		// Add selected border layer (below hover)
		map.addLayer({
			id: 'area-selected',
			type: 'line',
			source: 'area',
			"source-layer": geographySource === "vector" ? config.geoLayer : "",
			layout: {},
			paint: {
				'line-color': '#000',
				'line-width': 2,
				'line-opacity': ['case', ['==', ['feature-state', 'selected'], true], 0.4, 0],
			}
		}, 'area-hover');

		//Get current year for attributions
		let today = new Date();
		map.getSource('area').attribution = "Contains OS data &copy; Crown copyright and database right " + today.getFullYear();

		// Interactivity
		map.on('mousemove', 'area', (e) => {
			map.getCanvas().style.cursor = 'pointer';
			const code = e.features[0].properties[config.geoIdField];

			// Remove hover state from previous feature
			if (hoveredAreaCode && hoveredAreaCode !== code) {
				map.setFeatureState({
					source: 'area',
					sourceLayer: (geographySource === "vector" ? geoLayer : ""),
					id: hoveredAreaCode
				}, { hovered: false });
			}
			hoveredAreaCode = code;

			map.setFeatureState({
				source: 'area',
				sourceLayer: (geographySource === "vector" ? geoLayer : ""),
				id: hoveredAreaCode
			}, { hovered: true });
			const areaName = e.features[0].properties[config.geoNameField];
			const value = rateById[e.features[0].properties[config.geoIdField]];

			// Always show hover info if hovering, but if an area is selected, show faded indicator for it
			if (typeof value !== 'undefined' && value !== null && !isNaN(value)) {
				window.moveKeyIndicator(value);
				if (selectedAreaCode && selectedAreaCode !== code) {
					const selectedVal = rateById[selectedAreaCode];
					window.moveKeyIndicatorSelected(selectedVal);
				} else {
					window.moveKeyIndicatorSelected(undefined);
				}
				updateKeyInfo(value, areaName);
			} else {
				// Value is missing, show unavailable message
				window.moveKeyIndicator(undefined);
				if (selectedAreaCode && selectedAreaCode !== code) {
					const selectedVal = rateById[selectedAreaCode];
					window.moveKeyIndicatorSelected(selectedVal);
				} else {
					window.moveKeyIndicatorSelected(undefined);
				}
				updateKeyInfo(undefined, areaName);
			}
		});
		map.on('mouseleave', 'area', () => {
			map.getCanvas().style.cursor = '';
			if (hoveredAreaCode) {
				map.setFeatureState({
					source: 'area',
					sourceLayer: (geographySource === "vector" ? geoLayer : ""),
					id: hoveredAreaCode
				}, { hovered: false });
				hoveredAreaCode = null;
			}
			// If an area is selected, show its info and indicator; otherwise clear
			if (selectedAreaCode) {
				const selectedVal = rateById[selectedAreaCode];
				window.moveKeyIndicator(undefined);
				window.moveKeyIndicatorSelected(selectedVal);
				updateKeyInfo(selectedVal, areaById[selectedAreaCode]);
			} else {
				window.moveKeyIndicator(undefined);
				window.moveKeyIndicatorSelected(undefined);
				updateKeyInfo(undefined, undefined);
			}
		});
		map.on('click', 'area', (e) => {
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
			if (selectedAreaCode && selectedAreaCode !== code) {
				map.setFeatureState({
					source: 'area',
					sourceLayer: (geographySource === "vector" ? geoLayer : ""),
					id: selectedAreaCode
				}, { selected: false });
			}
			selectedAreaCode = code;
			selectedAreaName = areaName;
			map.setFeatureState({
				source: 'area',
				sourceLayer: (geographySource === "vector" ? geoLayer : ""),
				id: selectedAreaCode
			}, { selected: true });			// Remove hover state (if any)
			if (hoveredAreaCode) {
				map.setFeatureState({
					source: 'area',
					sourceLayer: (geographySource === "vector" ? geoLayer : ""),
					id: hoveredAreaCode
				}, { hovered: false });
				hoveredAreaCode = null;
			}
			// Show faded indicator for selected, hide hover indicator
			const selectedVal = rateById[e.features[0].properties[config.geoIdField]];
			window.moveKeyIndicator(undefined);
			window.moveKeyIndicatorSelected(selectedVal);
			// Show explainer for selected area
			updateKeyInfo(selectedVal, areaName);

			// --- Zoom to area bounds (40% of map, centered on unobscured area) ---
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
					const padding = calculateZoomPadding(map);
					const options = {
						padding,
						animate: true
					};

					map.fitBounds(bounds, options);

				}
			}
		});

		// Provide a getPadding function to dynamically calculate padding (including keycontainer height)
		const zoomhome = new MapLibreControlZoomHome({
			resetBounds: config.mapBounds,
			getPadding: function () {
				let bottomPad = 10;
				const keycontainer = document.getElementById('keycontainer');
				if (keycontainer) {
					bottomPad += keycontainer.getBoundingClientRect().height || 0;
				}
				return { top: 10, left: 10, right: 10, bottom: bottomPad };
			},
			onReset: function () {
				// Clear selected area and info
				if (typeof map !== 'undefined' && map !== null) {
					if (selectedAreaCode) {
						map.setFeatureState({
							source: 'area',
							sourceLayer: (geographySource === "vector" ? geoLayer : ""),
							id: selectedAreaCode
						}, { selected: false });
					}
					selectedAreaCode = null;
					selectedAreaName = null;
					if (window.moveKeyIndicator) window.moveKeyIndicator(undefined);
					if (window.moveKeyIndicatorSelected) window.moveKeyIndicatorSelected(undefined);
					// Always clear explainer and value immediately
					updateKeyInfo(undefined, undefined);
					// Reset search box to placeholder
					setSearchText("");
				}
			}
		});

		// Add navigation and attribution controls after fitting bounds

		//add compact attribution
		map.addControl(new maplibregl.AttributionControl({
			compact: false
		}), 'bottom-right');

		map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
		map.dragRotate.disable();
		map.touchZoomRotate.disableRotation();
		// map.addControl(new maplibregl.GeolocateControl({
		// 	positionOptions: {
		// 		enableHighAccuracy: true
		// 	}
		// }));
		map.addControl(zoomhome, 'top-right');



		// Send height for pym
		if (pymChild) pymChild.sendHeight();
	});
}

function setupData() {

	Promise.all([
		d3.csv(config.dataUrl),
		geographySource === "vector" ? null : d3.json(config.geoUrl || "../lib-maps/master-topo.json")
	]).then(([csv, geog]) => {
		const data = csv;
		let areas = geog;

		areas = convertTopoJSONtoGeojson(areas,geographySource)

		// Set up value lookup and breaks
		const { rateById, areaById } = buildValueAndAreaLookups(data, config)

		// Calculate breaks and colour scale
		let breaks;
		let palette = getPalette(config);
		const legendDecimals = getLegendDecimals(config.legendFormat || ',.2f');
		if (Array.isArray(config.breaks)) {
			breaks = config.breaks;
		} else {
			breaks = calculateBreaks(data.map(d => +d.value).filter(v => !isNaN(v)).sort(d3.ascending), config.breaks, palette.length, legendDecimals)
		}
		const colour = d3.scaleThreshold()
			.domain(breaks.slice(1))
			.range(palette);

		drawMap(rateById, areaById, colour, data, breaks, areas);

	});
}

// Initialise pym and load data
window.onload = () => {
	pymChild = new pym.Child({ renderCallback: setupData });
};
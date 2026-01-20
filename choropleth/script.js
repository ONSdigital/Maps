import { initialise, addSource } from "../lib/helpers.js";
import { detectGeographySource, getLegendDecimals, calculateBreaks, buildValueAndAreaLookups, getPalette, convertTopoJSONtoGeojson, setupSearch, updateKeyInfo, setupMap } from "../lib-maps/map-helpers.js";
import { drawKeyScale } from "../lib-maps/legend.js";

const state = {
	map: null,
	hoveredAreaCode: null,
	selectedAreaCode: null,
	selectedAreaName: null,
	geographySource: detectGeographySource(config.geoUrl),
	pymChild: null,
};

const keyscale = d3.select('#keyscale');
const graphic = d3.select('#graphic');

// Clear info on load
updateKeyInfo(undefined, undefined, state);

graphic.style('width', '100%')
	.style('height', config.mapHeight || '650px')
	.style('max-width', '800px');

function drawMap(rateById, areaById, colour, data, breaks, areas) {
	//Initialise for pym, not sure if it should go here, just copied from drawGraphic() on other templates
	const size = initialise();

	// Set up source text
	addSource('source', config.sourceText || 'Office for National Statistics.');

	// Set up Maplibre GL map
	state.map = new maplibregl.Map({
		container: 'graphic',
		style: '../lib-maps/style.json',
		cooperativeGestures: config.scrollZoomGuard || false,
		minZoom: config.minZoom || 3.5,
		maxZoom: config.maxZoom || 13,
		bounds: config.mapBounds, // UK bounds
		maxBounds: config.maxBounds || undefined,
		fitBoundsOptions: { padding: { top: 20, left: 10, right: 10, bottom: 20 } },
		attributionControl: false,
	});

	// Draw the key scale
	drawKeyScale({ keyscale, breaks, colour, config, window });

	// adds map and interactivity
	setupMap(config, data, rateById, areaById, areas, colour, state)
}

function setupData() {

	Promise.all([
		d3.csv(config.dataUrl),
		state.geographySource === "vector" ? null : d3.json(config.geoUrl || "../lib-maps/master-topo.json")
	]).then(([csv, geog]) => {
		const data = csv;
		let areas = geog;

		areas = convertTopoJSONtoGeojson(areas, state.geographySource)

		// Set up value lookup and breaks
		const { rateById, areaById } = buildValueAndAreaLookups(data, config, state)

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

		// Add search box
		setupSearch(areas, config, state, rateById, areaById)

		drawMap(rateById, areaById, colour, data, breaks, areas);

	}).catch(error => {
		console.error("Fatal error loading map data or geography:", error);
	});
}

// Initialise pym and load data
window.onload = () => {
	state.pymChild = new pym.Child({ renderCallback: setupData });
};
import { initialise, addSource } from "../lib/helpers.js";
import { drawKeyScale } from "../lib-maps/legend.js";
import { convertTopoJSONtoGeojson, detectGeographySource, setupSearch, buildValueAndAreaLookups, getPalette, getElementHeightById, setupMap, getBreaks, updateKeyInfo, setupDatasetSwitch, updateDataset, redrawMapFill} from "../lib-maps/map-helpers.js";

const state = {
	map: null,
	hoveredAreaCode: null,
	selectedAreaCode: null,
	selectedAreaName: null,
	geographySource: null,
	pymChild: null,
	selectedValueColumn: 0,
	valueColumns: []
};

const graphic = d3.select('#graphic');
const keyscale = d3.select('#keyscale');

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
		fitBoundsOptions: { padding: { top: 10, left: 10, right: 10, bottom: 20 } },
		attributionControl: false,
	});
	// Draw the key scale
	drawKeyScale({ keyscale, breaks, colour, config, window, state });

	setupMap(config, data, rateById, areaById, areas, colour, state);

	updateKeyInfo(undefined, undefined, state);
}

async function setupData() {
	const geoUrl = config.geoUrl || "../lib-maps/master-topo.json";
	state.geographySource = await detectGeographySource(geoUrl);
	Promise.all([
		d3.csv(config.dataUrl),
		state.geographySource === "vector" ? null : d3.json(geoUrl)
	]).then(([csv, geog]) => {
		const data = csv;
		let areas = geog;

		setupDatasetSwitch(data, state, keyscale);

		areas = convertTopoJSONtoGeojson(areas, state.geographySource)

		const { rateById, areaById } = buildValueAndAreaLookups(data, config, state)
		state.rateById = rateById;
		state.areaById = areaById;

		let palette = getPalette(config, state);
		let breaks = getBreaks(config, data, palette, state);
		
		const colour = d3.scaleThreshold()
			.domain(breaks.slice(1))
			.range(palette);

		setupSearch(areas,config,state,rateById,areaById)	

		drawMap(rateById, areaById, colour, data, breaks, areas);
	});
}

// Initialise pym and load data
window.onload = () => {
	state.pymChild = new pym.Child({ renderCallback: setupData });
};
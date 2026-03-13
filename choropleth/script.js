import { initialise, addSource } from "../lib/helpers.js";
import { detectGeographySource, getLegendDecimals, calculateBreaks, buildValueAndAreaLookups, getPalette, convertTopoJSONtoGeojson, setupSearch, updateKeyInfo, setupMap, resolveAutoMapBounds, validateBreaksArray } from "../lib-maps/map-helpers.js";
import { drawKeyScale } from "../lib-maps/legend.js";

const state = {
	map: null,
	hoveredAreaCode: null,
	selectedAreaCode: null,
	selectedAreaName: null,
	geographySource: null,
	pymChild: null,
	// cached data for redraw/resize
	data: null,
	areas: null,
	rateById: null,
	areaById: null,
	breaks: null,
	colour: null,
	__started: false,
};

const keyscale = d3.select('#keyscale');
const graphic = d3.select('#graphic');

// Clear info on load
updateKeyInfo(undefined, undefined, state);

graphic.style('width', '100%')
	.style('height', config.mapHeight || '650px')
	.style('max-width', '800px');

function createMap() {
	// Initialise once (clears any fallback markup and sets accessible summary)
	initialise();

	// Set up source text
	addSource('source', config.sourceText || 'Office for National Statistics.');

	// If we ever re-create the map (e.g. hot reload), clean up first.
	if (state.map && typeof state.map.remove === 'function') {
		try { state.map.remove(); } catch (e) { /* ignore */ }
		state.map = null;
	}

	state.map = new maplibregl.Map({
		container: 'graphic',
		style: '../lib-maps/style.json',
		cooperativeGestures: config.scrollZoomGuard || false,
		minZoom: config.minZoom || 3.5,
		maxZoom: config.maxZoom || 13,
		bounds: config.mapBounds,
		maxBounds: config.maxBounds || undefined,
		fitBoundsOptions: { padding: { top: 20, left: 10, right: 10, bottom: 20 } },
		attributionControl: false,
	});

	if (state.breaks && state.colour) {
		drawKeyScale({ keyscale, breaks: state.breaks, colour: state.colour, config, window, state });
	}

	if (state.data && state.rateById && state.areaById) {
		setupMap(config, state.data, state.rateById, state.areaById, state.areas, state.colour, state);
	}
}

function onResize() {
	// Redraw legend width and ensure the map canvas matches its container.
	if (state.breaks && state.colour) {
		drawKeyScale({ keyscale, breaks: state.breaks, colour: state.colour, config, window, state });
	}
	if (state.map && typeof state.map.resize === 'function') {
		try { state.map.resize(); } catch (e) { /* ignore */ }
	}
	if (state.pymChild && typeof state.pymChild.sendHeight === 'function') {
		state.pymChild.sendHeight();
	}
}

async function setupOnce() {
	const geoUrl = config.geoUrl || "../lib-maps/master-topo.json";
	state.geographySource = await detectGeographySource(geoUrl);

	try {
		const [csv, geog] = await Promise.all([
			d3.csv(config.dataUrl),
			state.geographySource === "vector" ? null : d3.json(geoUrl)
		]);

		state.data = csv;
		state.areas = convertTopoJSONtoGeojson(geog, state.geographySource);
		resolveAutoMapBounds(config, state.areas, state.geographySource);

		const { rateById, areaById } = buildValueAndAreaLookups(state.data, config, state);
		state.rateById = rateById;
		state.areaById = areaById;

		let palette = getPalette(config);
		const legendDecimals = getLegendDecimals(config.legendFormat || ',.2f');
		if (Array.isArray(config.breaks)) {
			if (validateBreaksArray(config.breaks, 'config.breaks')) {
				state.breaks = config.breaks;
			} else {
				state.breaks = null;
			}
		} else {
			state.breaks = calculateBreaks(
				state.data.map(d => +d.value).filter(v => !isNaN(v)).sort(d3.ascending),
				config.breaks,
				palette.length,
				legendDecimals
			);
		}

		if (Array.isArray(state.breaks) && state.breaks.length > 1) {
			state.colour = d3.scaleThreshold().domain(state.breaks.slice(1)).range(palette);
		} else {
			const fallbackColour = (config && config.colourUnavailable)
				|| (typeof ONScolours !== 'undefined' ? ONScolours.noData : '#ccc');
			state.colour = d3.scaleThreshold().domain([]).range([fallbackColour]);
		}

		setupSearch(state.areas, config, state, state.rateById, state.areaById);
		createMap();
		onResize();
	} catch (error) {
		console.error("Fatal error loading map data or geography:", error);
	}
}

function startOnce() {
	if (state.__started) return;
	state.__started = true;
	setupOnce();
}

function renderCallback() {
	startOnce();
	// Let layout settle before we measure widths for legend.
	requestAnimationFrame(onResize);
}

// Start as soon as the DOM is ready.
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', startOnce, { once: true });
} else {
	startOnce();
}

// Hook pym (when embedded) for resize callbacks.
window.addEventListener('load', () => {
	if (window.self !== window.top && typeof pym !== 'undefined') {
		state.pymChild = new pym.Child({ renderCallback });
		setTimeout(renderCallback, 250);
	}
});
/**
 * Choropleth (multi-dataset, single time point) template.
 *
 * This template supports multiple value columns inside one CSV. The shared helper
 * `setupDatasetSwitch()` discovers value columns and renders the dataset switch UI.

 */

import { initialise, addSource } from "../lib/helpers.js";
import { drawKeyScale } from "../lib-maps/legend.js";
import { convertTopoJSONtoGeojson, detectAndLoadGeography, setupSearch, buildValueAndAreaLookups, getPalette, getElementHeightById, setupMap, getBreaks, updateKeyInfo, setupDatasetSwitch, updateDataset, redrawMapFill, resolveAutoMapBounds } from "../lib-maps/map-helpers.js";

const state = {
	map: null,
	hoveredAreaCode: null,
	selectedAreaCode: null,
	selectedAreaName: null,
	geographySource: null,
	pymChild: null,
	selectedValueColumn: 0,
	valueColumns: [],
	// cached data for redraw/resize
	data: null,
	areas: null,
	breaks: null,
	colour: null,
	__started: false,
};

const graphic = d3.select('#graphic');
const keyscale = d3.select('#keyscale');

graphic.style('width', '100%')
	.style('height', config.mapHeight || '650px')
	.style('max-width', '800px');

function createMap() {
	initialise();
	addSource('source', config.sourceText || 'Office for National Statistics.');

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
		fitBoundsOptions: { padding: { top: 10, left: 10, right: 10, bottom: 20 } },
		attributionControl: false,
	});

	if (state.breaks && state.colour) {
		drawKeyScale({ keyscale, breaks: state.breaks, colour: state.colour, config, window, state });
	}
	if (state.data && state.rateById && state.areaById) {
		setupMap(config, state.data, state.rateById, state.areaById, state.areas, state.colour, state);
	}

	updateKeyInfo(undefined, undefined, state);
}

function onResize() {
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
	// Detect whether geography is JSON (Topo/Geo) or vector tiles; only JSON sources are fetched as data.
	const geoUrl = config.geoUrl || "../lib-maps/master-topo.json";
	const geo = await detectAndLoadGeography(geoUrl);
	state.geographySource = geo.sourceType;
	if (String(state.geographySource).startsWith('error:')) {
		console.error('Fatal error detecting/loading geography:', state.geographySource);
		return;
	}
	try {
		const csv = await d3.csv(config.dataUrl);
		const geog = geo.data;

		state.data = csv;
		setupDatasetSwitch(state.data, state, keyscale);

		// For vector tiles, this can be null (no full feature geometries loaded client-side).
		state.areas = convertTopoJSONtoGeojson(geog, state.geographySource);
		resolveAutoMapBounds(config, state.areas, state.geographySource);

		const { rateById, areaById } = buildValueAndAreaLookups(state.data, config, state);
		state.rateById = rateById;
		state.areaById = areaById;

		let palette = getPalette(config, state);
		state.breaks = getBreaks(config, state.data, palette, state);
		state.colour = d3.scaleThreshold().domain(state.breaks.slice(1)).range(palette);

		setupSearch(state.areas, config, state, state.rateById, state.areaById);
		createMap();
		onResize();
	} catch (e) {
		console.error("Fatal error loading map data or geography:", e);
	}
}

function startOnce() {
	if (state.__started) return;
	state.__started = true;
	setupOnce();
}

function renderCallback() {
	startOnce();
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
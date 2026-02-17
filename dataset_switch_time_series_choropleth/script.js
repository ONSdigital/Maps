import { initialise, addSource } from "../lib/helpers.js";
import { drawKeyScale } from "../lib-maps/legend.js";
import {
	calculateBreaks,
	clearAreaSelection,
	convertTopoJSONtoGeojson,
	detectGeographySource,
	getLegendDecimals,
	getPalette,
	resolveAutoMapBounds,
	setupMap,
	setupSearch,
	updateKeyInfo,
	redrawMapFill,
} from "../lib-maps/map-helpers.js";

const state = {
	map: null,
	hoveredAreaCode: null,
	selectedAreaCode: null,
	selectedAreaName: null,
	geographySource: null,
	pymChild: null,
	areasGeojson: null,

	// dataset/time series
	datasetIndex: 0,
	timeColumns: [],
	timeIndex: 0,
	seriesById: {},
	meanSeries: [],
	breaks: null,
	colour: null,
	dataForMap: [],

	// map lookups (mutated in-place so map event handlers stay in sync)
	rateById: {},
	areaById: {},

	// chart
	chart: null,
};

const graphic = d3.select('#graphic');
const keyscale = d3.select('#keyscale');

graphic
	.style('width', '100%')
	.style('height', config.mapHeight || '650px')
	.style('max-width', '800px');

function detectTimeColumns(csv) {
	if (!csv || !csv.columns) return [];
	const exclude = new Set([
		(config.dataIdField || '').toLowerCase(),
		(config.dataNameField || '').toLowerCase(),
		(config.geoNameField || '').toLowerCase(),
		'areacd',
		'areanm',
		'value'
	]);
	return csv.columns.filter(col => !exclude.has(String(col).toLowerCase()));
}

function toNumberOrNull(x) {
	const v = x === '' || x === null || typeof x === 'undefined' ? NaN : +x;
	return Number.isFinite(v) ? v : null;
}

function buildSeriesStore(csv) {
	const timeColumns = detectTimeColumns(csv);
	const seriesById = {};
	const areaById = {};

	for (const row of csv) {
		const code = row[config.dataIdField];
		if (!code) continue;
		const areaName = row[config.dataNameField] || row[config.geoNameField] || '';
		areaById[code] = areaName;
		seriesById[code] = {
			code,
			areaName,
			values: timeColumns.map(c => toNumberOrNull(row[c]))
		};
	}

	const meanSeries = timeColumns.map((t, idx) => {
		let sum = 0;
		let n = 0;
		for (const code of Object.keys(seriesById)) {
			const v = seriesById[code].values[idx];
			if (v === null) continue;
			sum += v;
			n += 1;
		}
		return { t, v: n ? sum / n : null };
	});

	return { timeColumns, seriesById, areaById, meanSeries };
}

function updateRateByIdForTime() {
	const idx = state.timeIndex;
	const rateById = state.rateById;
	// clear existing keys (keep same object reference)
	for (const k of Object.keys(rateById)) delete rateById[k];
	for (const code of Object.keys(state.seriesById)) {
		rateById[code] = state.seriesById[code].values[idx];
	}
}

function buildDataForMap() {
	const tCol = state.timeColumns[state.timeIndex];
	state.dataForMap = Object.keys(state.seriesById).map(code => {
		return {
			[config.dataIdField]: code,
			[config.dataNameField]: state.seriesById[code].areaName,
			value: state.rateById[code],
			__time: tCol,
		};
	});
}

function computeBreaksForDataset() {
	const palette = getPalette(config, { valueColumns: [], selectedValueColumn: null });
	const legendDecimals = getLegendDecimals(config.legendFormat || ',.2f');
	let breaks;

	if (Array.isArray(config.breaks)) {
		// For time-series template we only support single breaks definition; take the first entry
		breaks = config.breaks[0];
	} else {
		breaks = config.breaks;
	}

	if (Array.isArray(breaks)) {
		state.breaks = breaks;
		state.colour = d3.scaleThreshold().domain(breaks.slice(1)).range(palette);
		return;
	}

	const numClasses = Array.isArray(palette) ? palette.length : (config.breaksNumber || 5);

	if ((config.timeBreaksMode || 'fixed') === 'perTime') {
		// Will be recomputed on each time change
		state.breaks = null;
		state.colour = d3.scaleThreshold().range(palette);
		return;
	}

	// Fixed across all time points (recommended)
	const values = [];
	for (const code of Object.keys(state.seriesById)) {
		for (const v of state.seriesById[code].values) {
			if (v === null) continue;
			values.push(v);
		}
	}
	values.sort(d3.ascending);
	const calculated = calculateBreaks(values, breaks, numClasses, legendDecimals);
	state.breaks = calculated;
	state.colour = d3.scaleThreshold().domain(calculated.slice(1)).range(palette);
}

function ensureBreaksAndLegend() {
	if ((config.timeBreaksMode || 'fixed') === 'perTime') {
		const palette = state.colour.range();
		const legendDecimals = getLegendDecimals(config.legendFormat || ',.2f');
		const method = Array.isArray(config.breaks) ? config.breaks[0] : config.breaks;
		const values = Object.values(state.rateById).filter(v => v !== null && Number.isFinite(v)).sort(d3.ascending);
		const numClasses = Array.isArray(palette) ? palette.length : (config.breaksNumber || 5);
		const calculated = Array.isArray(method) ? method : calculateBreaks(values, method, numClasses, legendDecimals);
		state.breaks = calculated;
		state.colour.domain(calculated.slice(1));
	}

	drawKeyScale({ keyscale, breaks: state.breaks, colour: state.colour, config, window, state });
}

function setTimelineUI() {
	const slider = document.getElementById('timeline-slider');
	const label = document.getElementById('timeline-label');
	if (!slider || !label) return;

	slider.min = '0';
	slider.max = String(Math.max(0, state.timeColumns.length - 1));
	slider.step = '1';
	slider.value = String(state.timeIndex);
	label.textContent = state.timeColumns[state.timeIndex] || '';
}

function setTimeIndex(nextIndex) {
	const clamped = Math.max(0, Math.min(nextIndex, state.timeColumns.length - 1));
	state.timeIndex = clamped;
	setTimelineUI();

	updateRateByIdForTime();
	buildDataForMap();
	ensureBreaksAndLegend();
	redrawMapFill(state.dataForMap, state.rateById, state.colour, state);

	// Keep selected/hover info in sync
	if (state.selectedAreaCode) {
		const v = state.rateById[state.selectedAreaCode];
		if (window.moveKeyIndicatorSelected) window.moveKeyIndicatorSelected(v);
		updateKeyInfo(v, state.selectedAreaName || state.areaById[state.selectedAreaCode], state);
	}

	updateChart();
}

function renderDatasetSwitch() {
	const container = document.getElementById('dataset-switch-container');
	if (!container) return;

	const datasets = Array.isArray(config.datasets) && config.datasets.length ? config.datasets : [{ label: 'Data', url: config.dataUrl }];
	container.innerHTML = '';

	if (datasets.length <= 1) return;

	const fieldset = document.createElement('fieldset');
	fieldset.style = 'border: none; padding: 0; margin: 0;';
	fieldset.setAttribute('role', 'radiogroup');

	const legend = document.createElement('legend');
	legend.textContent = 'Select dataset';
	fieldset.appendChild(legend);

	const buttonsWrapper = document.createElement('div');
	buttonsWrapper.className = 'dataset-switch-buttons';
	const groupName = 'file-switch-group';

	datasets.forEach((ds, idx) => {
		const id = `file-switch-${idx}`;
		const wrapper = document.createElement('div');
		wrapper.style = 'display: flex; align-items: center; gap: 6px;';

		const radio = document.createElement('input');
		radio.type = 'radio';
		radio.name = groupName;
		radio.id = id;
		radio.value = String(idx);
		radio.checked = idx === state.datasetIndex;

		const label = document.createElement('label');
		label.setAttribute('for', id);
		label.textContent = ds.label || ds.url;
		label.style = 'font-size: 15px; cursor: pointer;';
		if (radio.checked) label.classList.add('selected');

		radio.addEventListener('change', async () => {
			if (!radio.checked) return;
			buttonsWrapper.querySelectorAll('label').forEach(l => l.classList.remove('selected'));
			label.classList.add('selected');
			await loadDataset(idx);
		});

		wrapper.appendChild(radio);
		wrapper.appendChild(label);
		buttonsWrapper.appendChild(wrapper);
	});

	fieldset.appendChild(buttonsWrapper);
	container.appendChild(fieldset);
}

function createChart() {
	const container = d3.select('#chart');
	container.html('');

	const width = container.node()?.getBoundingClientRect().width || 800;
	const height = config.chartHeight || 220;
	const margin = { top: 10, right: 20, bottom: 30, left: 50 };
	const innerWidth = Math.max(10, width - margin.left - margin.right);
	const innerHeight = Math.max(10, height - margin.top - margin.bottom);

	const svg = container.append('svg')
		.attr('width', '100%')
		.attr('height', height)
		.attr('viewBox', `0 0 ${width} ${height}`);

	const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

	const x = d3.scalePoint().range([0, innerWidth]).padding(0.5);
	const y = d3.scaleLinear().range([innerHeight, 0]);

	const xAxisG = g.append('g').attr('transform', `translate(0,${innerHeight})`);
	const yAxisG = g.append('g');

	const vline = g.append('line')
		.attr('stroke', '#999')
		.attr('stroke-width', 1)
		.attr('y1', 0)
		.attr('y2', innerHeight)
		.style('opacity', 0);

	const meanPath = g.append('path')
		.attr('fill', 'none')
		.attr('stroke', '#6f6f6f')
		.attr('stroke-width', 1.5)
		.attr('stroke-dasharray', '4 3')
		.style('opacity', 0);

	const areaPath = g.append('path')
		.attr('fill', 'none')
		.attr('stroke', '#206095')
		.attr('stroke-width', 2)
		.style('opacity', 0);

	const marker = g.append('circle')
		.attr('r', 3.5)
		.attr('fill', '#206095')
		.attr('stroke', '#ffffff')
		.attr('stroke-width', 1)
		.style('opacity', 0);

	function update({ timeColumns, areaSeries, meanSeries, timeIndex, areaName }) {
		x.domain(timeColumns);

		const values = [];
		if (areaSeries) values.push(...areaSeries.filter(d => d.v !== null).map(d => d.v));
		if (config.showMeanLine && meanSeries) values.push(...meanSeries.filter(d => d.v !== null).map(d => d.v));
		if (!values.length) {
			// Empty chart state
			xAxisG.call(d3.axisBottom(x).tickValues([]));
			yAxisG.call(d3.axisLeft(y).ticks(4));
			areaPath.style('opacity', 0);
			meanPath.style('opacity', 0);
			marker.style('opacity', 0);
			vline.style('opacity', 0);
			return;
		}

		const extent = d3.extent(values);
		y.domain([extent[0], extent[1]]).nice();

		const tickValues = timeColumns.length > 8
			? timeColumns.filter((_, i) => i % Math.ceil(timeColumns.length / 8) === 0)
			: timeColumns;

		xAxisG.call(d3.axisBottom(x).tickValues(tickValues));
		yAxisG.call(d3.axisLeft(y).ticks(5));

		const line = d3.line()
			.defined(d => d.v !== null)
			.x(d => x(d.t))
			.y(d => y(d.v));

		if (config.showMeanLine && meanSeries) {
			meanPath
				.attr('d', line(meanSeries))
				.style('opacity', 1);
		} else {
			meanPath.style('opacity', 0);
		}

		if (areaSeries) {
			areaPath
				.attr('d', line(areaSeries))
				.style('opacity', 1);
		} else {
			areaPath.style('opacity', 0);
		}

		const t = timeColumns[timeIndex];
		const xPos = x(t);
		if (typeof xPos === 'number') {
			vline.attr('x1', xPos).attr('x2', xPos).style('opacity', 1);
		} else {
			vline.style('opacity', 0);
		}

		if (areaSeries) {
			const point = areaSeries.find(d => d.t === t);
			if (point && point.v !== null && typeof xPos === 'number') {
				marker
					.attr('cx', xPos)
					.attr('cy', y(point.v))
					.style('opacity', 1);
			} else {
				marker.style('opacity', 0);
			}
		} else {
			marker.style('opacity', 0);
		}

		// Title/subtitle are intentionally omitted in the overlay UI.
	}

	return { update };
}

function updateChart() {
	if (!state.chart) state.chart = createChart();
	const timeColumns = state.timeColumns;
	if (!timeColumns.length) {
		state.chart.update({ timeColumns: [], areaSeries: null, meanSeries: null, timeIndex: 0, areaName: null });
		return;
	}

	let areaSeries = null;
	let areaName = null;
	if (state.selectedAreaCode && state.seriesById[state.selectedAreaCode]) {
		const s = state.seriesById[state.selectedAreaCode];
		areaName = s.areaName;
		areaSeries = timeColumns.map((t, idx) => ({ t, v: s.values[idx] }));
	}
	const meanSeries = timeColumns.map((t, idx) => ({ t, v: state.meanSeries[idx]?.v ?? null }));

	state.chart.update({
		timeColumns,
		areaSeries,
		meanSeries,
		timeIndex: state.timeIndex,
		areaName
	});
}

async function loadDataset(datasetIndex) {
	const datasets = Array.isArray(config.datasets) && config.datasets.length ? config.datasets : [{ label: 'Data', url: config.dataUrl }];
	const ds = datasets[datasetIndex] || datasets[0];
	state.datasetIndex = datasetIndex;

	const csv = await d3.csv(ds.url);
	const { timeColumns, seriesById, areaById, meanSeries } = buildSeriesStore(csv);
	state.timeColumns = timeColumns;
	state.seriesById = seriesById;
	state.meanSeries = meanSeries;

	// update areaById in place
	for (const k of Object.keys(state.areaById)) delete state.areaById[k];
	Object.assign(state.areaById, areaById);

	// Initial timeline position: config.startTime if present, otherwise default to last.
	const desired = typeof config.startTime === 'string' ? config.startTime : null;
	const idx = desired ? state.timeColumns.indexOf(desired) : -1;
	state.timeIndex = idx >= 0 ? idx : Math.max(0, state.timeColumns.length - 1);
	updateRateByIdForTime();
	buildDataForMap();
	computeBreaksForDataset();
	setTimelineUI();
	ensureBreaksAndLegend();

	// If map already exists, just recolour. Otherwise initial draw will handle.
	if (state.map) {
		redrawMapFill(state.dataForMap, state.rateById, state.colour, state);
		// If an area is already selected, update info and indicator
		if (state.selectedAreaCode) {
			const v = state.rateById[state.selectedAreaCode];
			if (window.moveKeyIndicatorSelected) window.moveKeyIndicatorSelected(v);
			updateKeyInfo(v, state.selectedAreaName || state.areaById[state.selectedAreaCode], state);
		}
		updateChart();
	}
}

function drawMap(areas) {
	// Initialise for pym
	initialise();
	addSource('source', config.sourceText || 'Office for National Statistics.');

	state.onAreaSelected = ({ code, areaName }) => {
		// state.selectedAreaCode/name are already set by map/search helpers; this ensures chart refreshes
		state.selectedAreaCode = code;
		state.selectedAreaName = areaName;
		setChartOverlayVisible(Boolean(code));

		updateChart();
		if (code) deferFocusSelectedArea();
	};

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

	setupSearch(areas, config, state, state.rateById, state.areaById);
	setupMap(config, state.dataForMap, state.rateById, state.areaById, areas, state.colour, state);

	updateKeyInfo(undefined, undefined, state);
	updateChart();
}

function setupUI() {
	renderDatasetSwitch();
	setTimelineUI();
	setupChartOverlayUI();

	const slider = document.getElementById('timeline-slider');
	if (slider) {
		slider.addEventListener('input', () => {
			setTimeIndex(+slider.value);
		});
	}

	// Keep chart responsive
	window.addEventListener('resize', () => {
		state.chart = null;
		updateChart();
		if (state.selectedAreaCode) deferFocusSelectedArea();
	});
}

function setupChartOverlayUI() {
	const closeBtn = document.getElementById('chart-overlay-close');
	if (closeBtn) {
		closeBtn.addEventListener('click', () => {
			// Overlay should only be closed when there's no selected area.
			// So this button clears the current selection.
			if (state.selectedAreaCode) {
				clearAreaSelection(state, config.geoLayer);
			} else {
				setChartOverlayVisible(false);
			}
		});
	}

	setChartOverlayVisible(false);
}

function setChartOverlayVisible(visible) {
	const overlay = document.getElementById('chart-overlay');
	if (!overlay) return;
	const show = Boolean(visible);
	overlay.classList.toggle('hidden', !show);
	overlay.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function getChartOverlayPadding() {
	const overlay = document.getElementById('chart-overlay');
	if (!overlay || overlay.classList.contains('hidden')) {
		return { top: 10, right: 10, bottom: 20, left: 10 };
	}
	const rect = overlay.getBoundingClientRect();
	const extra = 18;
	return {
		top: 10,
		right: 10,
		bottom: Math.round(rect.height + extra),
		left: Math.round(rect.width + extra),
	};
}

function maybeFocusSelectedArea() {
	if (!state.map || !state.selectedAreaCode) return;
	const overlay = document.getElementById('chart-overlay');
	if (!overlay || overlay.classList.contains('hidden')) return;

	const code = state.selectedAreaCode;
	let feature = null;

	if (state.areasGeojson && state.areasGeojson.features) {
		feature = state.areasGeojson.features.find(f => f && f.properties && f.properties[config.geoIdField] === code) || null;
	}

	if (!feature) {
		try {
			const opts = state.geographySource === 'vector'
				? { sourceLayer: config.geoLayer, filter: ['==', config.geoIdField, code] }
				: { filter: ['==', config.geoIdField, code] };
			const feats = state.map.querySourceFeatures('area', opts) || [];
			feature = feats[0] || null;
		} catch (e) {
			// ignore
		}
	}

	if (!feature) return;

	let bounds;
	try {
		bounds = d3.geoBounds(feature);
	} catch (e) {
		return;
	}
	if (!bounds || !bounds[0] || !bounds[1]) return;

	state.map.fitBounds(bounds, {
		padding: getChartOverlayPadding(),
		maxZoom: Math.min((config.maxZoom || 13), 9.5),
		duration: 650,
	});
}

function deferFocusSelectedArea() {
	if (!state.selectedAreaCode) return;
	// Allow overlay and SVG layout to settle, especially on small screens.
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			maybeFocusSelectedArea();
			setTimeout(maybeFocusSelectedArea, 160);
		});
	});
}

function setupData() {
	const geoUrl = config.geoUrl || "../lib-maps/master-topo.json";
	detectGeographySource(geoUrl).then((sourceType) => {
		state.geographySource = sourceType;
		return Promise.all([
			sourceType === "vector" ? null : d3.json(geoUrl),
			loadDataset(0)
		]);
	}).then(([geog]) => {
		let areas = geog;
		areas = convertTopoJSONtoGeojson(areas, state.geographySource);
		resolveAutoMapBounds(config, areas, state.geographySource);
		state.areasGeojson = (state.geographySource === 'vector') ? null : areas;
		setupUI();
		drawMap(areas);
	});
}

let __started = false;
function startOnce() {
	if (__started) return;
	__started = true;
	setupData();
}

// Start immediately (script is loaded at end of body).
startOnce();

// Also hook load (and pym when available) for embed resizing.
window.addEventListener('load', () => {
	if (window.self !== window.top && typeof pym !== 'undefined') {
		state.pymChild = new pym.Child({ renderCallback: startOnce });
		setTimeout(startOnce, 250);
	}
	startOnce();
});
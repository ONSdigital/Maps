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
	selectedTimeRaw: null,
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

let __timelineWired = false;

function getNearestTimelineIndexFromClientX(container, clientX) {
	if (!container) return 0;
	const positions = container.__timelinePositions || null;
	if (!positions || !positions.length) return 0;
	const rect = container.getBoundingClientRect();
	const localX = clientX - rect.left;

	let bestIndex = 0;
	let bestDist = Infinity;
	for (const p of positions) {
		const dist = Math.abs(p.x - localX);
		if (dist < bestDist) {
			bestDist = dist;
			bestIndex = p.index;
		}
	}
	return bestIndex;
}

function beginTimelineDrag(container, event, captureElement) {
	if (!container || !event) return;
	const pointerId = event.pointerId;
	if (typeof pointerId !== 'number') return;

	// Avoid double-binding if something already captured.
	if (container.__timelineDragging) return;
	container.__timelineDragging = true;
	container.classList.add('is-dragging');

	// If the user started from a focused marker, keep focus following the active step while scrubbing.
	const startedOnMarker = Boolean(event.target && event.target.closest && event.target.closest('button.timeline-marker'));
	// If the user starts dragging on the track/background, ensure the slider itself has focus
	// so ArrowLeft/ArrowRight works immediately after scrubbing.
	if (!startedOnMarker && event.pointerType !== 'touch') {
		try { container.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
	}

	const captureEl = captureElement || event.currentTarget || container;
	try {
		if (captureEl && captureEl.setPointerCapture) captureEl.setPointerCapture(pointerId);
	} catch (e) {
		// ignore
	}

	let latestX = event.clientX;
	let rafId = null;

	const apply = () => {
		rafId = null;
		const next = getNearestTimelineIndexFromClientX(container, latestX);
		setTimeIndex(next);

		if (startedOnMarker) {
			const activeBtn = container.querySelector(`button.timeline-marker[data-index="${state.timeIndex}"]`);
			if (activeBtn && document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('timeline-marker')) {
				try { activeBtn.focus(); } catch (e) { /* ignore */ }
			}
		}
	};

	const onMove = (e) => {
		if (e.pointerId !== pointerId) return;
		// Prevent the browser from interpreting this as a scroll while scrubbing.
		if (e.pointerType === 'touch') {
			try { e.preventDefault(); } catch (err) { /* ignore */ }
		}
		latestX = e.clientX;
		if (rafId) return;
		rafId = requestAnimationFrame(apply);
	};

	const end = (e) => {
		if (e.pointerId !== pointerId) return;
		container.__timelineDragging = false;
		container.classList.remove('is-dragging');
		if (!startedOnMarker && e.pointerType !== 'touch') {
			try { container.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
		}
		if (rafId) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', end);
		window.removeEventListener('pointercancel', end);
		try {
			if (captureEl && captureEl.releasePointerCapture) captureEl.releasePointerCapture(pointerId);
		} catch (err) {
			// ignore
		}
	};

	window.addEventListener('pointermove', onMove, { passive: false });
	window.addEventListener('pointerup', end);
	window.addEventListener('pointercancel', end);

	// Apply immediately at the start position.
	apply();
}

function getTimelineConfig() {
	const t = (config && config.timeline) ? config.timeline : {};
	return {
		displayFormat: t.displayFormat || '%Y',
		screenreaderFormat: t.screenreaderFormat || t.displayFormat || '%Y',
		parseFormat: t.parseFormat || null,
		ariaLabel: t.ariaLabel || 'Timeline'
	};
}

function parseTimeColumn(raw) {
	const str = String(raw ?? '').trim();
	if (!str) return null;

	const t = getTimelineConfig();
	if (t.parseFormat) {
		const parse = d3.timeParse(t.parseFormat);
		const d = parse(str);
		return d && Number.isFinite(d.getTime()) ? d : null;
	}

	// Heuristic parsing for common header formats
	if (/^\d{4}$/.test(str)) return new Date(+str, 0, 1);
	if (/^\d{4}-\d{2}$/.test(str)) return new Date(+str.slice(0, 4), +str.slice(5, 7) - 1, 1);
	if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
		const d = new Date(`${str}T00:00:00`);
		return Number.isFinite(d.getTime()) ? d : null;
	}

	// Last resort: try Date parsing
	const d = new Date(str);
	return Number.isFinite(d.getTime()) ? d : null;
}

function buildTimelineItems() {
	const t = getTimelineConfig();
	const fmtDisplay = d3.timeFormat(t.displayFormat);
	const fmtSR = d3.timeFormat(t.screenreaderFormat);

	return state.timeColumns.map((raw, index) => {
		const date = parseTimeColumn(raw);
		const display = date ? fmtDisplay(date) : String(raw);
		const srText = date ? fmtSR(date) : String(raw);
		return { raw: String(raw), index, date, display, srText };
	});
}

function ensureTimelineScaffold(container) {
	container.classList.add('timeline-slider');
	container.setAttribute('role', 'slider');
	container.setAttribute('tabindex', '0');

	const t = getTimelineConfig();
	container.setAttribute('aria-label', t.ariaLabel);

	if (!container.querySelector('.timeline-track')) {
		const track = document.createElement('div');
		track.className = 'timeline-track';
		container.appendChild(track);
	}
	if (!container.querySelector('.timeline-pill')) {
		const pill = document.createElement('div');
		pill.className = 'timeline-pill';
		container.appendChild(pill);
	}
}

function renderTimeline() {
	const container = document.getElementById('timeline-slider');
	if (!container) return;
	ensureTimelineScaffold(container);

	const items = buildTimelineItems();
	const maxIdx = Math.max(0, items.length - 1);
	const clamped = Math.max(0, Math.min(state.timeIndex, maxIdx));
	state.timeIndex = clamped;

	container.setAttribute('aria-valuemin', '0');
	container.setAttribute('aria-valuemax', String(maxIdx));
	container.setAttribute('aria-valuenow', String(state.timeIndex));
	container.setAttribute('aria-valuetext', items[state.timeIndex] ? items[state.timeIndex].srText : '');

	const width = container.clientWidth || 0;
	if (!width || items.length === 0) return;
	const padding = 10;

	let allHaveDates = items.length > 1 && items.every(d => d.date instanceof Date && Number.isFinite(d.date.getTime()));
	let timeDomain = null;
	if (allHaveDates) {
		timeDomain = d3.extent(items, d => d.date);
		if (!timeDomain || !timeDomain[0] || !timeDomain[1] || timeDomain[0].getTime() === timeDomain[1].getTime()) {
			allHaveDates = false;
		}
	}

	const x = allHaveDates
		? d3.scaleTime().domain(timeDomain).range([padding, width - padding])
		: d3.scalePoint().domain(items.map(d => d.index)).range([padding, width - padding]);

	// Cache discrete positions for drag snapping.
	container.__timelinePositions = items.map(d => {
		const px = allHaveDates ? x(d.date) : x(d.index);
		return { index: d.index, x: px };
	});

	const markersSel = d3.select(container)
		.selectAll('button.timeline-marker')
		.data(items, d => d.raw);

	markersSel.exit().remove();

	const markersEnter = markersSel.enter()
		.append('button')
		.attr('type', 'button')
		.attr('class', 'timeline-marker')
		.attr('role', 'button')
		.attr('tabindex', 0)
		.on('pointerdown', (event, d) => {
			// Allow click-to-set and drag-to-scrub from a marker (especially the active one)
			event.preventDefault();
			try { event.currentTarget.focus(); } catch (e) { /* ignore */ }
			beginTimelineDrag(container, event, event.currentTarget);
			setTimeIndex(d.index);
		})
		.on('keydown', (event, d) => {
			const key = event.key;
			if (key === 'Enter' || key === ' ') {
				event.preventDefault();
				event.stopPropagation();
				setTimeIndex(d.index);
				const activeBtn = container.querySelector(`button.timeline-marker[data-index="${state.timeIndex}"]`);
				if (activeBtn) {
					try { activeBtn.focus(); } catch (e) { /* ignore */ }
				}
				return;
			}
			if (key === 'ArrowLeft') {
				event.preventDefault();
				event.stopPropagation();
				setTimeIndex(state.timeIndex - 1);
				const prev = container.querySelector(`button.timeline-marker[data-index="${state.timeIndex}"]`);
				if (prev) {
					try { prev.focus(); } catch (e) { /* ignore */ }
				}
				return;
			}
			if (key === 'ArrowRight') {
				event.preventDefault();
				event.stopPropagation();
				setTimeIndex(state.timeIndex + 1);
				const next = container.querySelector(`button.timeline-marker[data-index="${state.timeIndex}"]`);
				if (next) {
					try { next.focus(); } catch (e) { /* ignore */ }
				}
				return;
			}
		});

	const markersAll = markersEnter.merge(markersSel);
	markersAll
		.attr('data-index', d => String(d.index))
		.attr('aria-label', d => d.srText)
		.classed('is-complete', d => d.index <= state.timeIndex)
		.classed('is-active', d => d.index === state.timeIndex)
		.style('left', d => {
			const px = allHaveDates ? x(d.date) : x(d.index);
			return `${px}px`;
		});

	// Tick labels
	const ticksSel = d3.select(container)
		.selectAll('div.timeline-tick')
		.data(items, d => d.raw);

	ticksSel.exit().remove();

	const ticksEnter = ticksSel.enter()
		.append('div')
		.attr('class', 'timeline-tick');

	ticksEnter.merge(ticksSel)
		.text(d => d.display)
		.style('left', d => {
			const px = allHaveDates ? x(d.date) : x(d.index);
			return `${px}px`;
		});

	// Active pill label
	const pill = container.querySelector('.timeline-pill');
	if (pill && items[state.timeIndex]) {
		const active = items[state.timeIndex];
		pill.textContent = active.display;
		const px = allHaveDates ? x(active.date) : x(active.index);
		pill.style.left = `${px}px`;
		pill.style.display = '';
	} else if (pill) {
		pill.style.display = 'none';
	}
}

function wireTimelineEvents() {
	if (__timelineWired) return;
	__timelineWired = true;
	const container = document.getElementById('timeline-slider');
	if (!container) return;

	// Click/drag on the track area should scrub too (useful on touch).
	container.addEventListener('pointerdown', (event) => {
		// Buttons handle their own pointerdown; avoid starting a second drag.
		if (event.target && event.target.closest && event.target.closest('button.timeline-marker')) return;
		event.preventDefault();
		if (event.pointerType !== 'touch') {
			try { container.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
		}
		beginTimelineDrag(container, event, container);
	});

	container.addEventListener('keydown', (event) => {
		// If a marker has focus, it handles its own keydown.
		if (event.target !== container) return;
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			setTimeIndex(state.timeIndex - 1);
			return;
		}
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			setTimeIndex(state.timeIndex + 1);
			return;
		}
	});
}

function setTimelineUI() {
	wireTimelineEvents();
	renderTimeline();
}

function setTimeIndex(nextIndex) {
	const clamped = Math.max(0, Math.min(nextIndex, state.timeColumns.length - 1));
	state.timeIndex = clamped;
	state.selectedTimeRaw = state.timeColumns[clamped] ?? null;
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

	// Capture the current selection so we can retain it across dataset switches.
	const prevSelectedRaw = state.selectedTimeRaw || state.timeColumns[state.timeIndex] || null;
	const prevSelectedDate = prevSelectedRaw ? parseTimeColumn(prevSelectedRaw) : null;

	const csv = await d3.csv(ds.url);
	const { timeColumns, seriesById, areaById, meanSeries } = buildSeriesStore(csv);
	state.timeColumns = timeColumns;
	state.seriesById = seriesById;
	state.meanSeries = meanSeries;

	// update areaById in place
	for (const k of Object.keys(state.areaById)) delete state.areaById[k];
	Object.assign(state.areaById, areaById);

	// Initial timeline position:
	// 1) Retain previous selected time (exact header match, else nearest parsed date)
	// 2) config.startTime if present
	// 3) default to last
	let nextIdx = -1;
	if (prevSelectedRaw) {
		nextIdx = state.timeColumns.indexOf(prevSelectedRaw);
		if (nextIdx < 0 && prevSelectedDate && Number.isFinite(prevSelectedDate.getTime())) {
			let best = -1;
			let bestDist = Infinity;
			for (let i = 0; i < state.timeColumns.length; i++) {
				const d = parseTimeColumn(state.timeColumns[i]);
				if (!d || !Number.isFinite(d.getTime())) continue;
				const dist = Math.abs(d.getTime() - prevSelectedDate.getTime());
				if (dist < bestDist) {
					bestDist = dist;
					best = i;
				}
			}
			nextIdx = best;
		}
	}
	if (nextIdx < 0) {
		const desired = typeof config.startTime === 'string' ? config.startTime : null;
		nextIdx = desired ? state.timeColumns.indexOf(desired) : -1;
	}
	state.timeIndex = nextIdx >= 0 ? nextIdx : Math.max(0, state.timeColumns.length - 1);
	state.selectedTimeRaw = state.timeColumns[state.timeIndex] ?? null;
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
	// Ensure timeline is positioned correctly once layout is stable.
	requestAnimationFrame(() => renderTimeline());

	// Keep chart responsive
	window.addEventListener('resize', () => {
		state.chart = null;
		updateChart();
		renderTimeline();
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
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
		ariaLabel: t.ariaLabel || 'Timeline',
		keyboardStep: Number.isFinite(+t.keyboardStep) && +t.keyboardStep > 1 ? Math.floor(+t.keyboardStep) : 5
	};
}

function getTimelineKeyboardStep() {
	return getTimelineConfig().keyboardStep;
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
			if (key === 'Home') {
				event.preventDefault();
				event.stopPropagation();
				setTimeIndex(0);
				const first = container.querySelector(`button.timeline-marker[data-index="0"]`);
				if (first) {
					try { first.focus(); } catch (e) { /* ignore */ }
				}
				return;
			}
			if (key === 'End') {
				event.preventDefault();
				event.stopPropagation();
				setTimeIndex(maxIdx);
				const last = container.querySelector(`button.timeline-marker[data-index="${state.timeIndex}"]`);
				if (last) {
					try { last.focus(); } catch (e) { /* ignore */ }
				}
				return;
			}
			if (key === 'PageUp') {
				event.preventDefault();
				event.stopPropagation();
				setTimeIndex(state.timeIndex - getTimelineKeyboardStep());
				const btn = container.querySelector(`button.timeline-marker[data-index="${state.timeIndex}"]`);
				if (btn) {
					try { btn.focus(); } catch (e) { /* ignore */ }
				}
				return;
			}
			if (key === 'PageDown') {
				event.preventDefault();
				event.stopPropagation();
				setTimeIndex(state.timeIndex + getTimelineKeyboardStep());
				const btn = container.querySelector(`button.timeline-marker[data-index="${state.timeIndex}"]`);
				if (btn) {
					try { btn.focus(); } catch (e) { /* ignore */ }
				}
				return;
			}
			if (key === 'ArrowLeft') {
				event.preventDefault();
				event.stopPropagation();
				setTimeIndex(state.timeIndex - (event.shiftKey ? getTimelineKeyboardStep() : 1));
				const prev = container.querySelector(`button.timeline-marker[data-index="${state.timeIndex}"]`);
				if (prev) {
					try { prev.focus(); } catch (e) { /* ignore */ }
				}
				return;
			}
			if (key === 'ArrowRight') {
				event.preventDefault();
				event.stopPropagation();
				setTimeIndex(state.timeIndex + (event.shiftKey ? getTimelineKeyboardStep() : 1));
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

		const maxIdx = Math.max(0, state.timeColumns.length - 1);
		const jump = getTimelineKeyboardStep();
		const delta = event.shiftKey ? jump : 1;

		if (event.key === 'Home') {
			event.preventDefault();
			setTimeIndex(0);
			return;
		}
		if (event.key === 'End') {
			event.preventDefault();
			setTimeIndex(maxIdx);
			return;
		}
		if (event.key === 'PageUp') {
			event.preventDefault();
			setTimeIndex(state.timeIndex - jump);
			return;
		}
		if (event.key === 'PageDown') {
			event.preventDefault();
			setTimeIndex(state.timeIndex + jump);
			return;
		}
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			setTimeIndex(state.timeIndex - delta);
			return;
		}
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			setTimeIndex(state.timeIndex + delta);
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
	const width = Math.floor(container.node()?.getBoundingClientRect().width || 0);
	if (!width || width < 50) {
		// Overlay not visible or not yet laid out.
		return {
			__width: 0,
			update: () => { /* no-op until we have a real width */ }
		};
	}
	const height = config.chartHeight || 220;
	const margin = (config.chartMargin && typeof config.chartMargin === 'object')
		? { ...{ top: 10, right: 20, bottom: 30, left: 50 }, ...config.chartMargin }
		: { top: 10, right: 20, bottom: 30, left: 50 };
	const innerWidth = Math.max(10, width - margin.left - margin.right);
	const innerHeight = Math.max(10, height - margin.top - margin.bottom);

	const overlay = d3.select('#chart-overlay');
	overlay.selectAll('.chart-title').remove();
	const title = overlay.append('div')
		.attr('class', 'chart-title')
		.style('position', 'absolute')
		.style('top', '15px')
		.style('left', '15px')
		.style('right', '44px')
		.style('height', '32px')
		.style('display', 'none')
		.style('align-items', 'center')
		.style('font-size', '15px')
		.style('font-weight', '700')
		.style('line-height', '1.2')
		.style('color', config.chartSolidStroke || 'var(--ons-color-ocean-blue)')
		.style('pointer-events', 'none')
		.style('white-space', 'nowrap')
		.style('overflow', 'hidden');

	const meanLegendCfg = config.chartMeanLegend || { label: 'Average', color: 'var(--ons-color-grey-60)' };
	const legendId = 'chart-legend';
	const legend = container.append('div')
		.attr('id', legendId)
		.style('display', 'flex')
		.style('align-items', 'center')
		.style('gap', '8px')
		.style('margin', '0 0 8px 0');
	const legendSwatch = legend.append('span')
		.style('display', 'inline-block')
		.style('width', '28px')
		.style('height', '3px')
		.style('background', meanLegendCfg.color)
		.style('border-radius', '2px')
		.style('vertical-align', 'middle');
	const legendLabel = legend.append('span')
		.text(meanLegendCfg.label)
		.style('font-size', '13px')
		.style('color', 'var(--ons-color-grey-60)');

	const svg = container.append('svg')
		.attr('width', width)
		.attr('height', height)
		.attr('class', 'chart')
		.attr('tabindex', 0);

	const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

	const x = d3.scalePoint().range([0, innerWidth]).padding(0.5);
	const y = d3.scaleLinear().range([innerHeight, 0]);

	const gridG = g.append('g')
		.attr('class', 'grid');

	const yScaleSwatchesG = g.append('g')
		.attr('class', 'y-scale-swatches')
		.style('pointer-events', 'none')
		.style('display', 'none');

	const vline = g.append('line')
		.style('stroke', 'var(--ons-color-grey-50)')
		.attr('stroke-width', 2)
		.attr('stroke-dasharray', '4 3')
		.attr('y1', 0)
		.attr('y2', innerHeight)
		.style('opacity', 0);

	const indicatorTriangle = g.append('path')
		.attr('class', 'indicator-triangle')
		.attr('fill', config.chartSolidStroke || 'var(--ons-color-ocean-blue)')
		.style('opacity', 0)
		.style('pointer-events', 'none');

	const indicatorValue = g.append('text')
		.attr('class', 'indicator-value')
		.attr('text-anchor', 'middle')
		.attr('x', 0)
		.attr('y', -4)
		.style('font-size', '15px')
		.style('font-weight', '700')
		.attr('fill', config.chartSolidStroke || 'var(--ons-color-ocean-blue)')
		.style('opacity', 0)
		.style('pointer-events', 'none');

	const meanPath = g.append('path')
		.attr('class', 'line mean')
		.attr('fill', 'none')
		.style('stroke', meanLegendCfg.color)
		.attr('stroke-width', 3)
		.attr('stroke-dasharray', null)
		.style('stroke-linejoin', 'round')
		.style('stroke-linecap', 'round')
		.style('opacity', 0);

	const defs = svg.append('defs');
	const gradientId = `area-gradient-${Math.random().toString(16).slice(2)}`;
	const areaGradient = defs.append('linearGradient')
		.attr('id', gradientId)
		.attr('gradientUnits', 'objectBoundingBox')
		.attr('x1', 0)
		.attr('y1', 0)
		.attr('x2', 1)
		.attr('y2', 0);

	const areaPath = g.append('path')
		.attr('class', 'line series')
		.attr('fill', 'none')
		.attr('stroke-width', 3)
		.style('stroke', (config.chartLineStyle || 'gradient') === 'solid'
			? (config.chartSolidStroke || 'var(--ons-color-ocean-blue)')
			: `url(#${gradientId})`)
		.style('stroke-linejoin', 'round')
		.style('stroke-linecap', 'round')
		.style('opacity', 0);

	const xAxisG = g.append('g')
		.attr('class', 'x axis')
		.attr('transform', `translate(0,${innerHeight})`);
	const yAxisG = g.append('g')
		.attr('class', 'y axis numeric');

	const marker = g.append('circle')
		.attr('r', 4)
		.style('fill', 'var(--ons-color-ocean-blue)')
		.style('stroke', 'var(--ons-color-white)')
		.attr('stroke-width', 1)
		.style('opacity', 0);

	function update({ timeColumns, areaSeries, meanSeries, timeIndex, areaName, colourScale, breaks }) {
		const indicatorColour = config.chartSolidStroke || 'var(--ons-color-ocean-blue)';
		indicatorTriangle.attr('fill', indicatorColour);
		indicatorValue.attr('fill', indicatorColour);

		title
			.text(areaName || '')
			.style('color', config.chartSolidStroke || 'var(--ons-color-ocean-blue)')
			.style('display', areaName ? null : 'none');

		legendSwatch.style('background', meanLegendCfg.color);
		legendLabel.text(meanLegendCfg.label);

		x.domain(timeColumns);

		const values = [];
		if (areaSeries) values.push(...areaSeries.filter(d => d.v !== null).map(d => d.v));
		if (config.showMeanLine && meanSeries) values.push(...meanSeries.filter(d => d.v !== null).map(d => d.v));
		if (!values.length) {
			// Empty chart state
			gridG.call(d3.axisLeft(y).tickValues([]).tickSize(-innerWidth).tickFormat(''));
			xAxisG.call(d3.axisBottom(x).tickValues([]));
			yAxisG.call(d3.axisLeft(y).ticks(4));
			yScaleSwatchesG.style('display', 'none').selectAll('rect').remove();
			areaPath.style('opacity', 0);
			areaGradient.selectAll('stop').remove();
			meanPath.style('opacity', 0);
			marker.style('opacity', 0);
			vline.style('opacity', 0);
			indicatorTriangle.style('opacity', 0);
			indicatorValue.style('opacity', 0);
			return;
		}

		const extent = d3.extent(values);
		y.domain([extent[0], extent[1]]).nice();

		const tickValues = timeColumns.length > 8
			? timeColumns.filter((_, i) => i % Math.ceil(timeColumns.length / 8) === 0)
			: timeColumns;

		gridG.call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(''));
		xAxisG.call(d3.axisBottom(x).tickValues(tickValues));
		yAxisG.call(d3.axisLeft(y).ticks(5));

		// Optional: show choropleth scale colours as a vertical strip next to the y-axis.
		if (config.chartShowBreaks && colourScale && typeof colourScale.range === 'function') {
			const palette = colourScale.range() || [];
			let bins = [];
			const yd = y.domain();
			const domLo = Math.min(yd[0], yd[1]);
			const domHi = Math.max(yd[0], yd[1]);

			if (Array.isArray(breaks) && breaks.length >= 2) {
				const n = Math.min(palette.length, breaks.length - 1);
				for (let i = 0; i < n; i++) {
					const b0 = +breaks[i];
					const b1 = +breaks[i + 1];
					if (!Number.isFinite(b0) || !Number.isFinite(b1) || b0 === b1) continue;
					bins.push({ i, b0, b1, c: palette[i] });
				}
			} else if (typeof colourScale.invertExtent === 'function' && palette.length) {
				bins = palette.map((c, i) => {
					const ext = colourScale.invertExtent(c) || [undefined, undefined];
					const d0 = ext[0];
					const d1 = ext[1];
					return {
						i,
						b0: Number.isFinite(d0) ? d0 : y.domain()[0],
						b1: Number.isFinite(d1) ? d1 : y.domain()[1],
						c
					};
				}).filter(d => Number.isFinite(d.b0) && Number.isFinite(d.b1) && d.b0 !== d.b1);
			}

			// Only show bins that overlap the current (data-driven) y-domain.
			bins = bins.filter(d => {
				const lo = Math.min(d.b0, d.b1);
				const hi = Math.max(d.b0, d.b1);
				return hi > domLo && lo < domHi;
			});

			if (!bins.length) {
				yScaleSwatchesG.style('display', 'none').selectAll('rect').remove();
			} else {
				yScaleSwatchesG.style('display', null);
				const swatchX = 2;
				const swatchW = 10;
				const rects = yScaleSwatchesG.selectAll('rect').data(bins, d => d.i);
				rects.exit().remove();
				rects.enter().append('rect')
					.merge(rects)
					.attr('x', swatchX)
					.attr('width', swatchW)
					.attr('fill', d => d.c)
					.attr('y', d => {
						const lo = Math.min(d.b0, d.b1);
						const hi = Math.max(d.b0, d.b1);
						const v0 = Math.max(lo, domLo);
						const v1 = Math.min(hi, domHi);
						const y0 = y(v0);
						const y1 = y(v1);
						if (!Number.isFinite(y0) || !Number.isFinite(y1)) return 0;
						let top = Math.min(y0, y1);
						let bottom = Math.max(y0, y1);
						top = Math.max(0, Math.min(innerHeight, top));
						bottom = Math.max(0, Math.min(innerHeight, bottom));
						return top;
					})
					.attr('height', d => {
						const lo = Math.min(d.b0, d.b1);
						const hi = Math.max(d.b0, d.b1);
						const v0 = Math.max(lo, domLo);
						const v1 = Math.min(hi, domHi);
						const y0 = y(v0);
						const y1 = y(v1);
						if (!Number.isFinite(y0) || !Number.isFinite(y1)) return 0;
						let top = Math.min(y0, y1);
						let bottom = Math.max(y0, y1);
						top = Math.max(0, Math.min(innerHeight, top));
						bottom = Math.max(0, Math.min(innerHeight, bottom));
						return Math.max(0, bottom - top);
					});
			}
		} else {
			yScaleSwatchesG.style('display', 'none').selectAll('rect').remove();
		}

		const line = d3.line()
			.defined(d => d.v !== null)
			.x(d => x(d.t))
			.y(d => y(d.v));

		if (config.showMeanLine && meanSeries) {
			meanPath
				.attr('d', line(meanSeries))
				.style('opacity', 1);
			legend.style('display', meanLegendCfg.label ? 'flex' : 'none');
		} else {
			meanPath.style('opacity', 0);
			legend.style('display', 'none');
		}

		if (areaSeries) {
			areaPath.attr('d', line(areaSeries)).style('opacity', 1);

			const lineStyle = (config.chartLineStyle || 'gradient');
			if (lineStyle === 'solid') {
				areaPath.style('stroke', config.chartSolidStroke || 'var(--ons-color-ocean-blue)');
				areaGradient.selectAll('stop').remove();
			} else {
				areaPath.style('stroke', `url(#${gradientId})`);
				// Build hard-stop gradient stops where the series crosses choropleth breaks.
				const thresholds = (colourScale && typeof colourScale.domain === 'function') ? (colourScale.domain() || []) : [];
				const segments = [];
				for (let i = 0; i < areaSeries.length - 1; i++) {
					const a = areaSeries[i];
					const b = areaSeries[i + 1];
					if (!a || !b) continue;
					if (a.v === null || b.v === null) continue;
					const x0 = x(a.t);
					const x1 = x(b.t);
					if (typeof x0 !== 'number' || typeof x1 !== 'number') continue;
					const v0 = a.v;
					const v1 = b.v;
					if (!Number.isFinite(v0) || !Number.isFinite(v1)) continue;

					const pts = [{ x: x0, v: v0 }];
					if (v0 !== v1 && thresholds && thresholds.length) {
						const lo = Math.min(v0, v1);
						const hi = Math.max(v0, v1);
						const crosses = thresholds
							.filter(t => t > lo && t < hi)
							.map(t => ({ t, f: (t - v0) / (v1 - v0) }))
							.filter(d => d.f > 0 && d.f < 1)
							.sort((p, q) => p.f - q.f);
						for (const c of crosses) {
							pts.push({ x: x0 + (x1 - x0) * c.f, v: c.t });
						}
					}
					pts.push({ x: x1, v: v1 });

					for (let j = 0; j < pts.length - 1; j++) {
						const p0 = pts[j];
						const p1 = pts[j + 1];
						const vm = (p0.v + p1.v) / 2;
						let c = null;
						if (colourScale && Number.isFinite(vm)) {
							try { c = colourScale(vm); } catch (e) { c = null; }
						}
						segments.push({ x0: p0.x, x1: p1.x, c: c || 'var(--ons-color-ocean-blue)' });
					}
				}

				// Merge adjacent segments of the same colour.
				segments.sort((a, b) => a.x0 - b.x0);
				const merged = [];
				for (const s of segments) {
					const last = merged[merged.length - 1];
					if (last && last.c === s.c && Math.abs(last.x1 - s.x0) < 0.5) {
						last.x1 = s.x1;
					} else {
						merged.push({ ...s });
					}
				}

				// Compute normalised offsets based on visible x-range.
				let minX = Infinity;
				let maxX = -Infinity;
				for (const s of merged) {
					minX = Math.min(minX, s.x0, s.x1);
					maxX = Math.max(maxX, s.x0, s.x1);
				}
				if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) {
					minX = 0;
					maxX = innerWidth;
				}

				const stops = [];
				for (const s of merged) {
					const o0 = Math.max(0, Math.min(1, (s.x0 - minX) / (maxX - minX)));
					const o1 = Math.max(0, Math.min(1, (s.x1 - minX) / (maxX - minX)));
					stops.push({ o: o0, c: s.c });
					stops.push({ o: o1, c: s.c });
				}

				// Ensure stops are ordered and include endpoints.
				stops.sort((a, b) => a.o - b.o);
				if (!stops.length) {
					stops.push({ o: 0, c: 'var(--ons-color-ocean-blue)' }, { o: 1, c: 'var(--ons-color-ocean-blue)' });
				} else {
					if (stops[0].o > 0) stops.unshift({ o: 0, c: stops[0].c });
					if (stops[stops.length - 1].o < 1) stops.push({ o: 1, c: stops[stops.length - 1].c });
				}

				const stopSel = areaGradient.selectAll('stop')
					.data(stops);
				stopSel.exit().remove();
				stopSel.enter()
					.append('stop')
					.merge(stopSel)
					.attr('offset', d => `${(d.o * 100).toFixed(2)}%`)
					.attr('stop-color', d => d.c);
			}
		} else {
			areaPath.style('opacity', 0);
			areaGradient.selectAll('stop').remove();
		}

		const t = timeColumns[timeIndex];
		const xPos = x(t);
		if (typeof xPos === 'number') {
			vline.attr('x1', xPos).attr('x2', xPos).style('opacity', 1);
		} else {
			vline.style('opacity', 0);
			indicatorTriangle.style('opacity', 0);
			indicatorValue.style('opacity', 0);
		}

		let activePoint = null;
		if (areaSeries) {
			activePoint = areaSeries.find(d => d.t === t) || null;
		}

		if (activePoint && activePoint.v !== null && Number.isFinite(activePoint.v) && typeof xPos === 'number') {
			const w = 6;
			const h = 8;
			indicatorTriangle
				// Tip sits on the top of the vline (y=0); triangle extends above the plot area.
				.attr('d', `M${xPos - w},${-h}L${xPos + w},${-h}L${xPos},0Z`)
				.style('opacity', 1);

			let valueFormatter = null;
			try {
				valueFormatter = d3.format(config.valueFormat || ',.2f');
			} catch (e) {
				valueFormatter = (d) => String(d);
			}
			const prefix = typeof config.valuePrefix === 'string' ? config.valuePrefix : '';
			const suffix = typeof config.valueSuffix === 'string' ? config.valueSuffix : '';
			indicatorValue
				.text(`${prefix}${valueFormatter(activePoint.v)}${suffix}`)
				.attr('x', xPos)
				.attr('y', -h - 4)
				.style('opacity', 1);
		} else {
			indicatorTriangle.style('opacity', 0);
			indicatorValue.style('opacity', 0);
		}

		if (areaSeries) {
			const point = activePoint;
			if (point && point.v !== null && typeof xPos === 'number') {
				let pc = null;
				if ((config.chartLineStyle || 'gradient') === 'solid') {
					pc = config.chartSolidStroke || 'var(--ons-color-ocean-blue)';
				} else if (colourScale && point.v !== null && Number.isFinite(point.v)) {
					try { pc = colourScale(point.v); } catch (e) { pc = null; }
				}
				marker.style('fill', pc || 'var(--ons-color-ocean-blue)');
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


	return { __width: width, update };
}

function updateChart() {
	const chartEl = document.getElementById('chart');
	const width = Math.floor(chartEl?.getBoundingClientRect().width || 0);
	if (!width || width < 50) return;
	if (!state.chart || state.chart.__width !== width) state.chart = createChart();
	const timeColumns = state.timeColumns;
	if (!timeColumns.length) {
		state.chart.update({ timeColumns: [], areaSeries: null, meanSeries: null, timeIndex: 0, areaName: null, colourScale: null });
		return;
	}

	let areaSeries = null;
	let areaName = null;
	if (state.selectedAreaCode && state.seriesById[state.selectedAreaCode]) {
		const s = state.seriesById[state.selectedAreaCode];
		areaName = s.areaName;
		areaSeries = timeColumns.map((t, idx) => {
			const v = s.values[idx];
			let c = null;
			if (state.colour && v !== null && Number.isFinite(v)) {
				try { c = state.colour(v); } catch (e) { c = null; }
			}
			return { t, v, c };
		});
	}
	const meanSeries = timeColumns.map((t, idx) => ({ t, v: state.meanSeries[idx]?.v ?? null }));

	state.chart.update({
		timeColumns,
		areaSeries,
		meanSeries,
		timeIndex: state.timeIndex,
		areaName,
		colourScale: state.colour,
		breaks: state.breaks
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
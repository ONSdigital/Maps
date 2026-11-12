import { initialise, addSource, adjustColorForContrast } from "../lib/helpers.js";
import { drawKeyScale } from "../lib-maps/legend.js";
import { globalConfig } from "../lib/globalConfig.js";
import {
	calculateBreaks,
	clearAreaSelection,
	convertTopoJSONtoGeojson,
	detectGeographySource,
	validateBreaksArray,
	getPalette,
	resolveAutoMapBounds,
	setSearchText,
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
	disableSelectionZoom: true,

	// dataset/time series
	datasetIndex: 0,
	datasetLoadToken: 0,
	timeColumns: [],
	// Point mode selection
	timeIndex: 0,
	selectedTimeRaw: null,
	// Range mode selection (From/To)
	timeFromIndex: 0,
	timeToIndex: 0,
	selectedFromRaw: null,
	selectedToRaw: null,
	activeTimeHandle: 'to', // 'from' | 'to'
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
	displayValueMode: 'value',

	// chart overlay (hover preview vs pinned)
	overlayMode: 'hidden', // 'hidden' | 'hover' | 'pinned'
	overlayAreaCode: null,
	overlayAreaName: null,
	__overlayRaf: null,
	__overlayLastClient: null,
	__overlayResizeRaf: null,
	__focusRaf1: null,
	__focusRaf2: null,
	__focusTimeout: null,
	__lastFocusKey: null,
	__lastFocusAt: 0,
};

function isRangeMode() {
	return String(resolveDatasetOption('timeSelectionMode', 'point')).toLowerCase() === 'range';
}

function getChangeMetric() {
	const m = String(resolveDatasetOption('changeMetric', 'absolute')).toLowerCase();
	return (m === 'percent') ? 'percent' : 'absolute';
}

function clampTimeIndex(i) {
	const maxIdx = Math.max(0, state.timeColumns.length - 1);
	const n = Number.isFinite(+i) ? Math.round(+i) : 0;
	return Math.max(0, Math.min(n, maxIdx));
}

function normalizeRange(fromIdx, toIdx) {
	let f = clampTimeIndex(fromIdx);
	let t = clampTimeIndex(toIdx);
	if (f > t) {
		const tmp = f;
		f = t;
		t = tmp;
	}
	return { from: f, to: t };
}

const graphic = d3.select('#graphic');
const keyscale = d3.select('#keyscale');

// This template uses the chart overlay for explanatory text.
// Hide the standard keyinfo (value/explainer) block above the map key.
config.showKeyInfo = false;

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

function updateRateByIdForSelection() {
	const rateById = state.rateById;
	// clear existing keys (keep same object reference)
	for (const k of Object.keys(rateById)) delete rateById[k];

	if (!isRangeMode()) {
		const idx = clampTimeIndex(state.timeIndex);
		for (const code of Object.keys(state.seriesById)) {
			rateById[code] = state.seriesById[code].values[idx];
		}
		return;
	}

	const { from, to } = normalizeRange(state.timeFromIndex, state.timeToIndex);
	for (const code of Object.keys(state.seriesById)) {
		const values = state.seriesById[code].values;
		const vFrom = values[from];
		const vTo = values[to];
		rateById[code] = computeRangeSelectionValue(vFrom, vTo);
	}
}

function buildDataForMap() {
	const tCol = state.timeColumns[clampTimeIndex(state.timeIndex)];
	const fromRaw = state.selectedFromRaw;
	const toRaw = state.selectedToRaw;
	state.dataForMap = Object.keys(state.seriesById).map(code => {
		return {
			[config.dataIdField]: code,
			[config.dataNameField]: state.seriesById[code].areaName,
			value: state.rateById[code],
			__time: tCol,
			__from: fromRaw,
			__to: toRaw,
		};
	});
}

function resolveByDataset(val) {
	if (!Array.isArray(val)) return val;
	const idx = (state && typeof state.datasetIndex === 'number') ? state.datasetIndex : 0;
	if (idx >= 0 && idx < val.length) return val[idx];
	return val[0];
}

function getCurrentDatasetConfig() {
	const datasets = Array.isArray(config.datasets) && config.datasets.length
		? config.datasets
		: [{ label: 'Data', url: config.dataUrl }];
	const idx = (state && typeof state.datasetIndex === 'number') ? state.datasetIndex : 0;
	return datasets[idx] || datasets[0] || null;
}

function resolveDatasetOption(name, fallback = undefined) {
	const ds = getCurrentDatasetConfig();
	if (ds && Object.prototype.hasOwnProperty.call(ds, name) && typeof ds[name] !== 'undefined') {
		return ds[name];
	}
	const topLevel = config ? config[name] : undefined;
	const resolved = resolveByDataset(topLevel);
	return (typeof resolved === 'undefined') ? fallback : resolved;
}

function getSelectionBreaksMode() {
	const fallback = isRangeMode() ? 'perSelection' : 'fixed';
	const raw = String(resolveDatasetOption('selectionBreaksMode', fallback)).toLowerCase();
	if (raw === 'fixed') return 'fixed';
	if (raw === 'perselection') return 'perSelection';
	return fallback;
}


function formatResolvedDisplayValue(value, {
	formatKey,
	prefixKey,
	suffixKey,
	fallbackFormat = ',.2f',
	fallbackPrefix = '',
	fallbackSuffix = ''
} = {}) {
	let valueFormatter = null;
	const formatOverride = resolveDatasetOption(formatKey, undefined);
	const resolvedFormat = (formatOverride === null || typeof formatOverride === 'undefined') ? fallbackFormat : formatOverride;
	try {
		valueFormatter = d3.format(resolvedFormat);
	} catch (e) {
		valueFormatter = (d) => String(d);
	}
	const prefixOverride = resolveDatasetOption(prefixKey, undefined);
	const suffixOverride = resolveDatasetOption(suffixKey, undefined);
	const prefixRaw = (prefixOverride === null || typeof prefixOverride === 'undefined') ? fallbackPrefix : prefixOverride;
	const suffixRaw = (suffixOverride === null || typeof suffixOverride === 'undefined') ? fallbackSuffix : suffixOverride;
	const prefix = typeof prefixRaw === 'string' ? prefixRaw : '';
	const suffix = typeof suffixRaw === 'string' ? suffixRaw : '';
	return `${prefix}${valueFormatter(value)}${suffix}`;
}

function formatConfiguredValue(value) {
	return formatResolvedDisplayValue(value, {
		formatKey: 'valueFormat',
		prefixKey: 'valuePrefix',
		suffixKey: 'valueSuffix',
		fallbackFormat: ',.2f',
		fallbackPrefix: '',
		fallbackSuffix: ''
	});
}

function formatConfiguredChangeValue(value) {
	return formatResolvedDisplayValue(value, {
		formatKey: 'changeFormat',
		prefixKey: 'changePrefix',
		suffixKey: 'changeSuffix',
		fallbackFormat: resolveDatasetOption('valueFormat', ',.2f'),
		fallbackPrefix: resolveDatasetOption('valuePrefix', ''),
		fallbackSuffix: resolveDatasetOption('valueSuffix', '')
	});
}

function computeRangeSelectionValue(vFrom, vTo) {
	if (vFrom === null || vTo === null || !Number.isFinite(vFrom) || !Number.isFinite(vTo)) {
		return null;
	}
	const delta = vTo - vFrom;
	if (getChangeMetric() === 'percent') {
		if (!Number.isFinite(vFrom) || vFrom === 0) return null;
		return delta / vFrom;
	}
	return delta;
}

function collectFixedBreakValues() {
	const values = [];
	if (!isRangeMode()) {
		for (const code of Object.keys(state.seriesById)) {
			for (const v of state.seriesById[code].values) {
				if (v === null || !Number.isFinite(v)) continue;
				values.push(v);
			}
		}
		return values;
	}

	for (const code of Object.keys(state.seriesById)) {
		const seriesValues = state.seriesById[code].values;
		for (let fromIdx = 0; fromIdx < seriesValues.length - 1; fromIdx++) {
			for (let toIdx = fromIdx + 1; toIdx < seriesValues.length; toIdx++) {
				const v = computeRangeSelectionValue(seriesValues[fromIdx], seriesValues[toIdx]);
				if (v === null || !Number.isFinite(v)) continue;
				values.push(v);
			}
		}
	}

	return values;
}

function resolveBreaksConfig() {
	const b = config.breaks;
	if (!Array.isArray(b)) return b;
	// Preserve the "single custom breaks array" case: breaks: [0, 10, 20]
	const isNumericArray = b.length > 0 && b.every(x => typeof x === 'number' && Number.isFinite(x));
	if (isNumericArray) return b;
	// Otherwise treat as per-dataset list (e.g. ["jenks", "equal"] or [[...],[...]])
	return resolveByDataset(b);
}

function computeBreaksForDataset() {
	const palette = getPalette(config, state);
	const breaks = resolveBreaksConfig();

	if (Array.isArray(breaks)) {
		if (!validateBreaksArray(breaks, 'config.breaks')) {
			state.breaks = null;
			const fallbackColour = (config && config.colourUnavailable)
				|| (typeof ONScolours !== 'undefined' ? ONScolours.noData : '#ccc');
			state.colour = d3.scaleThreshold().domain([]).range([fallbackColour]);
			return;
		}
		state.breaks = breaks;
		state.colour = d3.scaleThreshold().domain(breaks.slice(1)).range(palette);
		return;
	}

	const breaksNumber = resolveByDataset(config.breaksNumber);
	const numClasses = Array.isArray(palette) ? palette.length : (breaksNumber || 5);
	const breaksMode = getSelectionBreaksMode();
	if (breaksMode === 'perSelection') {
		// Will be recomputed on each time change
		state.breaks = null;
		state.colour = d3.scaleThreshold().range(palette);
		return;
	}

	const values = collectFixedBreakValues();
	values.sort(d3.ascending);
	const calculated = calculateBreaks(values, breaks, numClasses);
	state.breaks = calculated;
	state.colour = d3.scaleThreshold().domain(calculated.slice(1)).range(palette);
}

function ensureBreaksAndLegend() {
	const breaksMode = getSelectionBreaksMode();
	if (breaksMode === 'perSelection') {
		const palette = state.colour.range();
		const method = resolveBreaksConfig();
		const values = Object.values(state.rateById).filter(v => v !== null && Number.isFinite(v)).sort(d3.ascending);
		const breaksNumber = resolveByDataset(config.breaksNumber);
		const numClasses = Array.isArray(palette) ? palette.length : (breaksNumber || 5);
		const calculated = Array.isArray(method)
			? (validateBreaksArray(method, 'config.breaks') ? method : null)
			: calculateBreaks(values, method, numClasses);
		if (!calculated) {
			state.breaks = null;
			const fallbackColour = (config && config.colourUnavailable)
				|| (typeof ONScolours !== 'undefined' ? ONScolours.noData : '#ccc');
			state.colour.domain([]).range([fallbackColour]);
			return;
		}
		state.breaks = calculated;
		state.colour.domain(calculated.slice(1));
	}

	drawKeyScale({ keyscale, breaks: state.breaks, colour: state.colour, config, window, state });
}

function setActiveTimeHandle(handle) {
	state.activeTimeHandle = (handle === 'from') ? 'from' : 'to';
	if (isRangeMode()) refreshRangeTimelineHandleUI();
}

function refreshRangeTimelineHandleUI(container = document.getElementById('timeline-slider')) {
	if (!container) return;
	const handleFrom = container.querySelector('button.timeline-handle--from');
	const handleTo = container.querySelector('button.timeline-handle--to');
	const activeElement = document.activeElement;
	const isFromFocused = !!handleFrom && activeElement === handleFrom;
	const isToFocused = !!handleTo && activeElement === handleTo;
	if (handleFrom) {
		handleFrom.classList.toggle('is-active-handle', isFromFocused);
		handleFrom.setAttribute('tabindex', '0');
	}
	if (handleTo) {
		handleTo.classList.toggle('is-active-handle', isToFocused);
		handleTo.setAttribute('tabindex', '0');
	}
	container.querySelectorAll('button.timeline-marker').forEach((btn) => {
		btn.setAttribute('tabindex', isRangeMode() ? '-1' : '0');
	});
}

function syncDisplayValueMode() {
	state.displayValueMode = isRangeMode() ? 'change' : 'value';
}

function applySelectionToUIAndMap() {
	syncDisplayValueMode();
	setTimelineUI();
	updateRateByIdForSelection();
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

function setTimeSelection(next, { activeHandle = null } = {}) {
	if (!state.timeColumns.length) return;

	if (!isRangeMode()) {
		const clamped = clampTimeIndex(next);
		state.timeIndex = clamped;
		state.selectedTimeRaw = state.timeColumns[clamped] ?? null;
		// Keep range fields loosely in sync (useful when toggling modes)
		state.timeFromIndex = 0;
		state.timeToIndex = clamped;
		state.selectedFromRaw = state.timeColumns[0] ?? null;
		state.selectedToRaw = state.timeColumns[clamped] ?? null;
		applySelectionToUIAndMap();
		return;
	}

	const current = normalizeRange(state.timeFromIndex, state.timeToIndex);
	let fromIdx = current.from;
	let toIdx = current.to;
	const handle = (activeHandle === 'from' || activeHandle === 'to') ? activeHandle : state.activeTimeHandle;
	setActiveTimeHandle(handle);
	const idx = clampTimeIndex(next);
	if (handle === 'from') fromIdx = idx;
	else toIdx = idx;

	const norm = normalizeRange(fromIdx, toIdx);
	state.timeFromIndex = norm.from;
	state.timeToIndex = norm.to;
	state.selectedFromRaw = state.timeColumns[state.timeFromIndex] ?? null;
	state.selectedToRaw = state.timeColumns[state.timeToIndex] ?? null;

	// Keep point-mode fields consistent for any code paths that still read them.
	state.timeIndex = state.timeToIndex;
	state.selectedTimeRaw = state.selectedToRaw;

	applySelectionToUIAndMap();
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

function beginTimelineDrag(container, event, captureElement, opts = {}) {
	if (!container || !event) return;
	const pointerId = event.pointerId;
	if (typeof pointerId !== 'number') return;
	const onIndex = (opts && typeof opts.onIndex === 'function') ? opts.onIndex : (idx) => setTimeIndex(idx);

	// Avoid double-binding if something already captured.
	if (container.__timelineDragging) return;
	container.__timelineDragging = true;
	container.classList.add('is-dragging');

	// If the user started from a focused marker, keep focus following the active step while scrubbing.
	const startedOnMarker = Boolean(event.target && event.target.closest && event.target.closest('button.timeline-marker'));

	const captureEl = captureElement || event.currentTarget || container;
	// If the user starts dragging on the track/background, ensure the intended control has focus
	// so ArrowLeft/ArrowRight works immediately after scrubbing.
	const focusTarget = (!startedOnMarker && event.pointerType !== 'touch')
		? ((captureEl && typeof captureEl.focus === 'function') ? captureEl : container)
		: null;
	if (focusTarget) {
		try { focusTarget.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
	}
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
		onIndex(next);

		if (startedOnMarker) {
			const idxToFocus = isRangeMode()
				? (state.activeTimeHandle === 'from' ? state.timeFromIndex : state.timeToIndex)
				: state.timeIndex;
			const activeBtn = container.querySelector(`button.timeline-marker[data-index="${idxToFocus}"]`);
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
		if (!startedOnMarker && e.pointerType !== 'touch' && focusTarget) {
			try { focusTarget.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
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

function beginTimelineTouchDrag(container, event, captureElement, opts = {}) {
	if (!container || !event) return;
	const touches = event.changedTouches || event.touches;
	if (!touches || !touches.length) return;
	const touch0 = touches[0];
	const touchId = touch0.identifier;
	if (typeof touchId !== 'number') return;
	const onIndex = (opts && typeof opts.onIndex === 'function') ? opts.onIndex : (idx) => setTimeIndex(idx);

	// Avoid double-binding if something already captured.
	if (container.__timelineDragging) return;
	container.__timelineDragging = true;
	container.classList.add('is-dragging');

	const captureEl = captureElement || event.currentTarget || container;
	let latestX = touch0.clientX;
	let rafId = null;

	const apply = () => {
		rafId = null;
		const next = getNearestTimelineIndexFromClientX(container, latestX);
		onIndex(next);
	};

	const findTouch = (e) => {
		const changed = e.changedTouches || null;
		if (changed && changed.length) {
			for (let i = 0; i < changed.length; i++) {
				const t = changed[i];
				if (t && t.identifier === touchId) return t;
			}
		}
		const touchesNow = e.touches || null;
		if (touchesNow && touchesNow.length) {
			for (let i = 0; i < touchesNow.length; i++) {
				const t = touchesNow[i];
				if (t && t.identifier === touchId) return t;
			}
		}
		return null;
	};

	const onMove = (e) => {
		const t = findTouch(e);
		if (!t) return;
		// Prevent the browser from interpreting this as a scroll while scrubbing.
		try { if (e.cancelable) e.preventDefault(); } catch (err) { /* ignore */ }
		latestX = t.clientX;
		if (rafId) return;
		rafId = requestAnimationFrame(apply);
	};

	const end = (e) => {
		const t = findTouch(e);
		if (!t) return;
		container.__timelineDragging = false;
		container.classList.remove('is-dragging');
		if (rafId) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		window.removeEventListener('touchmove', onMove);
		window.removeEventListener('touchend', end);
		window.removeEventListener('touchcancel', end);
	};

	window.addEventListener('touchmove', onMove, { passive: false });
	window.addEventListener('touchend', end);
	window.addEventListener('touchcancel', end);

	// Apply immediately at the start position.
	apply();

	// Best-effort to prevent synthetic mouse events after touch.
	try {
		if (event.cancelable) event.preventDefault();
		if (event.stopPropagation) event.stopPropagation();
	} catch (err) {
		// ignore
	}
}

function buildTimelineLayout(items, width, start = 0, end = width) {
	let allHaveDates = items.length > 1 && items.every(d => d.date instanceof Date && Number.isFinite(d.date.getTime()));
	let timeDomain = null;
	if (allHaveDates) {
		timeDomain = d3.extent(items, d => d.date);
		if (!timeDomain || !timeDomain[0] || !timeDomain[1] || timeDomain[0].getTime() === timeDomain[1].getTime()) {
			allHaveDates = false;
		}
	}

	const x = allHaveDates
		? d3.scaleTime().domain(timeDomain).range([start, end])
		: d3.scalePoint().domain(items.map(d => d.index)).range([start, end]);

	return {
		padding: start,
		allHaveDates,
		x,
		positions: items.map(d => ({
			index: d.index,
			x: allHaveDates ? x(d.date) : x(d.index)
		}))
	};
}

function getTimelineBounds(container) {
	const rect = container.getBoundingClientRect();
	const bars = document.querySelectorAll('#keyscale .keyscale-rect');
	const start = bars.length ? bars[0].getBoundingClientRect().left - rect.left : 0;
	const end = bars.length ? bars[bars.length - 1].getBoundingClientRect().right - rect.left : rect.width;
	return { origin: rect.left, start, end };
}

function layoutTimeline(container, items, width) {
	const { start, end } = getTimelineBounds(container);
	// Keep the 22px endpoint thumb and its 6px focus outline inside the keyscale.
	const inset = Math.min(17, Math.max(0, end - start) / 2);
	const layout = buildTimelineLayout(items, width, start + inset, end - inset);
	cacheTimelinePositions(container, layout.positions);

	const mode = getTimelineConfig().mode;
	const crowded = layout.positions.some((p, i, positions) => i > 0 && p.x - positions[i - 1].x < 28);
	const continuous = mode === 'continuous' || (mode === 'auto' && crowded);
	const focusedMarker = container.querySelector('.timeline-marker:focus');
	container.classList.toggle('is-continuous', continuous);
	if (continuous && focusedMarker && (isRangeMode() || Number(focusedMarker.dataset.index) !== state.timeIndex)) {
		const target = isRangeMode()
			? container.querySelector(`.timeline-handle--${state.activeTimeHandle}`)
			: container;
		target.focus({ preventScroll: true });
	}

	const track = container.querySelector('.timeline-track');
	const first = layout.positions[0].x;
	const last = layout.positions[layout.positions.length - 1].x;
	track.style.left = `${first}px`;
	track.style.right = 'auto';
	track.style.width = `${last - first}px`;
	const from = isRangeMode() ? state.timeFromIndex : 0;
	const to = isRangeMode() ? state.timeToIndex : state.timeIndex;
	const span = last - first;
	const fromPercent = span ? 100 * (layout.positions[from].x - first) / span : 0;
	const toPercent = span ? 100 * (layout.positions[to].x - first) / span : 0;
	track.style.background = continuous
		? `linear-gradient(to right, var(--ons-color-grey-50) ${fromPercent}%, var(--ons-color-ocean-blue) ${fromPercent}%, var(--ons-color-ocean-blue) ${toPercent}%, var(--ons-color-grey-50) ${toPercent}%)`
		: '';
	return layout;
}

function cacheTimelinePositions(container, positions) {
	container.__timelinePositions = positions;
}

function getCachedTimelinePosition(container, idx, fallback = 10) {
	const positions = container.__timelinePositions || [];
	const match = positions.find(p => p.index === idx);
	return match ? match.x : fallback;
}

function getTimelineItemPixel(item, layout) {
	return layout.allHaveDates ? layout.x(item.date) : layout.x(item.index);
}

function renderTimelineTickLabels(container, tickLabelItems, layout) {
	const ticksSel = d3.select(container)
		.selectAll('div.timeline-tick')
		.data(tickLabelItems, d => d.raw);
	ticksSel.exit().remove();
	const ticksEnter = ticksSel.enter().append('div').attr('class', 'timeline-tick');
	ticksEnter.merge(ticksSel)
		.text(d => d.display)
		.style('left', d => `${getTimelineItemPixel(d, layout)}px`);
}

function positionTimelinePills(container, entries) {
	const { origin, start, end } = getTimelineBounds(container);
	const min = Math.max(start, 8 - origin);
	const max = Math.max(min, Math.min(end, document.documentElement.clientWidth - 8 - origin));
	const pills = entries.filter(d => d.pill).map(d => {
		d.pill.style.maxWidth = `${Math.max(0, max - min)}px`;
		const { width, height } = d.pill.getBoundingClientRect();
		return { ...d, width, height, left: Math.max(min, Math.min(d.x - width / 2, max - width)), top: 34 };
	});
	if (pills.length === 2) {
		const [from, to] = pills;
		if (from.left + from.width + 10 > to.left) {
			if (from.width + to.width + 10 <= max - min) {
				from.left = Math.max(min, Math.min(from.left, max - from.width - to.width - 10));
				to.left = Math.max(to.left, from.left + from.width + 10);
			} else {
				to.top = from.top + from.height + 8;
			}
		}
	}
	pills.forEach(({ pill, x, left, top, width }) => {
		// Anchor the caret inside the pill, then skew its tip back to the selected date.
		const caretX = Math.max(6, Math.min(x - left, width - 6));
		pill.style.left = `${left}px`;
		pill.style.top = `${top}px`;
		pill.style.setProperty('--timeline-caret-x', `${caretX}px`);
		pill.style.setProperty('--timeline-caret-height', `${top - 26}px`);
		pill.style.setProperty('--timeline-caret-skew', `${Math.atan((caretX - (x - left)) / (top - 26))}rad`);
	});
	container.style.height = `${Math.max(64, ...pills.map(d => d.top + d.height + 6))}px`;
}

function resolveNearestRangeHandle(index) {
	const distFrom = Math.abs(index - state.timeFromIndex);
	const distTo = Math.abs(index - state.timeToIndex);
	return distFrom <= distTo ? 'from' : 'to';
}

function getRangeHandleCurrentIndex(handle) {
	return handle === 'from' ? state.timeFromIndex : state.timeToIndex;
}

function handleRangeControlKeydown(event, handle) {
	const max = Math.max(0, state.timeColumns.length - 1);
	const jump = getTimelineKeyboardStep();
	const delta = event.shiftKey ? jump : 1;
	const currentIdx = getRangeHandleCurrentIndex(handle);
	if (event.key === 'Home') { event.preventDefault(); setTimeSelection(0, { activeHandle: handle }); return; }
	if (event.key === 'End') { event.preventDefault(); setTimeSelection(max, { activeHandle: handle }); return; }
	if (event.key === 'PageUp') { event.preventDefault(); setTimeSelection(currentIdx - jump, { activeHandle: handle }); return; }
	if (event.key === 'PageDown') { event.preventDefault(); setTimeSelection(currentIdx + jump, { activeHandle: handle }); return; }
	if (event.key === 'ArrowLeft') { event.preventDefault(); setTimeSelection(currentIdx - delta, { activeHandle: handle }); return; }
	if (event.key === 'ArrowRight') { event.preventDefault(); setTimeSelection(currentIdx + delta, { activeHandle: handle }); return; }
}

function wireRangeControlElement(element, handle, {
	dragContainer,
	dragCapture = element,
	refreshUI = null,
	focusOnPointerDown = true,
	ignoreTouchPointerEvents = false,
} = {}) {
	if (!element || element.__rangeControlWired) return;
	element.__rangeControlWired = true;

	element.addEventListener('focus', () => {
		setActiveTimeHandle(handle);
		if (typeof refreshUI === 'function') refreshUI();
	});

	element.addEventListener('blur', () => {
		if (typeof refreshUI !== 'function') return;
		requestAnimationFrame(() => refreshUI());
	});

	element.addEventListener('pointerdown', (event) => {
		if (ignoreTouchPointerEvents && event && event.pointerType === 'touch') return;
		event.preventDefault();
		setActiveTimeHandle(handle);
		if (focusOnPointerDown && element && typeof element.focus === 'function') {
			try { element.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
		}
		beginTimelineDrag(dragContainer, event, dragCapture, {
			onIndex: (idx) => setTimeSelection(idx, { activeHandle: handle })
		});
	});

	element.addEventListener('touchstart', (event) => {
		setActiveTimeHandle(handle);
		beginTimelineTouchDrag(dragContainer, event, dragCapture, {
			onIndex: (idx) => setTimeSelection(idx, { activeHandle: handle })
		});
	});

	element.addEventListener('keydown', (event) => {
		handleRangeControlKeydown(event, handle);
	});
}

function syncRangeSelectionState() {
	const norm = normalizeRange(state.timeFromIndex, state.timeToIndex);
	state.timeFromIndex = norm.from;
	state.timeToIndex = norm.to;
	state.selectedFromRaw = state.timeColumns[state.timeFromIndex] ?? null;
	state.selectedToRaw = state.timeColumns[state.timeToIndex] ?? null;
	state.timeIndex = state.timeToIndex;
	state.selectedTimeRaw = state.selectedToRaw;
	return norm;
}

function renderRangeTimelineMarkers(container, items, layout) {
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
			event.preventDefault();
			try { event.currentTarget.focus(); } catch (e) { /* ignore */ }
			const handle = resolveNearestRangeHandle(d.index);
			setActiveTimeHandle(handle);
			beginTimelineDrag(container, event, event.currentTarget, {
				onIndex: (idx) => setTimeSelection(idx, { activeHandle: handle })
			});
			setTimeSelection(d.index, { activeHandle: handle });
		})
		.on('keydown', (event, d) => {
			const key = event.key;
			if (key === 'Enter' || key === ' ') {
				event.preventDefault();
				event.stopPropagation();
				const handle = resolveNearestRangeHandle(d.index);
				setActiveTimeHandle(handle);
				setTimeSelection(d.index, { activeHandle: handle });
			}
		});

	markersEnter.merge(markersSel)
		.attr('data-index', d => String(d.index))
		.attr('aria-label', d => d.srText)
		.attr('tabindex', -1)
		.classed('is-active', false)
		.classed('is-complete', false)
		.classed('is-from', d => d.index === state.timeFromIndex)
		.classed('is-to', d => d.index === state.timeToIndex)
		.classed('is-in-range', d => d.index >= state.timeFromIndex && d.index <= state.timeToIndex)
		.style('left', d => `${getTimelineItemPixel(d, layout)}px`);
}

function updateRangeTimelineControls(container, items, layout) {
	const maxIdx = Math.max(0, items.length - 1);
	const pxFrom = getCachedTimelinePosition(container, state.timeFromIndex, layout.padding);
	const pxTo = getCachedTimelinePosition(container, state.timeToIndex, layout.padding);

	const rangeEl = container.querySelector('.timeline-range');
	if (rangeEl) {
		rangeEl.style.left = `${Math.min(pxFrom, pxTo)}px`;
		rangeEl.style.width = `${Math.max(2, Math.abs(pxTo - pxFrom))}px`;
		rangeEl.style.display = '';
	}

	const handleFrom = container.querySelector('button.timeline-handle--from');
	const handleTo = container.querySelector('button.timeline-handle--to');
	if (handleFrom) {
		handleFrom.style.left = `${pxFrom}px`;
		handleFrom.setAttribute('aria-valuemin', '0');
		handleFrom.setAttribute('aria-valuemax', String(maxIdx));
		handleFrom.setAttribute('aria-valuenow', String(state.timeFromIndex));
		handleFrom.setAttribute('aria-valuetext', items[state.timeFromIndex]?.srText || '');
	}
	if (handleTo) {
		handleTo.style.left = `${pxTo}px`;
		handleTo.setAttribute('aria-valuemin', '0');
		handleTo.setAttribute('aria-valuemax', String(maxIdx));
		handleTo.setAttribute('aria-valuenow', String(state.timeToIndex));
		handleTo.setAttribute('aria-valuetext', items[state.timeToIndex]?.srText || '');
	}
	refreshRangeTimelineHandleUI(container);

	const pillFrom = container.querySelector('.timeline-pill--from');
	if (pillFrom && items[state.timeFromIndex]) {
		pillFrom.textContent = `From: ${items[state.timeFromIndex].display}`;
		pillFrom.style.left = `${pxFrom}px`;
		pillFrom.style.display = '';
	}
	const pillTo = container.querySelector('.timeline-pill--to');
	if (pillTo && items[state.timeToIndex]) {
		pillTo.textContent = `To: ${items[state.timeToIndex].display}`;
		pillTo.style.left = `${pxTo}px`;
		pillTo.style.display = '';
	}
	positionTimelinePills(container, [{ pill: pillFrom, x: pxFrom }, { pill: pillTo, x: pxTo }]);

	if (!container.__rangeHandlesWired) {
		container.__rangeHandlesWired = true;
		const refreshUI = () => refreshRangeTimelineHandleUI(container);
		wireRangeControlElement(handleFrom, 'from', { dragContainer: container, refreshUI });
		wireRangeControlElement(handleTo, 'to', { dragContainer: container, refreshUI });
	}
}

function renderRangeTimeline(container) {
	const items = buildTimelineItems();
	if (!items.length) return;
	syncRangeSelectionState();

	const width = container.clientWidth || 0;
	if (!width) return;

	const layout = layoutTimeline(container, items, width);
	renderRangeTimelineMarkers(container, items, layout);
	renderTimelineTickLabels(container, computeTimelineTickLabelItems({ items, containerWidth: width, allHaveDates: layout.allHaveDates }), layout);
	updateRangeTimelineControls(container, items, layout);
}

function renderPointTimelineMarkers(container, items, layout, maxIdx) {
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
				const first = container.querySelector('button.timeline-marker[data-index="0"]');
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
			}
		});

	markersEnter.merge(markersSel)
		.attr('data-index', d => String(d.index))
		.attr('aria-label', d => d.srText)
		.attr('tabindex', 0)
		.classed('is-complete', d => d.index <= state.timeIndex)
		.classed('is-active', d => d.index === state.timeIndex)
		.style('left', d => `${getTimelineItemPixel(d, layout)}px`);
}

function updatePointTimelinePill(container, items, layout) {
	const pill = container.querySelector('.timeline-pill');
	if (pill && items[state.timeIndex]) {
		const active = items[state.timeIndex];
		pill.textContent = active.display;
		pill.style.left = `${getTimelineItemPixel(active, layout)}px`;
		pill.style.display = '';
		positionTimelinePills(container, [{ pill, x: getTimelineItemPixel(active, layout) }]);
	} else if (pill) {
		pill.style.display = 'none';
	}
}

function renderPointTimeline(container) {
	const items = buildTimelineItems();
	const maxIdx = Math.max(0, items.length - 1);
	state.timeIndex = Math.max(0, Math.min(state.timeIndex, maxIdx));

	container.setAttribute('aria-valuemin', '0');
	container.setAttribute('aria-valuemax', String(maxIdx));
	container.setAttribute('aria-valuenow', String(state.timeIndex));
	container.setAttribute('aria-valuetext', items[state.timeIndex] ? items[state.timeIndex].srText : '');

	const width = container.clientWidth || 0;
	if (!width || items.length === 0) return;

	const layout = layoutTimeline(container, items, width);
	renderPointTimelineMarkers(container, items, layout, maxIdx);
	renderTimelineTickLabels(container, computeTimelineTickLabelItems({ items, containerWidth: width, allHaveDates: layout.allHaveDates }), layout);
	updatePointTimelinePill(container, items, layout);
}

function getTimelineConfig() {
	const t = resolveDatasetOption('timeline', {});
	let mode = t.mode || 'auto';
	if (!['auto', 'pearls', 'continuous'].includes(mode)) {
		console.error("[Map Config] Invalid timeline.mode; expected 'auto', 'pearls' or 'continuous'. Got:", mode);
		mode = 'auto';
	}
	return {
		mode,
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

function getTimelineSize(width) {
	const w = Number.isFinite(+width) ? +width : 0;
	if (w && w < globalConfig.mobileBreakpoint) return 'sm';
	if (w && w < globalConfig.mediumBreakpoint) return 'md';
	return 'lg';
}

function getTimelineTickTextConfig() {
	const t = resolveDatasetOption('timeline', {});
	const raw = t.ticktext;
	if (!raw) return null;

	const method = String(raw.tickMethod || 'interval').toLowerCase();
	const tickCount = (raw.tickCount && typeof raw.tickCount === 'object') ? raw.tickCount : null;
	const tickInterval = (raw.tickInterval && typeof raw.tickInterval === 'object') ? raw.tickInterval : null;

	return {
		tickMethod: (method === 'total' || method === 'interval') ? method : 'interval',
		tickCount,
		tickInterval,
		addFirstDate: Boolean(raw.addFirstDate),
		addFinalDate: Boolean(raw.addFinalDate)
	};
}

function resolveTickCount(cfg, size, fallback) {
	if (!cfg || !cfg.tickCount) return fallback;
	const v = cfg.tickCount[size];
	const n = Number.isFinite(+v) ? +v : fallback;
	return n > 0 ? n : fallback;
}

function resolveTickInterval(cfg, size) {
	const fallback = { unit: 'year', step: { sm: 1, md: 1, lg: 1 } };
	const interval = cfg && cfg.tickInterval ? cfg.tickInterval : fallback;
	const unit = String(interval.unit || fallback.unit).toLowerCase();
	const stepRaw = interval.step;
	const step = (typeof stepRaw === 'object' && stepRaw) ? stepRaw[size] : stepRaw;
	const stepN = Number.isFinite(+step) ? +step : 1;
	return { unit, step: stepN > 0 ? stepN : 1 };
}

function computeTimelineTickLabelIndices({ items, size, allHaveDates, tickCfg }) {
	const n = items.length;
	const maxIdx = Math.max(0, n - 1);
	if (!n) return [];
	if (!tickCfg) return items.map(d => d.index);

	const indices = new Set();
	const addIndex = (i) => {
		const idx = Math.max(0, Math.min(maxIdx, Math.round(i)));
		indices.add(idx);
	};

	const method = tickCfg.tickMethod || 'interval';
	const usesTickCount = method === 'total' || !allHaveDates;

	if (allHaveDates) {
		const dated = items.filter(d => d.date instanceof Date && Number.isFinite(d.date.getTime()));
		if (!dated.length) {
			// Nothing parseable; fallback to labeling all.
			return items.map(d => d.index);
		}
		const start = dated.reduce((a, b) => (a.date < b.date ? a : b)).date;
		const end = dated.reduce((a, b) => (a.date > b.date ? a : b)).date;
		const nearestIndexForDate = (target) => {
			let best = dated[0].index;
			let bestDist = Infinity;
			const t = target.getTime();
			for (const it of dated) {
				const dist = Math.abs(it.date.getTime() - t);
				if (dist < bestDist) {
					bestDist = dist;
					best = it.index;
				}
			}
			return best;
		};

		let tickDates = [];
		if (method === 'total') {
			const count = resolveTickCount(tickCfg, size, 5);
			tickDates = d3.scaleTime().domain([start, end]).ticks(count);
		} else {
			const interval = resolveTickInterval(tickCfg, size);
			let d3Interval;
			switch (interval.unit) {
				case 'year':
					d3Interval = d3.timeYear.every(interval.step);
					break;
				case 'month':
					d3Interval = d3.timeMonth.every(interval.step);
					break;
				case 'quarter':
					d3Interval = d3.timeMonth.every(interval.step * 3);
					break;
				case 'day':
					d3Interval = d3.timeDay.every(interval.step);
					break;
				default:
					d3Interval = d3.timeYear.every(1);
			}
			tickDates = d3Interval ? d3Interval.range(start, d3.timeDay.offset(end, 1)) : [];
		}

		if (!Array.isArray(tickDates)) tickDates = [];
		for (const d of tickDates) {
			if (!(d instanceof Date) || !Number.isFinite(d.getTime())) continue;
			addIndex(nearestIndexForDate(d));
		}
	} else {
		// Non-date headers: interval doesn't make sense; treat as total.
		const count = resolveTickCount(tickCfg, size, 5);
		const candidates = d3.ticks(0, maxIdx, count);
		for (const v of candidates) addIndex(v);
	}

	// Forced endpoints occupy slots within the configured maximum.
	const forcedIndices = [];
	if (tickCfg.addFinalDate) forcedIndices.push(maxIdx);
	if (tickCfg.addFirstDate && !forcedIndices.includes(0)) forcedIndices.push(0);
	forcedIndices.forEach(addIndex);

	if (usesTickCount) {
		const maxCount = Math.max(1, Math.floor(resolveTickCount(tickCfg, size, 5)));
		const forced = forcedIndices.slice(0, maxCount);
		const forcedSet = new Set(forced);
		const candidates = Array.from(indices)
			.filter(index => !forcedSet.has(index))
			.sort((a, b) => a - b);
		const slots = maxCount - forced.length;

		if (candidates.length > slots) {
			const sampled = [];
			for (let i = 0; i < slots; i++) {
				const position = slots === 1
					? 0
					: Math.round(i * (candidates.length - 1) / (slots - 1));
				sampled.push(candidates[position]);
			}
			return forced.concat(sampled).sort((a, b) => a - b);
		}

		return forced.concat(candidates).sort((a, b) => a - b);
	}

	return Array.from(indices).sort((a, b) => a - b);
}

function computeTimelineTickLabelItems({ items, containerWidth, allHaveDates }) {
	const tickCfg = getTimelineTickTextConfig();
	const size = getTimelineSize(containerWidth);
	const idxs = computeTimelineTickLabelIndices({ items, size, allHaveDates, tickCfg });
	return idxs.map(i => items[i]).filter(Boolean);
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

	const t = getTimelineConfig();
	container.setAttribute('aria-label', t.ariaLabel);

	if (isRangeMode()) {
		container.classList.add('is-range');
		container.setAttribute('role', 'group');
		container.setAttribute('tabindex', '-1');
		container.removeAttribute('aria-valuemin');
		container.removeAttribute('aria-valuemax');
		container.removeAttribute('aria-valuenow');
		container.removeAttribute('aria-valuetext');
	} else {
		container.classList.remove('is-range');
		container.setAttribute('role', 'slider');
		container.setAttribute('tabindex', '0');
	}

	if (!container.querySelector('.timeline-track')) {
		const track = document.createElement('div');
		track.className = 'timeline-track';
		container.appendChild(track);
	}

	if (isRangeMode()) {
		const singlePill = container.querySelector('.timeline-pill:not(.timeline-pill--from):not(.timeline-pill--to)');
		if (singlePill) singlePill.remove();

		if (!container.querySelector('.timeline-range')) {
			const range = document.createElement('div');
			range.className = 'timeline-range';
			container.appendChild(range);
		}
		if (!container.querySelector('.timeline-pill--from')) {
			const pill = document.createElement('div');
			pill.className = 'timeline-pill timeline-pill--from';
			container.appendChild(pill);
		}
		if (!container.querySelector('.timeline-pill--to')) {
			const pill = document.createElement('div');
			pill.className = 'timeline-pill timeline-pill--to';
			container.appendChild(pill);
		}
		if (!container.querySelector('button.timeline-handle--from')) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'timeline-handle timeline-handle--from';
			btn.setAttribute('data-handle', 'from');
			btn.setAttribute('role', 'slider');
			btn.setAttribute('tabindex', '0');
			btn.setAttribute('aria-label', 'From');
			container.appendChild(btn);
		}
		if (!container.querySelector('button.timeline-handle--to')) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'timeline-handle timeline-handle--to';
			btn.setAttribute('data-handle', 'to');
			btn.setAttribute('role', 'slider');
			btn.setAttribute('tabindex', '0');
			btn.setAttribute('aria-label', 'To');
			container.appendChild(btn);
		}
	} else {
		if (!container.querySelector('.timeline-pill')) {
			const pill = document.createElement('div');
			pill.className = 'timeline-pill';
			container.appendChild(pill);
		}
		// Clean up any range-only elements if switching modes
		const range = container.querySelector('.timeline-range');
		if (range) range.remove();
		const pillFrom = container.querySelector('.timeline-pill--from');
		if (pillFrom) pillFrom.remove();
		const pillTo = container.querySelector('.timeline-pill--to');
		if (pillTo) pillTo.remove();
		const hFrom = container.querySelector('button.timeline-handle--from');
		if (hFrom) hFrom.remove();
		const hTo = container.querySelector('button.timeline-handle--to');
		if (hTo) hTo.remove();
		container.__rangeHandlesWired = false;
	}
}

function renderTimeline() {
	const container = document.getElementById('timeline-slider');
	if (!container) return;
	ensureTimelineScaffold(container);
	if (isRangeMode()) {
		renderRangeTimeline(container);
		return;
	}

	renderPointTimeline(container);
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
		if (event.target && event.target.closest && event.target.closest('button.timeline-handle')) return;
		event.preventDefault();
		if (event.pointerType !== 'touch' && !isRangeMode()) {
			try { container.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
		}
		beginTimelineDrag(container, event, container, {
			onIndex: (idx) => {
				if (isRangeMode()) {
					// choose nearest handle to the intended index
					const distFrom = Math.abs(idx - state.timeFromIndex);
					const distTo = Math.abs(idx - state.timeToIndex);
					setActiveTimeHandle(distFrom <= distTo ? 'from' : 'to');
					setTimeSelection(idx);
				} else {
					setTimeSelection(idx);
				}
			}
		});
	});

	container.addEventListener('keydown', (event) => {
		// In range mode, keyboard is handled by the individual handles.
		if (isRangeMode()) return;
		// If a marker has focus, it handles its own keydown.
		if (event.target !== container) return;

		const maxIdx = Math.max(0, state.timeColumns.length - 1);
		const jump = getTimelineKeyboardStep();
		const delta = event.shiftKey ? jump : 1;

		if (event.key === 'Home') { event.preventDefault(); setTimeSelection(0); return; }
		if (event.key === 'End') { event.preventDefault(); setTimeSelection(maxIdx); return; }
		if (event.key === 'PageUp') { event.preventDefault(); setTimeSelection(state.timeIndex - jump); return; }
		if (event.key === 'PageDown') { event.preventDefault(); setTimeSelection(state.timeIndex + jump); return; }
		if (event.key === 'ArrowLeft') { event.preventDefault(); setTimeSelection(state.timeIndex - delta); return; }
		if (event.key === 'ArrowRight') { event.preventDefault(); setTimeSelection(state.timeIndex + delta); return; }
	});
}

function setTimelineUI() {
	wireTimelineEvents();
	renderTimeline();
}

// Backwards-compat wrapper used by existing drag/marker handlers.
function setTimeIndex(nextIndex) {
	setTimeSelection(nextIndex);
}

function renderDatasetSwitch() {
	const container = document.getElementById('dataset-switch-container');
	if (!container) return;

	const datasets = Array.isArray(config.datasets) && config.datasets.length ? config.datasets : [{ label: 'Data', url: config.dataUrl }];
	container.innerHTML = '';

	if (datasets.length <= 1) return;

	const fieldset = document.createElement('fieldset');
	fieldset.className = 'dataset-switch-fieldset';
	fieldset.style = 'border: none; padding: 0; margin: 0;';
	fieldset.setAttribute('role', 'radiogroup');

	const legend = document.createElement('legend');
	// legend.textContent = 'Select dataset';
	fieldset.appendChild(legend);

	const buttonsWrapper = document.createElement('div');
	buttonsWrapper.id = 'dataset-switch-buttons';
	buttonsWrapper.className = 'dataset-switch-buttons';
	const groupName = 'file-switch-group';

	datasets.forEach((ds, idx) => {
		const id = `file-switch-${idx}`;
		const wrapper = document.createElement('div');
		wrapper.className = 'dataset-switch-option';
		wrapper.style = 'display: flex; align-items: center; gap: 6px;';

		const radio = document.createElement('input');
		radio.type = 'radio';
		radio.name = groupName;
		radio.id = id;
		radio.value = String(idx);
		radio.checked = idx === state.datasetIndex;

		const label = document.createElement('label');
		label.className = 'dataset-switch-button';
		label.setAttribute('for', id);
		label.style = 'font-size: 15px; cursor: pointer;';

		const labelText = document.createElement('span');
		labelText.className = 'dataset-switch-button-text';
		labelText.textContent = ds.label || ds.url;
		label.appendChild(labelText);

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


function getOverlayInnerHeightPx() {
	const overlay = document.getElementById('chart-overlay');
	if (!overlay || overlay.classList.contains('hidden')) return null;
	const rect = overlay.getBoundingClientRect();
	if (!rect || !Number.isFinite(rect.height) || rect.height <= 0) return null;
	let padTop = 0;
	let padBottom = 0;
	try {
		const cs = window.getComputedStyle(overlay);
		padTop = parseFloat(cs.paddingTop) || 0;
		padBottom = parseFloat(cs.paddingBottom) || 0;
	} catch (e) {
		padTop = 0;
		padBottom = 0;
	}
	const inner = rect.height - padTop - padBottom;
	return Number.isFinite(inner) && inner > 0 ? inner : null;
}

function createChartOptionResolver(chartCfg, datasetChartCfg) {
	return (key, fallback = undefined) => {
		if (Object.prototype.hasOwnProperty.call(datasetChartCfg, key)) {
			return datasetChartCfg[key];
		}
		const raw = chartCfg[key];
		if (!Array.isArray(raw)) return (typeof raw === 'undefined') ? fallback : raw;
		const idx = (state && typeof state.datasetIndex === 'number') ? state.datasetIndex : 0;
		const resolved = (idx >= 0 && idx < raw.length) ? raw[idx] : raw[0];
		return (typeof resolved === 'undefined') ? fallback : resolved;
	};
}

function resolveChartYTicks(resolveChartOption, overlayMode, fallback) {
	const modeKey = overlayMode === 'hover' ? 'hover' : 'pinned';
	const cfg = resolveChartOption('yTicks');
	let value = cfg;
	if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
		value = cfg[modeKey];
		if (value === null || typeof value === 'undefined') value = cfg.default;
	}
	const n = (value === null || typeof value === 'undefined') ? NaN : Math.round(+value);
	return (Number.isFinite(n) && n > 0) ? n : fallback;
}

function measureChartMetaHeights({ headerMeta, legend, initialSubTitle }) {
	let headerHeight = 0;
	let legendHeight = 0;
	try {
		const rect = headerMeta && headerMeta.node ? headerMeta.node().getBoundingClientRect() : null;
		headerHeight = (rect && Number.isFinite(rect.height)) ? rect.height : 0;
	} catch (e) {
		headerHeight = initialSubTitle ? 40 : 25;
	}
	try {
		const rect = legend && legend.node ? legend.node().getBoundingClientRect() : null;
		legendHeight = rect ? rect.height : 0;
		legendHeight += 8;
	} catch (e) {
		legendHeight = 28;
	}
	return { headerHeight, legendHeight };
}

function createChartTimelinePillGroup(g, { className, ariaLabel }) {
	const group = g.append('g')
		.attr('class', className)
		.attr('tabindex', 0)
		.attr('role', 'slider')
		.attr('aria-label', ariaLabel)
		.style('cursor', 'pointer')
		.style('touch-action', 'none')
		.style('display', 'none');

	const rect = group.append('rect')
		.attr('fill', 'var(--ons-color-ocean-blue)')
		.attr('stroke', 'none');

	const text = group.append('text')
		.attr('text-anchor', 'middle')
		.attr('dominant-baseline', 'middle')
		.attr('fill', 'var(--ons-color-white)')
		.style('font-size', '15px')
		.style('font-weight', '700');

	return { group, rect, text };
}

function layoutChartPill(pill, xPos, yPos) {
	const { group, rect, text } = pill;
	text.attr('x', 0).attr('y', 0).attr('transform', null);
	let textWidth = 0;
	let textBox = null;
	try {
		textBox = text.node().getBBox();
		textWidth = textBox.width;
	} catch (e) {
		textWidth = 0;
		textBox = null;
	}
	const padX = 10;
	const pillHeight = 22;
	const pillWidth = Math.max(24, textWidth + padX * 2);
	group.attr('transform', `translate(${xPos},${yPos})`);
	rect
		.attr('x', -pillWidth / 2)
		.attr('y', 0)
		.attr('width', pillWidth)
		.attr('height', pillHeight)
		.attr('rx', Math.max(2, Math.round(pillHeight * 0.35)))
		.attr('ry', Math.max(2, Math.round(pillHeight * 0.35)));
	if (textBox) {
		const dy = (pillHeight / 2) - (textBox.y + textBox.height / 2);
		text.attr('transform', `translate(0,${dy})`);
	} else {
		text.attr('y', pillHeight / 2);
	}
}

function applySeparatedChartPillPositions(fromPill, toPill, xFrom, xTo, innerWidth, yPos) {
	let wFrom = 0;
	let wTo = 0;
	try { wFrom = fromPill.rect.attr('width') ? +fromPill.rect.attr('width') : 0; } catch (e) { wFrom = 0; }
	try { wTo = toPill.rect.attr('width') ? +toPill.rect.attr('width') : 0; } catch (e) { wTo = 0; }
	wFrom = Number.isFinite(wFrom) && wFrom > 0 ? wFrom : 40;
	wTo = Number.isFinite(wTo) && wTo > 0 ? wTo : 40;
	const dist = Math.abs(xTo - xFrom);
	const minGap = (wFrom / 2) + (wTo / 2) + 10;
	if (!Number.isFinite(dist) || dist <= 0 || dist >= minGap) return;
	const push = (minGap - dist) / 2;
	const dir = xFrom <= xTo ? 1 : -1;
	const minFrom = wFrom / 2;
	const maxFrom = innerWidth - (wFrom / 2);
	const minTo = wTo / 2;
	const maxTo = innerWidth - (wTo / 2);
	const xFromAdj = Math.max(minFrom, Math.min(maxFrom, xFrom + (-push * dir)));
	const xToAdj = Math.max(minTo, Math.min(maxTo, xTo + (push * dir)));
	fromPill.group.attr('transform', `translate(${xFromAdj},${yPos})`);
	toPill.group.attr('transform', `translate(${xToAdj},${yPos})`);
}

function createSeriesLookup(series) {
	const lookup = new Map();
	if (!Array.isArray(series)) return lookup;
	for (const point of series) {
		if (!point || typeof point.t === 'undefined') continue;
		lookup.set(point.t, point);
	}
	return lookup;
}

function updateChartChangeSummaryElement({
	changeSummary,
	changeSummaryCfg,
	selectionMode,
	areaSeries,
	timeFromIndex,
	timeToIndex,
	colourScale,
	solidStroke,
}) {
	const summaryEnabled = changeSummaryCfg.enabled !== false;
	const summaryThresholdRaw = (changeSummaryCfg.threshold === null || typeof changeSummaryCfg.threshold === 'undefined')
		? 0
		: +changeSummaryCfg.threshold;
	const summaryThreshold = Number.isFinite(summaryThresholdRaw) ? Math.abs(summaryThresholdRaw) : 0;
	const summaryNoChangeText = changeSummaryCfg.noSignificantChangeText || 'No significant change';
	const summaryIncreaseText = changeSummaryCfg.increaseText || 'Increase';
	const summaryDecreaseText = changeSummaryCfg.decreaseText || 'Decrease';
	const summaryIndicatorStyle = String(changeSummaryCfg.indicatorStyle || 'triangle').toLowerCase();
	const summaryContrast = Number.isFinite(+changeSummaryCfg.requiredContrast) ? +changeSummaryCfg.requiredContrast : 4.5;
	const summaryNeutralColour = changeSummaryCfg.neutralColour || 'var(--ons-color-grey-60)';
	const showChangeSummary = shouldRenderChartChangeSummary({ selectionMode, changeSummaryCfg, areaSeries });

	if (!showChangeSummary) {
		changeSummary.text('');
		setChartChangeSummaryVisibility(changeSummary, false);
		return;
	}

	const fromIdx = clampTimeIndex(timeFromIndex ?? state.timeFromIndex);
	const toIdx = clampTimeIndex(timeToIndex ?? state.timeToIndex);
	const fromPoint = areaSeries[fromIdx] || null;
	const toPoint = areaSeries[toIdx] || null;
	const changeValue = computeRangeSelectionValue(fromPoint?.v ?? null, toPoint?.v ?? null);
	if (changeValue === null || !Number.isFinite(changeValue)) {
		changeSummary.text('');
		setChartChangeSummaryVisibility(changeSummary, false);
		return;
	}
	if (Math.abs(changeValue) <= summaryThreshold) {
		changeSummary
			.text(summaryNoChangeText)
			.style('color', summaryNeutralColour);
		setChartChangeSummaryVisibility(changeSummary, true);
		return;
	}

	const baseColour = (colourScale && Number.isFinite(changeValue))
		? (() => { try { return colourScale(changeValue); } catch (e) { return solidStroke; } })()
		: solidStroke;
	const textColour = adjustColorForContrast(baseColour || solidStroke, summaryContrast, '#FFFFFF');
	const magnitudeText = formatConfiguredChangeValue(Math.abs(changeValue));
	let summaryText = magnitudeText;
	if (summaryIndicatorStyle === 'text') {
		summaryText = `${changeValue > 0 ? summaryIncreaseText : summaryDecreaseText} ${magnitudeText}`;
	} else if (summaryIndicatorStyle === 'triangle') {
		summaryText = `${changeValue > 0 ? '▲' : '▼'} ${magnitudeText}`;
	}
	changeSummary
		.text(summaryText)
		.style('color', textColour);
	setChartChangeSummaryVisibility(changeSummary, true);
}

function applyChartEmptyState({
	gridG,
	xAxisG,
	yAxisG,
	yTicksEmpty,
	innerWidth,
	yScaleSwatchesG,
	areaPath,
	areaGradient,
	meanPath,
	marker,
	vlineFrom,
	vline,
	indicatorTriangle,
	indicatorValueFrom,
	indicatorValue,
	chartPillFrom,
	chartPillTo,
}) {
	gridG.call(d3.axisLeft(d3.scaleLinear()).tickValues([]).tickSize(-innerWidth).tickFormat(''));
	xAxisG.call(d3.axisBottom(d3.scalePoint()).tickValues([]));
	yAxisG.call(d3.axisLeft(d3.scaleLinear()).ticks(yTicksEmpty));
	yScaleSwatchesG.style('display', 'none').selectAll('rect').remove();
	areaPath.style('opacity', 0);
	areaGradient.selectAll('stop').remove();
	meanPath.style('opacity', 0);
	marker.style('opacity', 0);
	vlineFrom.style('opacity', 0);
	vline.style('opacity', 0);
	indicatorTriangle.style('opacity', 0);
	indicatorValueFrom.style('opacity', 0);
	indicatorValue.style('opacity', 0);
	chartPillFrom.group.style('display', 'none');
	chartPillTo.group.style('display', 'none');
}

function updateChartSwatches({ showBreaks, colourScale, breaks, y, innerHeight, yScaleSwatchesG }) {
	if (!(showBreaks && colourScale && typeof colourScale.range === 'function')) {
		yScaleSwatchesG.style('display', 'none').selectAll('rect').remove();
		return;
	}

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
				c,
			};
		}).filter(d => Number.isFinite(d.b0) && Number.isFinite(d.b1) && d.b0 !== d.b1);
	}

	bins = bins.filter(d => {
		const lo = Math.min(d.b0, d.b1);
		const hi = Math.max(d.b0, d.b1);
		return hi > domLo && lo < domHi;
	});

	if (!bins.length) {
		yScaleSwatchesG.style('display', 'none').selectAll('rect').remove();
		return;
	}

	yScaleSwatchesG.style('display', null);
	const rects = yScaleSwatchesG.selectAll('rect').data(bins, d => d.i);
	rects.exit().remove();
	rects.enter().append('rect')
		.merge(rects)
		.attr('x', 2)
		.attr('width', 10)
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

function shouldRenderChartChangeSummary({ selectionMode, changeSummaryCfg, areaSeries = null }) {
	const summaryEnabled = !changeSummaryCfg || changeSummaryCfg.enabled !== false;
	return summaryEnabled && selectionMode === 'range' && (areaSeries === null || Array.isArray(areaSeries));
}

function setChartChangeSummaryVisibility(changeSummary, shouldShow) {
	changeSummary
		.style('display', shouldShow ? null : 'none')
		.style('visibility', shouldShow ? 'visible' : 'hidden');
}

function updateAreaSeriesStroke({ areaSeries, areaPath, areaGradient, x, colourScale, lineStyleDefault, solidStroke, innerWidth }) {
	if (!areaSeries) {
		areaPath.style('opacity', 0);
		areaGradient.selectAll('stop').remove();
		return;
	}

	areaPath.style('opacity', 1);
	if (lineStyleDefault === 'solid') {
		areaPath.style('stroke', solidStroke);
		areaGradient.selectAll('stop').remove();
		return;
	}

	areaPath.style('stroke', `url(#${areaGradient.attr('id')})`);
	const thresholds = (colourScale && typeof colourScale.domain === 'function') ? (colourScale.domain() || []) : [];
	const segments = [];
	for (let i = 0; i < areaSeries.length - 1; i++) {
		const a = areaSeries[i];
		const b = areaSeries[i + 1];
		if (!a || !b || a.v === null || b.v === null) continue;
		const x0 = x(a.t);
		const x1 = x(b.t);
		if (typeof x0 !== 'number' || typeof x1 !== 'number') continue;
		const v0 = a.v;
		const v1 = b.v;
		if (!Number.isFinite(v0) || !Number.isFinite(v1)) continue;

		const pts = [{ x: x0, v: v0 }];
		if (v0 !== v1 && thresholds.length) {
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
			segments.push({ x0: p0.x, x1: p1.x, c: c || solidStroke });
		}
	}

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
	stops.sort((a, b) => a.o - b.o);
	if (!stops.length) {
		stops.push({ o: 0, c: solidStroke }, { o: 1, c: solidStroke });
	} else {
		if (stops[0].o > 0) stops.unshift({ o: 0, c: stops[0].c });
		if (stops[stops.length - 1].o < 1) stops.push({ o: 1, c: stops[stops.length - 1].c });
	}

	const stopSel = areaGradient.selectAll('stop').data(stops);
	stopSel.exit().remove();
	stopSel.enter()
		.append('stop')
		.merge(stopSel)
		.attr('offset', d => `${(d.o * 100).toFixed(2)}%`)
		.attr('stop-color', d => d.c);
}

function createChart({ overlayInnerHeight = null } = {}) {
	const container = d3.select('#chart');
	container.html('');
	const chartCfg = (config && config.chart && typeof config.chart === 'object') ? config.chart : {};
	const datasetCfg = getCurrentDatasetConfig();
	const datasetChartCfg = (datasetCfg && datasetCfg.chart && typeof datasetCfg.chart === 'object') ? datasetCfg.chart : {};
	const resolveChartOption = createChartOptionResolver(chartCfg, datasetChartCfg);
	const resolveYTicks = (fallback) => resolveChartYTicks(resolveChartOption, state.overlayMode, fallback);
	const getChartSubTitle = () => {
		const v = resolveChartOption('subTitle', '');
		return (typeof v === 'string') ? v : (v === null || typeof v === 'undefined') ? '' : String(v);
	};
	const initialSelectionMode = isRangeMode() ? 'range' : 'point';
	const initialChangeSummaryCfgResolved = resolveChartOption('changeSummary', {});
	const initialChangeSummaryCfg = (initialChangeSummaryCfgResolved && typeof initialChangeSummaryCfgResolved === 'object')
		? initialChangeSummaryCfgResolved
		: {};
	const solidStroke = chartCfg.solidStroke || 'var(--ons-color-ocean-blue)';
	const lineStyleDefault = chartCfg.lineStyle || 'gradient';
	const showMeanLine = (typeof chartCfg.showMeanLine === 'boolean') ? chartCfg.showMeanLine : true;
	const showBreaks = (typeof chartCfg.showBreaks === 'boolean') ? chartCfg.showBreaks : false;
	const zeroLineValue = (chartCfg.zeroLine === null || typeof chartCfg.zeroLine === 'undefined') ? null : +chartCfg.zeroLine;
	const width = Math.floor(container.node()?.getBoundingClientRect().width || 0);
	if (!width || width < 50) {
		// Overlay not visible or not yet laid out.
		return {
			__width: 0,
			update: () => { /* no-op until we have a real width */ }
		};
	}
	const margin = (chartCfg.margin && typeof chartCfg.margin === 'object')
		? { ...{ top: 10, right: 20, bottom: 30, left: 50 }, ...chartCfg.margin }
		: { top: 10, right: 20, bottom: 30, left: 50 };
	const innerWidth = Math.max(10, width - margin.left - margin.right);

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
		.style('color', solidStroke)
		.style('pointer-events', 'none')
		.style('white-space', 'nowrap')
		.style('overflow', 'hidden');

	const headerMeta = container.append('div')
		.attr('class', 'chart-meta');

	const subtitle = headerMeta.append('div')
		.attr('class', 'chart-subtitle')
		.style('margin', '0 0 8px 0')
		.style('font-size', '13px')
		.style('line-height', '1.25')
		.style('color', 'var(--ons-color-grey-60)');
	const changeSummary = headerMeta.append('div')
		.attr('class', 'chart-change-summary')
		.style('margin', '0 0 8px 0')
		.style('min-height', '17px')
		.style('font-size', '13px')
		.style('font-weight', '700')
		.style('line-height', '1.25')
		.style('visibility', 'hidden')
		.style('color', 'var(--ons-color-grey-60)')
		.text('');
	setChartChangeSummaryVisibility(
		changeSummary,
		shouldRenderChartChangeSummary({
			selectionMode: initialSelectionMode,
			changeSummaryCfg: initialChangeSummaryCfg,
		})
	);
	const initialSubTitle = getChartSubTitle();
	if (initialSubTitle) {
		subtitle.html(initialSubTitle).style('display', null);
	} else {
		subtitle.html('').style('display', 'none');
	}

	const meanLegendCfg = chartCfg.meanLegend || { label: 'Average', color: 'var(--ons-color-grey-60)' };
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

	// Plot wrapper so we can overlay a "no data" message without affecting layout.
	const plotWrap = container.append('div')
		.attr('class', 'chart-plotwrap')
		.style('position', 'relative');

	const heightFallback = 220;
	let height = heightFallback;
	if (overlayInnerHeight !== null && Number.isFinite(+overlayInnerHeight)) {
		const { headerHeight, legendHeight } = measureChartMetaHeights({ headerMeta, legend, initialSubTitle });
		height = Math.max(120, Math.floor(overlayInnerHeight - headerHeight - legendHeight));
	}

	const innerHeight = Math.max(10, height - margin.top - margin.bottom);

	const tCfg = getTimelineConfig();
	const fmtPillDisplay = d3.timeFormat(tCfg.displayFormat);
	const fmtPillSR = d3.timeFormat(tCfg.screenreaderFormat);
	const formatPillLabel = (raw) => {
		const d = parseTimeColumn(raw);
		return {
			display: d ? fmtPillDisplay(d) : String(raw ?? ''),
			srText: d ? fmtPillSR(d) : String(raw ?? '')
		};
	};

	const svg = plotWrap.append('svg')
		.attr('width', width)
		.attr('height', height)
		.attr('class', 'chart');

	const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

	const x = d3.scalePoint().range([0, innerWidth]).padding(0.5);
	const y = d3.scaleLinear().range([innerHeight, 0]);

	const gridG = g.append('g')
		.attr('class', 'grid');

	const zeroLineTick = g.append('g')
		.attr('class', 'tick zero-line-tick')
		.style('display', 'none')
		.style('pointer-events', 'none');
	const zeroLine = zeroLineTick.append('line')
		.attr('class', 'zero-line')
		.attr('x1', 0)
		.attr('x2', innerWidth)
		.attr('y1', 0)
		.attr('y2', 0);

	const yScaleSwatchesG = g.append('g')
		.attr('class', 'y-scale-swatches')
		.style('pointer-events', 'none')
		.style('display', 'none');

	const vlineFrom = g.append('line')
		.attr('class', 'chart-vline chart-vline--from')
		.style('stroke', 'var(--ons-color-grey-50)')
		.attr('stroke-width', 2)
		.attr('stroke-dasharray', '4 3')
		.attr('y1', 0)
		.attr('y2', innerHeight)
		.style('opacity', 0);

	const vline = g.append('line')
		.attr('class', 'chart-vline chart-vline--to')
		.style('stroke', 'var(--ons-color-grey-50)')
		.attr('stroke-width', 2)
		.attr('stroke-dasharray', '4 3')
		.attr('y1', 0)
		.attr('y2', innerHeight)
		.style('opacity', 0);

	const indicatorTriangle = g.append('path')
		.attr('class', 'indicator-triangle')
		.attr('fill', solidStroke)
		.style('opacity', 0)
		.style('pointer-events', 'none');

	const indicatorValue = g.append('text')
		.attr('class', 'indicator-value')
		.attr('text-anchor', 'middle')
		.attr('x', 0)
		.attr('y', -4)
		.style('font-size', '15px')
		.style('font-weight', '700')
		.attr('fill', solidStroke)
		.style('opacity', 0)
		.style('pointer-events', 'none');

	const indicatorValueFrom = g.append('text')
		.attr('class', 'indicator-value indicator-value--from')
		.attr('text-anchor', 'middle')
		.attr('x', 0)
		.attr('y', -4)
		.style('font-size', '15px')
		.style('font-weight', '700')
		.attr('fill', solidStroke)
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
		.style('stroke', lineStyleDefault === 'solid'
			? solidStroke
			: `url(#${gradientId})`)
		.style('stroke-linejoin', 'round')
		.style('stroke-linecap', 'round')
		.style('opacity', 0);

	// In-chart message for selected areas with no usable data (missing row or all-null values).
	// Inserted after the mean/series lines so it sits on top of them.
	const noDataText = g.append('text')
		.attr('class', 'chart-nodata-text')
		.attr('x', innerWidth / 2)
		// Slightly below vertical center for readability.
		.attr('y', (innerHeight / 2) + 8)
		.attr('text-anchor', 'middle')
		.attr('dominant-baseline', 'middle')
		.attr('fill', solidStroke)
		.attr('fill-opacity', 0.6)
		.style('font-size', '19px')
		.style('font-weight', '700')
		.style('pointer-events', 'none')
		.style('opacity', 0)
		.text('Data Unavailable');

	const xAxisG = g.append('g')
		.attr('class', 'x axis')
		.attr('transform', `translate(0,${innerHeight})`);
	const yAxisG = g.append('g')
		.attr('class', 'y axis numeric');

	const chartPillFrom = createChartTimelinePillGroup(g, {
		className: 'chart-timeline-pill chart-timeline-pill--from',
		ariaLabel: `${tCfg.ariaLabel} (From)`
	});
	const chartPillTo = createChartTimelinePillGroup(g, {
		className: 'chart-timeline-pill',
		ariaLabel: tCfg.ariaLabel
	});
	const chartPillFromG = chartPillFrom.group;
	const chartPillFromText = chartPillFrom.text;
	const chartPillG = chartPillTo.group;
	const chartPillText = chartPillTo.text;

	wireRangeControlElement(chartPillFromG.node(), 'from', {
		dragContainer: svg.node(),
		dragCapture: chartPillFromG.node(),
		ignoreTouchPointerEvents: true,
	});
	wireRangeControlElement(chartPillG.node(), 'to', {
		dragContainer: svg.node(),
		dragCapture: chartPillG.node(),
		ignoreTouchPointerEvents: true,
	});

	const marker = g.append('circle')
		.attr('r', 4)
		.style('fill', 'var(--ons-color-ocean-blue)')
		.style('stroke', 'var(--ons-color-white)')
		.attr('stroke-width', 1)
		.style('opacity', 0);

	function update({ timeColumns, areaSeries, meanSeries, timeIndex, timeFromIndex = null, timeToIndex = null, selectionMode = 'point', activeHandle = 'to', areaName, colourScale, breaks }) {
		const yTicks = resolveYTicks(5);
		const yTicksEmpty = resolveYTicks(4);
		const indicatorColour = solidStroke;
		indicatorTriangle.attr('fill', indicatorColour);
		indicatorValue.attr('fill', indicatorColour);
		indicatorValueFrom.attr('fill', indicatorColour);

		title
			.text(areaName || '')
			.style('color', solidStroke)
			.style('display', areaName ? null : 'none');

		const sub = getChartSubTitle();
		if (sub) {
			subtitle.html(sub).style('display', null);
		} else {
			subtitle.html('').style('display', 'none');
		}

		const changeSummaryCfgResolved = resolveChartOption('changeSummary', {});
		const changeSummaryCfg = (changeSummaryCfgResolved && typeof changeSummaryCfgResolved === 'object')
			? changeSummaryCfgResolved
			: {};
		updateChartChangeSummaryElement({
			changeSummary,
			changeSummaryCfg,
			selectionMode,
			areaSeries,
			timeFromIndex,
			timeToIndex,
			colourScale,
			solidStroke,
		});

		const hasAreaData = Array.isArray(areaSeries)
			&& areaSeries.some(d => d && d.v !== null && Number.isFinite(d.v));
		if (areaName && !hasAreaData) {
			noDataText.style('opacity', 1);
		} else {
			noDataText.style('opacity', 0);
		}

		legendSwatch.style('background', meanLegendCfg.color);
		legendLabel.text(meanLegendCfg.label);
		const showChangeSummary = changeSummaryCfg.enabled !== false && selectionMode === 'range' && Array.isArray(areaSeries);

		x.domain(timeColumns);

		// Cache discrete positions for drag snapping on the chart pill.
		svg.node().__timelinePositions = timeColumns.map((raw, index) => {
			const px = x(raw);
			return { index, x: (typeof px === 'number' ? (margin.left + px) : 0) };
		});

		const values = [];
		if (areaSeries) values.push(...areaSeries.filter(d => d.v !== null).map(d => d.v));
		if (showMeanLine && meanSeries) values.push(...meanSeries.filter(d => d.v !== null).map(d => d.v));
		if (!values.length) {
			applyChartEmptyState({
				gridG,
				xAxisG,
				yAxisG,
				yTicksEmpty,
				innerWidth,
				yScaleSwatchesG,
				areaPath,
				areaGradient,
				meanPath,
				marker,
				vlineFrom,
				vline,
				indicatorTriangle,
				indicatorValueFrom,
				indicatorValue,
				chartPillFrom,
				chartPillTo,
			});
			return;
		}

		const extent = d3.extent(values);
		y.domain([extent[0], extent[1]]).nice();

		let tickValues = [];
		if (timeColumns.length <= 1) {
			tickValues = timeColumns.slice();
		} else {
			tickValues = [timeColumns[0], timeColumns[timeColumns.length - 1]];
			if (tickValues[0] === tickValues[1]) tickValues = [tickValues[0]];
		}

		gridG.call(d3.axisLeft(y).ticks(yTicks).tickSize(-innerWidth).tickFormat(''));
		gridG.selectAll('line').attr('stroke-width', 2);
		xAxisG.call(d3.axisBottom(x).tickValues(tickValues));
		yAxisG.call(d3.axisLeft(y).ticks(yTicks));

		// Optional zero/reference line (e.g., 0) drawn as a solid horizontal line.
		if (Number.isFinite(zeroLineValue)) {
			const zy = y(zeroLineValue);
			if (Number.isFinite(zy) && zy >= 0 && zy <= innerHeight) {
				zeroLine.attr('x2', innerWidth);
				zeroLineTick
					.attr('transform', `translate(0,${zy})`)
					.style('display', null);
			} else {
				zeroLineTick.style('display', 'none');
			}
		} else {
			zeroLineTick.style('display', 'none');
		}

		updateChartSwatches({ showBreaks, colourScale, breaks, y, innerHeight, yScaleSwatchesG });

		const line = d3.line()
			.defined(d => d.v !== null)
			.x(d => x(d.t))
			.y(d => y(d.v));

		if (showMeanLine && meanSeries) {
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
		}
		updateAreaSeriesStroke({
			areaSeries,
			areaPath,
			areaGradient,
			x,
			colourScale,
			lineStyleDefault,
			solidStroke,
			innerWidth,
		});

		const mode = (selectionMode === 'range') ? 'range' : 'point';
		const idxFrom = mode === 'range' ? clampTimeIndex(timeFromIndex ?? state.timeFromIndex) : clampTimeIndex(timeIndex);
		const idxTo = mode === 'range' ? clampTimeIndex(timeToIndex ?? timeIndex) : clampTimeIndex(timeIndex);
		const tFrom = timeColumns[idxFrom];
		const tTo = timeColumns[idxTo];
		const xFrom = x(tFrom);
		const xTo = x(tTo);

		const maxIdx = Math.max(0, timeColumns.length - 1);
		const areaSeriesLookup = createSeriesLookup(areaSeries);

		if (typeof xTo === 'number') {
			vline.attr('x1', xTo).attr('x2', xTo).style('opacity', 1);
			const pillTo = formatPillLabel(tTo);
			chartPillG
				.attr('aria-valuemin', '0')
				.attr('aria-valuemax', String(maxIdx))
				.attr('aria-valuenow', String(idxTo))
				.attr('aria-valuetext', pillTo.srText)
				.style('display', null);
			chartPillText.text(pillTo.display);
			layoutChartPill(chartPillTo, xTo, innerHeight + 6);

			if (mode === 'range' && typeof xFrom === 'number') {
				vlineFrom.attr('x1', xFrom).attr('x2', xFrom).style('opacity', 1);
				const pillFrom = formatPillLabel(tFrom);
				chartPillFromG
					.attr('aria-valuemin', '0')
					.attr('aria-valuemax', String(maxIdx))
					.attr('aria-valuenow', String(idxFrom))
					.attr('aria-valuetext', pillFrom.srText)
					.style('display', null);
				chartPillFromText.text(pillFrom.display);
				layoutChartPill(chartPillFrom, xFrom, innerHeight + 6);
			} else {
				vlineFrom.style('opacity', 0);
				chartPillFromG.style('display', 'none');
			}

			if (mode === 'range' && typeof xFrom === 'number' && typeof xTo === 'number') {
				applySeparatedChartPillPositions(chartPillFrom, chartPillTo, xFrom, xTo, innerWidth, innerHeight + 6);
			}
		} else {
			vlineFrom.style('opacity', 0);
			vline.style('opacity', 0);
			indicatorTriangle.style('opacity', 0);
			indicatorValueFrom.style('opacity', 0);
			indicatorValue.style('opacity', 0);
			chartPillFromG.style('display', 'none');
			chartPillG.style('display', 'none');
		}

		const activeIsFrom = (mode === 'range' && activeHandle === 'from');
		const tActive = activeIsFrom ? tFrom : tTo;
		const xPos = activeIsFrom ? xFrom : xTo;

		const activePoint = areaSeriesLookup.get(tActive) || null;

		if (activePoint && activePoint.v !== null && Number.isFinite(activePoint.v) && typeof xPos === 'number') {
			const w = 6;
			const h = 8;
			indicatorTriangle
				// Tip sits on the top of the vline (y=0); triangle extends above the plot area.
				.attr('d', `M${xPos - w},${-h}L${xPos + w},${-h}L${xPos},0Z`)
				.style('opacity', 1);

			indicatorValue
				.text(formatConfiguredValue(activePoint.v))
				.attr('x', xPos)
				.attr('y', -h - 4)
				.style('opacity', 1);
		} else {
			indicatorTriangle.style('opacity', 0);
			indicatorValue.style('opacity', 0);
		}

		if (mode === 'range' && areaSeries) {
			const fromPoint = areaSeriesLookup.get(tFrom) || null;
			const toPoint = areaSeriesLookup.get(tTo) || null;
			const h = 8;
			let xFromLabel = xFrom;
			let xToLabel = xTo;
			let fromText = null;
			let toText = null;

			if (fromPoint && fromPoint.v !== null && Number.isFinite(fromPoint.v) && typeof xFrom === 'number') {
				fromText = formatConfiguredValue(fromPoint.v);
			}
			if (toPoint && toPoint.v !== null && Number.isFinite(toPoint.v) && typeof xTo === 'number') {
				toText = formatConfiguredValue(toPoint.v);
			}

			if (fromText && toText && Number.isFinite(xFromLabel) && Number.isFinite(xToLabel)) {
				const approxFromW = Math.max(32, fromText.length * 8);
				const approxToW = Math.max(32, toText.length * 8);
				const dist = Math.abs(xToLabel - xFromLabel);
				const minGap = (approxFromW / 2) + (approxToW / 2) + 8;
				if (dist > 0 && dist < minGap) {
					const push = (minGap - dist) / 2;
					const dir = xFromLabel <= xToLabel ? 1 : -1;
					xFromLabel = Math.max(approxFromW / 2, Math.min(innerWidth - (approxFromW / 2), xFromLabel + (-push * dir)));
					xToLabel = Math.max(approxToW / 2, Math.min(innerWidth - (approxToW / 2), xToLabel + (push * dir)));
				}
			}

			if (fromText) {
				indicatorValueFrom
					.text(fromText)
					.attr('x', xFromLabel)
					.attr('y', -h - 4)
					.style('opacity', 1);
			} else {
				indicatorValueFrom.style('opacity', 0);
			}

			if (toText) {
				indicatorValue
					.text(toText)
					.attr('x', xToLabel)
					.attr('y', -h - 4)
					.style('opacity', 1);
			} else {
				indicatorValue.style('opacity', 0);
			}
		} else {
			indicatorValueFrom.style('opacity', 0);
		}

		if (areaSeries) {
			const point = activePoint;
			if (point && point.v !== null && typeof xPos === 'number') {
				let pc = null;
				if (lineStyleDefault === 'solid') {
					pc = solidStroke;
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

		// Title/subtitle are handled by the overlay container (title) and chart header (subtitle).
	}


	return { __width: width, __height: height, __overlayInnerHeight: overlayInnerHeight, update };
}

function updateChart() {
	const chartEl = document.getElementById('chart');
	const width = Math.floor(chartEl?.getBoundingClientRect().width || 0);
	if (!width || width < 50) return;
	const overlayInnerHeight = getOverlayInnerHeightPx();
	const overlayKey = overlayInnerHeight === null ? null : Math.round(overlayInnerHeight);
	if (!state.chart
		|| state.chart.__width !== width
		|| (overlayKey !== null && Math.round(state.chart.__overlayInnerHeight || 0) !== overlayKey)) {
		state.chart = createChart({ overlayInnerHeight });
	}
	const timeColumns = state.timeColumns;
	if (!timeColumns.length) {
		state.chart.update({ timeColumns: [], areaSeries: null, meanSeries: null, timeIndex: 0, areaName: null, colourScale: null });
		return;
	}

	let areaSeries = null;
	let areaName = null;
	const activeCode = state.overlayAreaCode || state.selectedAreaCode;
	if (activeCode) {
		// Prefer explicit names from the overlay/selection (from geography), then fall back to data-derived lookups.
		areaName = state.overlayAreaName || state.selectedAreaName || state.areaById[activeCode] || null;

		if (state.seriesById[activeCode]) {
			const s = state.seriesById[activeCode];
			// If the geography provided a name, keep it; otherwise use the series store's name.
			if (!areaName) areaName = s.areaName;
			areaSeries = timeColumns.map((t, idx) => {
				const v = s.values[idx];
				let c = null;
				if (state.colour && v !== null && Number.isFinite(v)) {
					try { c = state.colour(v); } catch (e) { c = null; }
				}
				return { t, v, c };
			});
		}
	}
	const meanSeries = timeColumns.map((t, idx) => ({ t, v: state.meanSeries[idx]?.v ?? null }));

	state.chart.update({
		timeColumns,
		areaSeries,
		meanSeries,
		timeIndex: state.timeIndex,
		timeFromIndex: state.timeFromIndex,
		timeToIndex: state.timeToIndex,
		selectionMode: isRangeMode() ? 'range' : 'point',
		activeHandle: state.activeTimeHandle,
		areaName,
		colourScale: state.colour,
		breaks: state.breaks
	});
}

let __overlayWired = false;

function setChartOverlayVisible(visible) {
	const overlay = document.getElementById('chart-overlay');
	if (!overlay) return;
	const show = Boolean(visible);
	if (!show) {
		// If focus is inside the overlay (e.g. on the close button), move it out
		// before applying aria-hidden/display changes, otherwise Chrome warns.
		try {
			const active = document.activeElement;
			if (active && overlay.contains(active)) {
				if (active && typeof active.blur === 'function') {
					active.blur();
				}
				// Prefer focusing the map container (keeps keyboard focus in a sensible place
				// without triggering the autocomplete menu to open/unhide).
				const mapContainer = document.getElementById('graphic');
				if (mapContainer && typeof mapContainer.focus === 'function') {
					try { mapContainer.focus({ preventScroll: true }); } catch (e) { mapContainer.focus(); }
				}
			}
		} catch (e) {
			// ignore
		}
	}
	overlay.classList.toggle('hidden', !show);
	overlay.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function setOverlayMode(mode) {
	const overlay = document.getElementById('chart-overlay');
	if (!overlay) return;
	const prevMode = state.overlayMode;
	state.overlayMode = mode;

	// If we're leaving hover mode, cancel any pending pointer-follow positioning.
	if (mode !== 'hover') {
		if (state.__overlayRaf) {
			try { cancelAnimationFrame(state.__overlayRaf); } catch (e) { /* ignore */ }
			state.__overlayRaf = null;
		}
		state.__overlayLastClient = null;
	}

	const hidden = mode === 'hidden';
	setChartOverlayVisible(!hidden);
	overlay.classList.toggle('is-hover', mode === 'hover');
	overlay.classList.toggle('is-pinned', mode === 'pinned');

	applyOverlayDimensionsForMode(mode);
	if (prevMode !== mode) {
		// Force a rebuild so the SVG height changes without scaling styles.
		state.chart = null;
	}


	if (mode === 'pinned') {
		// Revert to CSS anchored placement unless we're explicitly in full-width mode.
		if (!overlay.classList.contains('is-fullwidth')) {
			overlay.style.left = '';
			overlay.style.top = '';
			overlay.style.right = '';
			overlay.style.bottom = '';
		}
	} else if (mode === 'hidden') {
		// Clear inline positioning so next show starts clean.
		overlay.style.left = '';
		overlay.style.top = '';
		overlay.style.right = '';
		overlay.style.bottom = '';
	}
}

function applyOverlayDimensionsForMode(mode) {
	const overlay = document.getElementById('chart-overlay');
	const stage = document.getElementById('mapstage');
	if (!overlay || !stage) return;

	if (mode === 'hidden') {
		overlay.style.width = '';
		overlay.style.height = '';
		return;
	}

	const sizes = (
		config
		&& config.chart
		&& typeof config.chart === 'object'
		&& config.chart.dimensions
		&& typeof config.chart.dimensions === 'object'
	)
		? config.chart.dimensions
		: (config && config.chartOverlay && typeof config.chartOverlay === 'object')
			? config.chartOverlay
			: {};
	const desired = (mode === 'hover' ? sizes.hover : sizes.pinned) || {};
	const desiredW = Number.isFinite(+desired.width) ? +desired.width : (mode === 'hover' ? 300 : 420);
	const desiredH = Number.isFinite(+desired.height) ? +desired.height : (mode === 'hover' ? 200 : 313);

	const stageRect = stage.getBoundingClientRect();
	const maxW = Math.max(120, Math.floor(stageRect.width - 24));
	const maxH = Math.max(120, Math.floor(stageRect.height - 24));
	const w = Math.max(180, Math.min(desiredW, maxW));
	const h = Math.max(140, Math.min(desiredH, maxH));

	// Decide whether the pinned overlay should become full-width.
	// Rule of thumb: if the overlay would consume >65% of the page width, it's better as a bottom sheet.
	let shouldFullWidth = false;
	if (mode === 'pinned') {
		const pageW = Math.floor(document.documentElement?.clientWidth || window.innerWidth || 0);
		if (pageW > 0 && w / pageW > 0.65) shouldFullWidth = true;
	}

	overlay.classList.toggle('is-fullwidth', shouldFullWidth);

	if (shouldFullWidth) {
		// Stretch across the map stage.
		overlay.style.left = '12px';
		overlay.style.right = '12px';
		overlay.style.bottom = '12px';
		overlay.style.top = 'auto';
		overlay.style.width = 'auto';
		overlay.style.height = `${h}px`;
	} else {
		overlay.style.width = `${w}px`;
		overlay.style.height = `${h}px`;
		// If we are leaving full-width pinned mode, clear the stretch positioning.
		const leavingFullWidth = mode === 'pinned'
			&& overlay.style.width === 'auto'
			&& overlay.style.left
			&& overlay.style.right;
		if (leavingFullWidth) {
			overlay.style.left = '';
			overlay.style.right = '';
			overlay.style.top = '';
			overlay.style.bottom = '';
			overlay.style.width = '';
		}
	}
}

function positionOverlayNearClientPoint(clientX, clientY) {
	// Only hover previews should follow the pointer.
	if (state.overlayMode !== 'hover') return;
	const overlay = document.getElementById('chart-overlay');
	const stage = document.getElementById('mapstage');
	if (!overlay || !stage) return;

	const stageRect = stage.getBoundingClientRect();
	const overlayRect = overlay.getBoundingClientRect();
	if (!stageRect.width || !stageRect.height) return;

	const gutter = 12;
	// Extra separation between pointer and overlay (hover only)
	const hoverOffsetX = 26;
	const hoverOffsetY = 14;
	const localX = clientX - stageRect.left;
	const localY = clientY - stageRect.top;

	let left = localX + hoverOffsetX;
	if (left + overlayRect.width > stageRect.width - gutter) {
		left = localX - hoverOffsetX - overlayRect.width;
	}
	left = Math.max(gutter, Math.min(left, stageRect.width - overlayRect.width - gutter));

	let top = localY - hoverOffsetY;
	top = Math.max(gutter, Math.min(top, stageRect.height - overlayRect.height - gutter));

	overlay.style.left = `${Math.round(left)}px`;
	overlay.style.top = `${Math.round(top)}px`;
	overlay.style.bottom = 'auto';
	overlay.style.right = 'auto';
}

function showHoverOverlay({ code, areaName, clientX, clientY }) {
	if (!code) return;
	if (state.selectedAreaCode) return; // pinned takes precedence

	const changed = code !== state.overlayAreaCode || state.overlayMode !== 'hover';
	state.overlayAreaCode = code;
	state.overlayAreaName = areaName || state.areaById[code] || null;
	setOverlayMode('hover');
	if (changed) updateChart();
	// Position immediately to avoid a one-frame flash in the default (pinned) position.
	positionOverlayNearClientPoint(clientX, clientY);

	state.__overlayLastClient = { x: clientX, y: clientY };
	if (state.__overlayRaf) return;
	state.__overlayRaf = requestAnimationFrame(() => {
		state.__overlayRaf = null;
		if (state.overlayMode !== 'hover') return;
		const pt = state.__overlayLastClient;
		if (!pt) return;
		positionOverlayNearClientPoint(pt.x, pt.y);
	});
}

function hideHoverOverlay() {
	if (state.overlayMode !== 'hover') return;
	state.overlayAreaCode = null;
	state.overlayAreaName = null;
	setOverlayMode('hidden');
}

function showPinnedOverlay({ code, areaName }) {
	state.overlayAreaCode = code || null;
	state.overlayAreaName = areaName || null;
	setOverlayMode(code ? 'pinned' : 'hidden');
	updateChart();
}

function wireOverlayHoverEvents() {
	if (__overlayWired) return;
	__overlayWired = true;
	if (!state.map) return;

	state.map.on('mousemove', 'area', (e) => {
		if (state.selectedAreaCode) return;
		const f = e && e.features && e.features[0];
		if (!f || !f.properties) return;
		const code = f.properties[config.geoIdField];
		const areaName = f.properties[config.geoNameField];
		const evt = e.originalEvent || e;
		const clientX = evt && typeof evt.clientX === 'number' ? evt.clientX : 0;
		const clientY = evt && typeof evt.clientY === 'number' ? evt.clientY : 0;
		showHoverOverlay({ code, areaName, clientX, clientY });
	});

	state.map.on('mouseleave', 'area', () => {
		if (!state.selectedAreaCode) hideHoverOverlay();
	});
}

async function loadDataset(datasetIndex) {
	const datasets = Array.isArray(config.datasets) && config.datasets.length ? config.datasets : [{ label: 'Data', url: config.dataUrl }];
	const ds = datasets[datasetIndex] || datasets[0];
	const loadToken = (state.datasetLoadToken || 0) + 1;
	state.datasetLoadToken = loadToken;
	state.datasetIndex = datasetIndex;
	// Chart subtitle and other chart config can be dataset-dependent.
	// Force a rebuild so height calculations (subtitle+legend) stay correct.
	state.chart = null;

	// Capture the current selection so we can retain it across dataset switches.
	const prevSelectedRaw = state.selectedTimeRaw || state.timeColumns[state.timeIndex] || null;
	const prevSelectedDate = prevSelectedRaw ? parseTimeColumn(prevSelectedRaw) : null;
	const prevFromRaw = state.selectedFromRaw || state.timeColumns[state.timeFromIndex] || null;
	const prevToRaw = state.selectedToRaw || prevSelectedRaw || state.timeColumns[state.timeToIndex] || null;
	const prevFromDate = prevFromRaw ? parseTimeColumn(prevFromRaw) : null;
	const prevToDate = prevToRaw ? parseTimeColumn(prevToRaw) : null;

	const csv = await d3.csv(ds.url);
	if (loadToken !== state.datasetLoadToken) {
		return;
	}

	const { timeColumns, seriesById, areaById, meanSeries } = buildSeriesStore(csv);
	state.timeColumns = timeColumns;
	state.seriesById = seriesById;
	state.meanSeries = meanSeries;

	// update areaById in place
	for (const k of Object.keys(state.areaById)) delete state.areaById[k];
	Object.assign(state.areaById, areaById);

	// Initial timeline position:
	// Point mode:
	// 1) Retain previous selected time (exact header match, else nearest parsed date)
	// 2) config.startTime if present
	// 3) default to last
	// Range mode:
	// 1) Retain previous from/to (exact match, else nearest parsed date)
	// 2) config.startFromTime/startToTime
	// 3) default to min/max
	const resolveIndex = ({ preferredRaw, preferredDate, configRaw, fallback }) => {
		let idx = -1;
		if (preferredRaw) idx = state.timeColumns.indexOf(preferredRaw);
		if (idx < 0 && preferredDate && Number.isFinite(preferredDate.getTime())) {
			let best = -1;
			let bestDist = Infinity;
			for (let i = 0; i < state.timeColumns.length; i++) {
				const d = parseTimeColumn(state.timeColumns[i]);
				if (!d || !Number.isFinite(d.getTime())) continue;
				const dist = Math.abs(d.getTime() - preferredDate.getTime());
				if (dist < bestDist) {
					bestDist = dist;
					best = i;
				}
			}
			idx = best;
		}
		if (idx < 0 && typeof configRaw === 'string' && configRaw) {
			idx = state.timeColumns.indexOf(configRaw);
		}
		return idx >= 0 ? idx : fallback;
	};

	if (isRangeMode()) {
		const lastIdx = Math.max(0, state.timeColumns.length - 1);
		const fromIdx = resolveIndex({
			preferredRaw: prevFromRaw,
			preferredDate: prevFromDate,
			configRaw: (typeof resolveDatasetOption('startFromTime', null) === 'string' ? resolveDatasetOption('startFromTime', null) : null),
			fallback: 0
		});
		const toIdx = resolveIndex({
			preferredRaw: prevToRaw,
			preferredDate: prevToDate,
			configRaw: (typeof resolveDatasetOption('startToTime', null) === 'string' ? resolveDatasetOption('startToTime', null) : null),
			fallback: lastIdx
		});
		const norm = normalizeRange(fromIdx, toIdx);
		state.timeFromIndex = norm.from;
		state.timeToIndex = norm.to;
		state.selectedFromRaw = state.timeColumns[state.timeFromIndex] ?? null;
		state.selectedToRaw = state.timeColumns[state.timeToIndex] ?? null;
		state.timeIndex = state.timeToIndex;
		state.selectedTimeRaw = state.selectedToRaw;
		state.activeTimeHandle = state.activeTimeHandle === 'from' ? 'from' : 'to';
	} else {
		let nextIdx = -1;
		if (prevSelectedRaw) {
			nextIdx = state.timeColumns.indexOf(prevSelectedRaw);
			nextIdx = (nextIdx < 0 && prevSelectedDate && Number.isFinite(prevSelectedDate.getTime()))
				? resolveIndex({ preferredRaw: null, preferredDate: prevSelectedDate, configRaw: null, fallback: -1 })
				: nextIdx;
		}
		if (nextIdx < 0) {
			const resolvedStartTime = resolveDatasetOption('startTime', null);
			const desired = typeof resolvedStartTime === 'string' ? resolvedStartTime : null;
			nextIdx = desired ? state.timeColumns.indexOf(desired) : -1;
		}
		state.timeIndex = nextIdx >= 0 ? nextIdx : Math.max(0, state.timeColumns.length - 1);
		state.selectedTimeRaw = state.timeColumns[state.timeIndex] ?? null;
		state.timeFromIndex = 0;
		state.timeToIndex = state.timeIndex;
		state.selectedFromRaw = state.timeColumns[0] ?? null;
		state.selectedToRaw = state.selectedTimeRaw;
		state.activeTimeHandle = 'to';
	}

	updateRateByIdForSelection();
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
		// Click selection becomes a pinned overlay (close button visible)
		showPinnedOverlay({ code, areaName });
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
	// Wire hover preview overlay after setupMap has added the area layer (setupMap registers on 'load')
	state.map.on('load', () => {
		wireOverlayHoverEvents();
	});

	updateKeyInfo(undefined, undefined, state);
	updateChart();
}

function setupUI() {
	renderDatasetSwitch();
	setTimelineUI();
	setupChartOverlayUI();
	// Ensure timeline is positioned correctly once layout is stable.
	requestAnimationFrame(() => renderTimeline());

	// Keep overlay layout in sync with container size changes (e.g., orientation changes).
	const stage = document.getElementById('mapstage');
	if (stage && typeof ResizeObserver !== 'undefined') {
		const ro = new ResizeObserver(() => {
			if (state.__overlayResizeRaf) return;
			state.__overlayResizeRaf = requestAnimationFrame(() => {
				state.__overlayResizeRaf = null;
				applyOverlayDimensionsForMode(state.overlayMode);
				state.chart = null;
				updateChart();
				ensureBreaksAndLegend();
				renderTimeline();
				if (state.selectedAreaCode) deferFocusSelectedArea();
			});
		});
		try { ro.observe(stage); } catch (e) { /* ignore */ }
	}

	// Keep chart responsive
	window.addEventListener('resize', onResize);
}

function setupChartOverlayUI() {
	const closeBtn = document.getElementById('chart-overlay-close');
	if (closeBtn) {
		closeBtn.addEventListener('click', () => {
			// Overlay should only be closed when there's no selected area.
			// So this button clears the current selection.
			if (state.selectedAreaCode) {
				// Clear the search input as well, but keep the current map view (no zoom-out).
				setSearchText('');
				clearAreaSelection(state, config.geoLayer);
				state.hoveredAreaCode = null;
				state.selectedAreaCode = null;
				state.selectedAreaName = null;
				updateKeyInfo(undefined, undefined, state);
				// Hide pinned overlay; hover preview will re-appear on next hover.
				showPinnedOverlay({ code: null, areaName: null });
			} else {
				showPinnedOverlay({ code: null, areaName: null });
			}
		});
	}

	setOverlayMode('hidden');
}

function getChartOverlayPadding() {
	const overlay = document.getElementById('chart-overlay');
	if (!overlay || overlay.classList.contains('hidden')) {
		return { top: 10, right: 10, bottom: 20, left: 10 };
	}
	const rect = overlay.getBoundingClientRect();
	const extra = 18;
	const fullWidth = overlay.classList.contains('is-fullwidth');
	return {
		top: 10,
		right: 10,
		bottom: Math.round(rect.height + extra),
		left: fullWidth ? 10 : Math.round(rect.width + extra),
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

	const padding = getChartOverlayPadding();
	const focusKey = `${code}|${padding.top},${padding.right},${padding.bottom},${padding.left}|${state.overlayMode}`;
	const now = Date.now();
	if (state.__lastFocusKey === focusKey && (now - (state.__lastFocusAt || 0)) < 500) return;
	state.__lastFocusKey = focusKey;
	state.__lastFocusAt = now;

	state.map.fitBounds(bounds, {
		padding,
		maxZoom: Math.min((config.maxZoom || 13), 9.5),
		duration: 1000,
	});
}

function deferFocusSelectedArea() {
	if (!state.selectedAreaCode) return;
	if (state.__focusRaf1) {
		try { cancelAnimationFrame(state.__focusRaf1); } catch (e) { /* ignore */ }
		state.__focusRaf1 = null;
	}
	if (state.__focusRaf2) {
		try { cancelAnimationFrame(state.__focusRaf2); } catch (e) { /* ignore */ }
		state.__focusRaf2 = null;
	}
	if (state.__focusTimeout) {
		try { clearTimeout(state.__focusTimeout); } catch (e) { /* ignore */ }
		state.__focusTimeout = null;
	}
	// Allow overlay and SVG layout to settle, especially on small screens.
	state.__focusRaf1 = requestAnimationFrame(() => {
		state.__focusRaf1 = null;
		state.__focusRaf2 = requestAnimationFrame(() => {
			state.__focusRaf2 = null;
			maybeFocusSelectedArea();
			state.__focusTimeout = setTimeout(() => {
				state.__focusTimeout = null;
				maybeFocusSelectedArea();
			}, 160);
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

function onResize() {
	// Keep the map canvas and legend in sync with container changes.
	try { ensureBreaksAndLegend(); } catch (e) { /* ignore */ }
	if (state.map && typeof state.map.resize === 'function') {
		try { state.map.resize(); } catch (e) { /* ignore */ }
	}

	// Keep chart overlay + timeline responsive in embeds.
	try { applyOverlayDimensionsForMode(state.overlayMode); } catch (e) { /* ignore */ }
	state.chart = null;
	try { updateChart(); } catch (e) { /* ignore */ }
	try { renderTimeline(); } catch (e) { /* ignore */ }
	if (state.selectedAreaCode) deferFocusSelectedArea();

	if (state.pymChild && typeof state.pymChild.sendHeight === 'function') {
		try { state.pymChild.sendHeight(); } catch (e) { /* ignore */ }
	}
}

function renderCallback() {
	startOnce();
	// Let layout settle before measuring widths.
	requestAnimationFrame(onResize);
}

// Start as soon as the DOM is ready (works whether the script is in <head> or end of <body>).
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', startOnce, { once: true });
} else {
	startOnce();
}

// Hook load (and pym when available) for embed resizing.
window.addEventListener('load', () => {
	if (window.self !== window.top && typeof pym !== 'undefined') {
		state.pymChild = new pym.Child({ renderCallback });
		setTimeout(renderCallback, 250);
	}
});
import { initialise, addSource } from "../lib/helpers.js";

let pymChild = null;

let map, areas, data, breaks, colour, rateById = {}, areaById = {};
let hoveredAreaCode = null; // Track hovered area code
let selectedAreaCode = null; // Track selected area code

// Listen for ESC key to clear selection
document.addEventListener('keydown', function(e) {
	if (e.key === 'Escape' || e.key === 'Esc') {
		if (selectedAreaCode || hoveredAreaCode) {
			// Clear both selection and hover, and call the mouseleave logic directly
			selectedAreaCode = null;
			hoveredAreaCode = null;
			if (typeof map !== 'undefined' && map !== null) {
				if (typeof window !== 'undefined') {
					if (map.getCanvas) map.getCanvas().style.cursor = '';
				}
				if (map.setFilter) map.setFilter('area-hover', ['==', 'AREACD', '']);
				map.setFilter('area-selected', ['==', 'AREACD', '']);
				if (window.moveKeyIndicator) window.moveKeyIndicator(undefined);
				if (window.moveKeyIndicatorSelected) window.moveKeyIndicatorSelected(undefined);
				if (window.updateKeyInfo) updateKeyInfo(undefined, undefined);
			}
		}
	}
});

// Helper to get the height of the overlay (keycontainer)
function getKeyOverlayHeight() {
	const keycontainer = document.getElementById('keycontainer');
	if (!keycontainer) return 0;
	return keycontainer.getBoundingClientRect().height || 0;
}

const graphic = d3.select('#graphic');

// Use D3 to populate the info area above the keyscale
const keyInfoSel = d3.select('#keyinfo')
	.classed('keyinfo', true)
	.style('margin-left', (config.keyScaleMargin && typeof config.keyScaleMargin.left === 'number') ? config.keyScaleMargin.left + 'px' : null);
// Value
let valueSel = keyInfoSel.select('#keyinfo-value');
if (valueSel.empty()) {
	valueSel = keyInfoSel.append('div').attr('id', 'keyinfo-value');
}
// Explainer
let explainerSel = keyInfoSel.select('#keyinfo-explainer');
if (explainerSel.empty()) {
	explainerSel = keyInfoSel.append('div').attr('id', 'keyinfo-explainer');
}
// Two lines for explainer
let explainerLine1 = explainerSel.select('span.line1');
if (explainerLine1.empty()) explainerLine1 = explainerSel.append('span').classed('line1', true);
let explainerLine2 = explainerSel.select('span.line2');
if (explainerLine2.empty()) explainerLine2 = explainerSel.append('span').classed('line2', true);

function updateKeyInfo(value, areaName) {
	if (typeof value === 'undefined' || value === null || isNaN(value)) {
		// If areaName is provided, show unavailable message; else show placeholder
		if (areaName) {
			const unavailablePrefix = config.unavailablePrefix || 'The value for';
			const unavailableSuffix = config.unavailableSuffix || 'is unavailable';
			const areaLabel = areaName || 'this area';
			valueSel.html(`<span class="keyinfo-placeholder"></span>`); // No value shown
			explainerLine1.html('');
			explainerLine1.append('span').text(`${unavailablePrefix} `);
			explainerLine1.append('strong').text(areaLabel);
			explainerLine1.append('span').text(` ${unavailableSuffix}`);
			explainerLine2.text('');
		} else {
			// Show placeholder in valueSel, clear explainer
			const placeholder = config.explainerPlaceholder || '';
			valueSel.html(`<span class="keyinfo-placeholder">${placeholder}</span>`);
			explainerLine1.html('');
			explainerLine2.text('');
		}
		return;
	}
	// Format value with prefix/suffix for value display
	let fmt = d3.format(config.valueFormat || ',.0f');
	let valuePrefix = config.valuePrefix || '';
	let valueSuffix = config.valueSuffix || '';
	valueSel.html(
		`<span style="font-size:0.6em;vertical-align:middle;">${valuePrefix}</span>` +
		`<span style="font-size:1em;">${fmt(value)}</span>` +
		`<span style="font-size:0.6em;vertical-align:middle;">${valueSuffix}</span>`
	);

	// Explainer: explainerPrefix, area name (bold), explainerSuffix
	const explainerPrefix = config.explainerPrefix || '';
	const explainerSuffix = config.explainerSuffix || '';
	explainerLine1.html('');
	explainerLine1.append('span').text(explainerPrefix);
	if (areaName) {
		explainerLine1.append('strong').text(areaName);
	}
	explainerLine2.text(explainerSuffix);
}

// Clear info on load
updateKeyInfo(undefined, undefined);
const keyscale = d3.select('#keyscale');

graphic.style('width', '100%')
    .style('height', config.mapHeight || '650px')
    .style('max-width', '800px');

function drawKeyScale() {
	keyscale.selectAll('*').remove();
	// Get the actual rendered width of the map container
	const mapWidth = graphic.node().getBoundingClientRect().width || 400;
	const width = mapWidth - config.keyScaleMargin.left - config.keyScaleMargin.right;
	let height = 39;

	// Compute tick positions and implement dropticks (staggered labels)
	const legendFmt = d3.format(config.legendFormat || ',.2f');
	const legendPrefix = config.legendPrefix || '';
	const legendSuffix = config.legendSuffix || '';
	const tickData = breaks.map((d, i) => ({
		value: d,
		index: i,
		label: legendPrefix + legendFmt(d) + legendSuffix,
		x: null // will set after x scale is defined
	}));

	// x scale for the legend (define early for tickData)
	const x = d3.scaleLinear()
		.domain([breaks[0], breaks[breaks.length - 1]])
		.range([config.keyScaleMargin.left, width + config.keyScaleMargin.left]);
	tickData.forEach(d => { d.x = x(d.value); });

	// First, create the ticks (invisible) to measure their widths
	const tempTicks = d3.select(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
		.selectAll('text.keyscale-tick-temp')
		.data(tickData)
		.enter()
		.append('text')
		.attr('class', 'keyscale-tick-temp')
		.attr('x', d => d.x)
		.attr('y', height + config.keyScaleMargin.top - 2)
		.attr('text-anchor', 'middle')
		.attr('font-size', 13)
		.attr('fill', '#707071')
		.style('opacity', 0)
		.text(d => d.label);
	// Attach to DOM to measure
	document.body.appendChild(tempTicks.node().ownerSVGElement);
	tickData.forEach((d, i) => {
		const node = tempTicks.nodes()[i];
		d.width = node ? node.getBBox().width : 0;
	});
	// Remove temp SVG
	tempTicks.node().ownerSVGElement.remove();

	// Check for any overlaps
	let lastRight = -Infinity;
	let anyOverlap = false;
	tickData.forEach((d) => {
		const left = d.x - d.width / 2;
		if (left < lastRight) {
			anyOverlap = true;
		}
		lastRight = Math.max(lastRight, d.x + d.width / 2);
	});

	// Set y positions: alternate if any overlap, else all baseline
	const yBase = height + config.keyScaleMargin.top - 2;
	const yOffset = 13; // vertical offset for staggered ticks
	tickData.forEach((d, i) => {
		if (anyOverlap) {
			d.stagger = (i % 2 === 1);
			d.y = yBase + (d.stagger ? yOffset : 0);
		} else {
			d.stagger = false;
			d.y = yBase;
		}
	});

	// If dropticks, increase bottom margin to fit lower row
	let keyScaleMargin = { ...config.keyScaleMargin };
	if (anyOverlap) {
		keyScaleMargin = { ...keyScaleMargin, bottom: (config.keyScaleMargin.bottom || 0) + yOffset + 4 };
	}

	// Now create the SVG with possibly increased bottom margin
	const scaleSvg = keyscale.append('svg')
		.attr('width', width + keyScaleMargin.left + keyScaleMargin.right)
		.attr('height', height + keyScaleMargin.top + keyScaleMargin.bottom)
		.attr('class', 'keyscale-svg');



	// Draw colored rectangles for each break interval
	for (let i = 0; i < breaks.length - 1; i++) {
		scaleSvg.append('rect')
			.attr('x', x(breaks[i]))
			.attr('y', keyScaleMargin.top)
			.attr('width', x(breaks[i + 1]) - x(breaks[i]))
			.attr('height', height - 16)
			.attr('fill', colour((breaks[i] + breaks[i + 1]) / 2))
			// .attr('stroke', '#fff')
			// .attr('stroke-width', 1)
			.attr('class', 'keyscale-rect');
	}

	// Draw leader lines for dropped ticks if anyOverlap
	if (anyOverlap) {
		const colorBarTop = keyScaleMargin.top + height - 16;
		scaleSvg.selectAll('line.keyscale-tick-leader')
			.data(tickData.filter(d => d.stagger))
			.enter()
			.append('line')
			.attr('class', 'keyscale-tick-leader')
			.attr('x1', d => d.x)
			.attr('x2', d => d.x)
			.attr('y1', colorBarTop)
			.attr('y2', d => d.y - 11)
			.attr('stroke', '#707071')
			.attr('stroke-width', 1.1)
			.attr('stroke-dasharray', '2,2');
	}

	// Draw the ticks with staggered positions
	scaleSvg.selectAll('text.keyscale-tick')
		.data(tickData)
		.enter()
		.append('text')
		.attr('class', d => 'keyscale-tick' + (d.stagger ? ' keyscale-tick-stagger' : ''))
		.attr('x', d => d.x)
		.attr('y', d => d.y)
		.attr('text-anchor', 'middle')
		.attr('font-size', 13)
		.attr('fill', '#707071')
		.text(d => d.label);

	// Add indicator(s): main (hover), and faded (selected)
	const triangleWidth = 18;
	const triangleHeight = 14;
	// Main indicator (for hover)
	scaleSvg.append('polygon')
		.attr('id', 'key-indicator')
		.attr('points', `0,0 ${triangleWidth},0 ${triangleWidth/2},${triangleHeight}`)
		.attr('fill', '#fff')
		.attr('stroke', '#222')
		.attr('stroke-width', 2.4)
		.attr('stroke-linejoin', 'round')
		.attr('transform', `translate(${x(breaks[0]) - triangleWidth/2},${keyScaleMargin.top + (height/2) - triangleHeight - 10})`)
		.style('display', 'none');
	// Faded indicator (for selected area)
	scaleSvg.append('polygon')
		.attr('id', 'key-indicator-selected')
		.attr('points', `0,0 ${triangleWidth},0 ${triangleWidth/2},${triangleHeight}`)
		.attr('fill', '#fff')
		.attr('stroke', '#222')
		.attr('stroke-width', 2.4)
		.attr('stroke-linejoin', 'round')
		.attr('opacity', 0.5)
		.attr('transform', `translate(${x(breaks[0]) - triangleWidth/2},${keyScaleMargin.top + (height/2) - triangleHeight - 10})`)
		.style('display', 'none');

	// Expose functions to move indicators
	window.moveKeyIndicator = function(val) {
		if (val === undefined || val === null || isNaN(val)) {
			scaleSvg.select('#key-indicator').style('display', 'none');
		} else {
			scaleSvg.select('#key-indicator')
				.attr('transform', `translate(${x(val) - triangleWidth/2},${keyScaleMargin.top + (height/2) - triangleHeight - 10})`)
				.raise()
				.style('display', null);
		}
	};
	window.moveKeyIndicatorSelected = function(val) {
		if (val === undefined || val === null || isNaN(val)) {
			scaleSvg.select('#key-indicator-selected').style('display', 'none');
		} else {
			scaleSvg.select('#key-indicator-selected')
				.attr('transform', `translate(${x(val) - triangleWidth/2},${keyScaleMargin.top + (height/2) - triangleHeight - 10})`)
				.raise()
				.style('display', null);
		}
	};
}

function drawMap() {
	// Initialise chart size and accessibility
	const size = initialise();

	// Set up source text
	addSource('source', config.sourceText || 'Office for National Statistics.');

	// Set up Maplibre GL map
	map = new maplibregl.Map({
		container: 'graphic',
		style: 'style.json',
		minZoom: config.minZoom || 3.5,
		maxZoom: config.maxZoom || 13,
		attributionControl: false
	});

	// Convert TopoJSON to GeoJSON
	for (const key in areas.objects) {
		areas = topojson.feature(areas, areas.objects[key]);
		break;
	}

	// Add data properties to geojson
	areas.features.forEach((d) => {
		const propKeys = Object.keys(d.properties);
		const areacdKey = propKeys.find(k => k.toLowerCase() === 'areacd');
		const areanmKey = propKeys.find(k => k.toLowerCase() === 'areanm');
		const code = areacdKey ? d.properties[areacdKey].toUpperCase() : undefined;
		const value = code ? rateById[code] : undefined;
		d.properties.value = value;
		let fillColor = colour(value);
		if (!fillColor || fillColor === null) {
			fillColor = config.colourUnavailable; // fallback color for missing/invalid data
		}
		d.properties.fill = fillColor;
		// Optionally, set AREANM to a consistent property for labels
		if (areanmKey) {
			d.properties.AREANM = d.properties[areanmKey];
		}
	});

	// Draw the key scale
	drawKeyScale();

	// Add area source and layer, and fit bounds with bottom padding after map and overlay are rendered
	map.on('load', () => {
		// Calculate bottom padding for overlay
		const bottomPad = getKeyOverlayHeight() + 10; // 10px extra for spacing

		// Fit map to bounds if provided, with bottom padding
		map.fitBounds(config.mapBounds, { padding: { top: 10, left: 10, right: 10, bottom: bottomPad }, animate: false });

		map.addSource('area', { type: 'geojson', data: areas });
		map.addLayer({
			id: 'area',
			type: 'fill',
			source: 'area',
			layout: {},
			paint: {
				'fill-color': ['get', 'fill'],
				'fill-opacity': config.fillOpacity || 0.8,
				// 'fill-outline-color': '#fff'
			}
		}, 'place_town');

		// Add hover layer
		map.addLayer({
			id: 'area-hover',
			type: 'line',
			source: 'area',
			layout: {},
			paint: {
				'line-color': '#000',
				'line-width': 2,
				'line-opacity': 1
			},
			filter: ['==', 'AREACD', '']
		});
		// Add selected border layer (below hover)
		map.addLayer({
			id: 'area-selected',
			type: 'line',
			source: 'area',
			layout: {},
			paint: {
				'line-color': '#000',
				'line-width': 2,
				'line-opacity': 0.4
			},
			filter: ['==', 'AREACD', '']
		}, 'area-hover');

		// Add labels
		map.addLayer({
			id: 'area-labels',
			type: 'symbol',
			source: 'area',
			minzoom: 10,
			layout: {
				'text-field': ['get', 'AREANM'],
				'text-font': ['Open Sans', 'Arial Unicode MS Regular'],
				'text-size': 14
			},
			paint: {
				'text-color': '#666',
				'text-halo-color': '#fff',
				'text-halo-width': 1,
				'text-halo-blur': 1
			}
		});

		// Interactivity
		map.on('mousemove', 'area', (e) => {
			map.getCanvas().style.cursor = 'pointer';
			// Case-insensitive AREACD
			const propKeys = Object.keys(e.features[0].properties);
			const areacdKey = propKeys.find(k => k.toLowerCase() === 'areacd');
			const areanmKey = propKeys.find(k => k.toLowerCase() === 'areanm');
			const code = areacdKey ? e.features[0].properties[areacdKey].toUpperCase() : undefined;
			hoveredAreaCode = code;
			const areaName = areanmKey ? e.features[0].properties[areanmKey] : '';
			map.setFilter('area-hover', ['==', 'AREACD', code]);
			// Show hover indicator and border
			const value = e.features[0].properties.value;
			if (typeof value !== 'undefined' && value !== null && !isNaN(value)) {
				window.moveKeyIndicator(e.features[0].properties.value);
				// Show faded indicator for selected area if different
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
			// Show selected border if different area is selected
			if (selectedAreaCode && selectedAreaCode !== code) {
				map.setFilter('area-selected', ['==', 'AREACD', selectedAreaCode]);
			} else {
				map.setFilter('area-selected', ['==', 'AREACD', '']);
			}
		});
		map.on('mouseleave', 'area', () => {
			map.getCanvas().style.cursor = '';
			hoveredAreaCode = null;
			map.setFilter('area-hover', ['==', 'AREACD', '']);
			// Show selected border and indicator if any area is selected
			if (selectedAreaCode) {
				map.setFilter('area-selected', ['==', 'AREACD', selectedAreaCode]);
				const selectedVal = rateById[selectedAreaCode];
				window.moveKeyIndicator(undefined);
				window.moveKeyIndicatorSelected(selectedVal);
				// Show explainer for selected area
				updateKeyInfo(selectedVal, areaById[selectedAreaCode]);
			} else {
				map.setFilter('area-selected', ['==', 'AREACD', '']);
				window.moveKeyIndicator(undefined);
				window.moveKeyIndicatorSelected(undefined);
				updateKeyInfo(undefined, undefined);
			}
		});
		map.on('click', 'area', (e) => {
			// On click, lock the info display to this area until mouse leaves
			const propKeys = Object.keys(e.features[0].properties);
			const areacdKey = propKeys.find(k => k.toLowerCase() === 'areacd');
			const areanmKey = propKeys.find(k => k.toLowerCase() === 'areanm');
			const code = areacdKey ? e.features[0].properties[areacdKey].toUpperCase() : undefined;
			const areaName = areanmKey ? e.features[0].properties[areanmKey] : '';
			selectedAreaCode = code;
			// Set selected border
			map.setFilter('area-selected', ['==', 'AREACD', code]);
			// Hide hover border
			map.setFilter('area-hover', ['==', 'AREACD', '']);
			// Show faded indicator for selected, hide hover indicator
			const selectedVal = e.features[0].properties.value;
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
					let lons = allCoords.map(c => c[0]);
					let lats = allCoords.map(c => c[1]);
					let minLon = Math.min(...lons), maxLon = Math.max(...lons);
					let minLat = Math.min(...lats), maxLat = Math.max(...lats);
					let bounds = [[minLon, minLat], [maxLon, maxLat]];

					// Calculate required zoom to make bounds ~40% of map viewport
					const mapCanvas = map.getContainer();
					const mapWidth = mapCanvas.offsetWidth;
					const mapHeight = mapCanvas.offsetHeight;
					// Padding: 30% on each side = 40% visible
					const padX = Math.round(mapWidth * 0.3);
					let padY = Math.round(mapHeight * 0.3);

					// Add extra bottom padding for keycontainer overlay
					const keycontainer = document.getElementById('keycontainer');
					let keyPad = 0;
					if (keycontainer) {
						keyPad = keycontainer.getBoundingClientRect().height || 0;
					}
					// Add the overlay height to the bottom padding
					const padding = { top: padY, bottom: padY + keyPad, left: padX, right: padX };

					// Get current zoom for comparison
					const currentZoom = map.getZoom();
					// Fit bounds with padding, but only zoom in (not out)
					const options = {
						padding,
						animate: true
					};
					// Calculate the zoom that would be used
					const targetZoom = map.cameraForBounds(bounds, options)?.zoom;
					if (targetZoom !== undefined && targetZoom > currentZoom) {
						map.fitBounds(bounds, options);
					}
				}
			}
		});

		// Provide a getPadding function to dynamically calculate padding (including keycontainer height)
		const zoomhome = new MapLibreControlZoomHome({
			resetBounds: config.mapBounds,
			getPadding: function() {
				let bottomPad = 10;
				const keycontainer = document.getElementById('keycontainer');
				if (keycontainer) {
					bottomPad += keycontainer.getBoundingClientRect().height || 0;
				}
				return { top: 10, left: 10, right: 10, bottom: bottomPad };
			},
			onReset: function() {
				// Clear selected area and info
				selectedAreaCode = null;
				if (typeof map !== 'undefined' && map !== null) {
					map.setFilter('area-selected', ['==', 'AREACD', '']);
					if (window.moveKeyIndicator) window.moveKeyIndicator(undefined);
					if (window.moveKeyIndicatorSelected) window.moveKeyIndicatorSelected(undefined);
					if (window.updateKeyInfo) updateKeyInfo(undefined, undefined);
				}
			}
		});

		// Add navigation and attribution controls after fitting bounds
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
		map.dragRotate.disable();
		map.touchZoomRotate.disableRotation();
		map.addControl(zoomhome, 'top-right');
		map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

		// Scroll zoom guard logic (unchanged)
		if (config.scrollZoomGuard) {
			const mapContainer = document.getElementById('graphic');
			let scrollZoomGuardMsg = document.getElementById('map-scrollzoomguard-msg');
			if (!scrollZoomGuardMsg) {
				scrollZoomGuardMsg = document.createElement('div');
				scrollZoomGuardMsg.id = 'map-scrollzoomguard-msg';
				scrollZoomGuardMsg.textContent = 'Use Shift + scroll to zoom the map';
				scrollZoomGuardMsg.style.position = 'absolute';
				scrollZoomGuardMsg.style.left = '50%';
				scrollZoomGuardMsg.style.top = '40%';
				scrollZoomGuardMsg.style.transform = 'translate(-50%, -50%)';
				scrollZoomGuardMsg.style.background = 'rgba(34,34,34,0.9)';
				scrollZoomGuardMsg.style.color = '#fff';
				scrollZoomGuardMsg.style.padding = '6px 16px';
				scrollZoomGuardMsg.style.borderRadius = '6px';
				scrollZoomGuardMsg.style.fontSize = '15px';
				scrollZoomGuardMsg.style.zIndex = 1001;
				scrollZoomGuardMsg.style.display = 'none';
				scrollZoomGuardMsg.style.pointerEvents = 'none';
				mapContainer.style.position = 'relative';
				mapContainer.appendChild(scrollZoomGuardMsg);
			}

			map.scrollZoom.disable();

			let wheelZoomTarget = null;
			let wheelZoomTimeout = null;
			mapContainer.addEventListener('wheel', function(e) {
				if (e.shiftKey) {
					e.preventDefault();
					const zoomStep = 0.25;
					let newZoom = (wheelZoomTarget !== null ? wheelZoomTarget : map.getZoom());
					if (e.deltaY < 0) {
						newZoom += zoomStep;
					} else if (e.deltaY > 0) {
						newZoom -= zoomStep;
					}
					newZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), newZoom));
					wheelZoomTarget = newZoom;
					map.setZoom(newZoom);
					clearTimeout(wheelZoomTimeout);
					const rect = mapContainer.getBoundingClientRect();
					const mouseX = e.clientX - rect.left;
					const mouseY = e.clientY - rect.top;
					const around = map.unproject([mouseX, mouseY]);
					wheelZoomTimeout = setTimeout(() => {
						map.easeTo({ zoom: wheelZoomTarget, duration: 200, around });
						wheelZoomTarget = null;
					}, 160);
				} else {
					e.preventDefault();
					scrollZoomGuardMsg.style.display = 'block';
					clearTimeout(scrollZoomGuardMsg._hideTimeout);
					scrollZoomGuardMsg._hideTimeout = setTimeout(() => {
						scrollZoomGuardMsg.style.display = 'none';
					}, 1600);
				}
			}, { passive: false });
		}

		// Send height for pym
		if (pymChild) pymChild.sendHeight();
	});
}

function setupData() {
	Promise.all([
		d3.csv(config.dataUrl),
		d3.json(config.geoUrl)
	]).then(([csv, geog]) => {
			data = csv;
			areas = geog;

			// Set up value lookup and breaks (case-insensitive)
			data.forEach((d) => {
				const keys = Object.keys(d);
				const areacdKey = keys.find(k => k.toLowerCase() === 'areacd');
				const areanmKey = keys.find(k => k.toLowerCase() === 'areanm');
				if (areacdKey && areanmKey) {
					rateById[d[areacdKey].toUpperCase()] = +d.value;
					areaById[d[areacdKey].toUpperCase()] = d[areanmKey];
				}
			});

			// Calculate breaks and color scale
			let palette;
			if (Array.isArray(config.colourPalette) && config.colourPalette.length > 0) {
				palette = config.colourPalette;
			} else if (typeof config.colourPalette === 'string' && d3[`scheme${config.colourPalette}`]) {
				palette = d3[`scheme${config.colourPalette}`][7]; // default to 7 classes
			} else {
				palette = d3.schemeBlues[7];
			}

			// Helper to get decimal places from legendFormat
			function getLegendDecimals(fmt) {
				// e.g. ',.2f' => 2
				const m = fmt && fmt.match(/\.([0-9]+)/);
				return m ? parseInt(m[1], 10) : 0;
			}
			const legendDecimals = getLegendDecimals(config.legendFormat || ',.2f');

			// Calculate breaks
			if (Array.isArray(config.breaks)) {
				breaks = config.breaks;
			} else if (config.breaks === 'equal') {
				// Equal interval breaks
				const values = data.map(d => +d.value).filter(v => !isNaN(v));
				const min = d3.min(values), max = d3.max(values);
				const n = palette.length;
				const step = (max - min) / n;
				breaks = Array.from({length: n+1}, (_, i) => {
					const val = min + i * step;
					return +val.toFixed(legendDecimals);
				});
			} else if (config.breaks === 'jenks' && typeof ss !== 'undefined') {
				// Jenks breaks (using ckmeans, like old map)
				const values = data.map(d => +d.value).filter(v => !isNaN(v)).sort(d3.ascending);
				const n = palette.length;
				let clusters = ss.ckmeans(values, n);
				breaks = [];
				clusters.forEach((cluster, i) => {
					if (i < n - 1) {
						breaks.push(+cluster[0].toFixed(legendDecimals));
					} else {
						breaks.push(+cluster[0].toFixed(legendDecimals));
						// last cluster: push its max value as the upper bound
						breaks.push(+cluster[cluster.length - 1].toFixed(legendDecimals));
					}
				});
			} else {
				// fallback: auto - which is equal interval
				console.warn('Invalid config.breaks, defaulting to equal interval');
				const values = data.map(d => +d.value).filter(v => !isNaN(v));
				const min = d3.min(values), max = d3.max(values);
				const n = palette.length;
				const step = (max - min) / n;
				breaks = Array.from({length: n+1}, (_, i) => {
					const val = min + i * step;
					return +val.toFixed(legendDecimals);
				});
			}

			colour = d3.scaleThreshold()
				.domain(breaks.slice(1))
				.range(palette);

			drawMap();

		});
}

// Initialise pym and load data
window.onload = () => {
	pymChild = new pym.Child({ renderCallback: setupData });
};
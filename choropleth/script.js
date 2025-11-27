import { initialise, addSource } from "../lib/helpers.js";
import { detectGeographySource, fetchPostcodes, getElementHeightById, setSearchText, pointInPolygon, yearFilter, collectCoords, calculateBounds, calculateZoomPadding, getLegendDecimals, calculateBreaks } from "../lib-maps/map-helpers.js";


let pymChild = null;

let map, areas, data, breaks, colour, rateById = {}, areaById = {};
let hoveredAreaCode = null; // Track hovered area code
let selectedAreaCode = null; // Track selected area code
let selectedAreaName = null; // Track selected area name

let geographySource = detectGeographySource(config.geoUrl);

console.log('Geography source type:', geographySource);

// Listen for ESC key to clear selection
document.addEventListener('keydown', function(e) {
	if (e.key === 'Escape' || e.key === 'Esc') {
		// Clear both selection and hover feature-state and info
		if (typeof map !== 'undefined' && map !== null) {
			if (hoveredAreaCode) {
				map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: hoveredAreaCode }, { hovered: false });
			}
			if (selectedAreaCode) {
				map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: selectedAreaCode }, { selected: false });
			}
			hoveredAreaCode = null;
			selectedAreaCode = null;
			selectedAreaName = null;
			if (map.getCanvas) map.getCanvas().style.cursor = '';
			if (window.moveKeyIndicator) window.moveKeyIndicator(undefined);
			if (window.moveKeyIndicatorSelected) window.moveKeyIndicatorSelected(undefined);
			// Always clear explainer and value immediately
			updateKeyInfo(undefined, undefined);
			// Reset search box to placeholder
			setSearchText("");
		}
	}
});

// --- Autocomplete and search logic ---
let areaNames = [];
let areaNameToCode = {};
let areaCodeToFeature = {};


// Function to populate search results
async function searchSuggest(query, populateResults) {
	const safeQuery = query.replace(/[^\w\s]/gi, ""); // Remove special characters
  let results = !safeQuery || query === selectedAreaName ? areaNames :
		areaNames.filter((name) =>
			name.match(new RegExp(`\\b${safeQuery}`, "i"))
		);
	if (results.length === 0) results = await fetchPostcodes(safeQuery);
  populateResults(results);
}

// --- Add search box above the map ---
function addSearchBox() {
	const searchBoxId = 'search-box';
	const mapWrapper = document.getElementById('mapwrapper') || document.body;
	const searchDiv = document.createElement('div');
	const searchLabel = document.createElement('label');
	searchLabel.className = "visuallyhidden";
	searchLabel.htmlFor = searchBoxId;
	searchLabel.innerHTML = "Select an area";
	searchDiv.id = 'search-container';

	if (mapWrapper === document.body) {
		document.body.appendChild(searchLabel);
		document.body.appendChild(searchDiv);
	} else {
		mapWrapper.parentNode.insertBefore(searchLabel, mapWrapper);
		mapWrapper.parentNode.insertBefore(searchDiv, mapWrapper);
	}

	// Initialise the accessible autocomplete
	accessibleAutocomplete({
		element: searchDiv,
		id: searchBoxId,
		source: searchSuggest,
		placeholder: "Type a place name or postcode",
		showAllValues: true,
		autoselect: true,
		confirmOnBlur: false,
		displayMenu: "overlay",
		onConfirm: (name) =>
			name.match(/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/) ? selectAreaByPostcode(name) : selectAreaByName(name),
		dropdownArrow: (opts) =>
			`<svg class="${opts?.className}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 11.75 7.7" width="18" style="z-index:1"><path fill="currentColor" d="m1.37.15 4.5 5.1 4.5-5.1a.37.37 0 0 1 .6 0l.7.7a.45.45 0 0 1 0 .5l-5.5 6.2a.37.37 0 0 1-.6 0l-5.5-6.1a.64.64 0 0 1 0-.6l.7-.7a.64.64 0 0 1 .6 0Z"></path></svg>`
	});
}

const graphic = d3.select('#graphic');

function setupAreaSearchIndex() {
	if (!areas || !areas.features) return;
	if (!areas.features.length) return;
	const firstProps = areas.features[0].properties;
	if (!(config.geoIdField in firstProps) || !(config.geoNameField in firstProps)) {
		console.error(`Mismatched geoIdField ('${config.geoIdField}') or geoNameField ('${config.geoNameField}') in config. Available keys:`, Object.keys(firstProps));
		return;
	}
	areaNames = [];
	areaNameToCode = {};
	areaCodeToFeature = {};
	areas.features.forEach(f => {
		const code = f.properties[config.geoIdField];
		const name = f.properties[config.geoNameField];
		areaNames.push(name);
		areaNameToCode[name.toLowerCase()] = code;
		areaCodeToFeature[code] = f;
	});
	areaNames.sort((a, b) => a.localeCompare(b));
}

function selectAreaByName(name) {
	const code = areaNameToCode[name.toLowerCase()];
	if (!code) return;
	const feature = areaCodeToFeature[code];
	if (!feature) return;
	// Simulate click on area
	selectAreaFeature(feature);
}

async function selectAreaByPostcode(code) {
	const url = `https://api.postcodes.io/postcodes/${code}`;
	try {
		const json = await (await fetch(url)).json();
		if (json.result) selectAreaByLngLat(json.result.longitude, json.result.latitude);
		else console.log("Invalid postcode");
	} catch {
		console.log("Failed to fetch postcode");
	}
}

function selectAreaFeature(feature) {
	// This mimics the click event logic
		const code = feature.properties[config.geoIdField];
		const areaName = feature.properties[config.geoNameField];
		// Always ensure areaById is set for this code
		if (!areaById[code]) {
			areaById[code] = areaName;
		}
		// Clear previous selected state if different
		if (selectedAreaCode && selectedAreaCode !== code) {
			map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: selectedAreaCode }, { selected: false });
		}
		selectedAreaCode = code;
		selectedAreaName = areaName;
		map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: code }, { selected: true });
		map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: selectedAreaCode }, { hover: false });
		const selectedVal = rateById[code];
		window.moveKeyIndicator(undefined);
		window.moveKeyIndicatorSelected(selectedVal);
		updateKeyInfo(selectedVal, areaName);
	
	// Zoom to area bounds (same as click logic)
	
	if (feature && feature.geometry) {
		let allCoords = collectCoords(feature.geometry);
		if (allCoords.length) {
			let bounds = calculateBounds(allCoords)
			const padding = calculateZoomPadding(map);
			const options = {
				padding,
				animate: true
			};
			// const targetZoom = map.cameraForBounds(bounds, options)?.zoom;
			map.fitBounds(bounds, options);

		}
	}
}

function selectAreaByLngLat(lon, lat) {
	console.log("position: long:", lon, " lat:",lat);

	//Jank way of selecting area by postcode - don't think it works properly - need to see how energyefficiencyofhousing does it
	if (geographySource === 'vector') {
		// Project lat/lng to screen pixel
		if (!map) return;
		const point = map.project([lon, lat]);
		// Query rendered features at this pixel
		const features = map.queryRenderedFeatures(point, { layers: ['area'] });
		if (features && features.length > 0) {
			// Simulate click/select on the first feature
			const feature = features[0];
			// Defensive: ensure areaById is set for this code
			const code = feature.properties[config.geoIdField];
			const areaName = feature.properties[config.geoNameField];
			if (!areaById[code]) areaById[code] = areaName;
			// Use the same logic as click handler
			if (selectedAreaCode && selectedAreaCode !== code) {
				map.setFeatureState({ source: 'area', sourceLayer: config.geoLayer, id: selectedAreaCode }, { selected: false });
			}
			selectedAreaCode = code;
			selectedAreaName = areaName;
			map.setFeatureState({ source: 'area', sourceLayer: config.geoLayer, id: selectedAreaCode }, { selected: true });
			if (hoveredAreaCode) {
				map.setFeatureState({ source: 'area', sourceLayer: config.geoLayer, id: hoveredAreaCode }, { hovered: false });
				hoveredAreaCode = null;
			}
			const selectedVal = rateById[code];
			window.moveKeyIndicator(undefined);
			window.moveKeyIndicatorSelected(selectedVal);
			updateKeyInfo(selectedVal, areaName);

			// Zoom to area bounds (if geometry is available)
			if (feature && feature.geometry) {
				let allCoords = collectCoords(feature.geometry);				
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
		} else {
			alert('No area found for this postcode');
		}
		return;
	}

	// Fallback: GeoJSON/TopoJSON point-in-polygon
	if (!areas || !areas.features) return;
	const pt = [lon, lat];
	const found = areas.features.find(f => {
		if (!f.geometry) return false;
		if (f.geometry.type === 'Polygon') {
			return pointInPolygon(pt, f.geometry.coordinates[0]);
		} else if (f.geometry.type === 'MultiPolygon') {
			return f.geometry.coordinates.some(poly => pointInPolygon(pt, poly[0]));
		}
		return false;
	});
	if (found) {
		selectAreaFeature(found);
	} else {
		alert('No area found for this postcode');
	}
}



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
	// Alignment logic for explainer/value
	const keyInfoNode = document.getElementById('keyinfo');
	const valueNode = document.getElementById('keyinfo-value');
	const explainerNode = document.getElementById('keyinfo-explainer');
	if (keyInfoNode && valueNode && explainerNode) {
		// Set right margin from config.keyScaleMargin.right
		if (config.keyScaleMargin && typeof config.keyScaleMargin.right === 'number') {
			keyInfoNode.style.marginRight = 'calc('+config.keyScaleMargin.right + 'px - 1rem)';
		} else {
			keyInfoNode.style.marginRight = '';
		}
		if (config.explainerAlignment === 'right') {
			keyInfoNode.style.flexDirection = 'row-reverse';
			keyInfoNode.style.justifyContent = 'flex-end';
			valueNode.style.textAlign = 'left';
			explainerNode.style.textAlign = 'right';
		} else {
			keyInfoNode.style.flexDirection = 'row';
			keyInfoNode.style.justifyContent = '';
			valueNode.style.textAlign = 'right';
			explainerNode.style.textAlign = 'left';
		}
	}
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
		// Always clear explainer lines if both arguments are undefined
		if (typeof value === 'undefined' && typeof areaName === 'undefined') {
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

	// Explainer: explainerPrefix, area name (bold), explainerSuffix (all in one container, prefix/suffix can be HTML)
	const explainerPrefix = config.explainerPrefix || '';
	const explainerSuffix = config.explainerSuffix || '';
	let explainerHtml = '';
	explainerHtml += explainerPrefix;
	if (areaName) {
		explainerHtml += '<strong>' + d3.create('span').text(areaName).node().textContent + '</strong>';
	}
	explainerHtml += explainerSuffix;
	explainerLine1.html(explainerHtml);
	explainerLine2.text('');
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

	// This is all to do with working out if dropticks are needed (overlap)
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
		fitBoundsOptions: { padding: { top: 10, left: 10, right: 10, bottom: bottomPad }},
		attributionControl: false,
	});

	if (geographySource !== "vector") {
		// Convert TopoJSON to GeoJSON
		if (areas.type !== "FeatureCollection") {
			const key = areas.objects[config.geoLayer] ? config.geoLayer : Object.keys(areas.objects)[0];
			areas = topojson.feature(areas, areas.objects[key]);
			if (geographySource === "topojson" && config.geoYear) {
				areas.features = areas.features.filter(d => yearFilter(d.properties, config.geoYear));
			}
		}

		if (config.geoCountries.length < 4) {
			areas.features = areas.features.filter(d => config.geoCountries.includes(d.properties[config.geoIdField][0]));
		}

		// Add data properties to geojson
		// areas.features.forEach((d) => {
		// 	const code = d.properties[config.geoIdField]
		// 	const value = code ? rateById[code] : undefined;
		// 	d.properties.value = value;
		// 	let fillColor = colour(value);
		// 	if (!fillColor || fillColor === null) {
		// 		fillColor = config.colourUnavailable; // fallback color for missing/invalid data
		// 	}
		// 	d.properties.fill = fillColor;
		// });
	}

	// Draw the key scale
	drawKeyScale();
	// Build area search index after geojson is loaded
	setupAreaSearchIndex();
	// Add search box (requires search index)
	addSearchBox();

	// Add area source and layer, and fit bounds with bottom padding after map and overlay are rendered
	map.on('load', () => {

		if (geographySource === "vector") {

			map.addSource('area', { type: 'vector', tiles: [config.geoUrl], promoteId: {[config.geoLayer]: config.geoIdField}});

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
				'line-opacity': ['case', ['==', ['feature-state', 'selected'], true], 0.4,0],
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
				map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: hoveredAreaCode }, { hovered: false });
			}
			hoveredAreaCode = code;

			map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: hoveredAreaCode }, { hovered: true });

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
				map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: hoveredAreaCode }, { hovered: false });
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
				map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: selectedAreaCode }, { selected: false });
			}
			selectedAreaCode = code;
			selectedAreaName = areaName;
			map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: selectedAreaCode }, { selected: true });
			// Remove hover state (if any)
			if (hoveredAreaCode) {
				map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: hoveredAreaCode }, { hovered: false });
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
				if (typeof map !== 'undefined' && map !== null) {
					if (selectedAreaCode) {
						map.setFeatureState({ source: 'area', sourceLayer: (geographySource === "vector" ? config.geoLayer : ""), id: selectedAreaCode }, { selected: false });
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
			data = csv;
			areas = geog;

			// Set up value lookup and breaks
			data.forEach((d) => {
					rateById[d[config.dataIdField]] = +d.value;
					areaById[d[config.dataIdField]] = d[config.geoNameField];
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

			const legendDecimals = getLegendDecimals(config.legendFormat || ',.2f');

			// Calculate breaks
			if (Array.isArray(config.breaks)) {
				breaks = config.breaks;
			} else {
				breaks = calculateBreaks(data.map(d => +d.value).filter(v => !isNaN(v)).sort(d3.ascending),config.breaks,palette.length,legendDecimals)
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
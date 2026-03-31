/*
Range change choropleth (preconfigured)

This folder is a starter template that reuses the shared implementation from:
  ../dataset_switch_time_series_choropleth/script.js

Edit this config to point at your own time-series CSV(s) and geography.
*/

config = {
	debugInfo: true,

	// Top-level values act as fallbacks.
	// Each dataset below can override these with its own:
	// - timeSelectionMode: "point" | "range"
	// - startTime
	// - startFromTime / startToTime
	// - changeMetric
	// - valueFormat / changeFormat
	timeSelectionMode: "range", // fallback only
	changeMetric: "absolute", // fallback only
	startTime: null,
	startFromTime: null,
	startToTime: null,

	// Mixed example:
	// - Dataset 1 uses point mode (single selected year)
	// - Dataset 2 uses range mode (change from one year to another)
	// Reference the sample datasets from the time-series folder (so we don't duplicate data)
	datasets: [
		{
			label: "Per 1,000 population (point)",
			url: "../dataset_switch_time_series_choropleth/data_over_time_0.csv",
			timeSelectionMode: "point",
			startTime: "2015",
			chart: {
				subTitle: "Single-year view"
			}
		},
		{
			label: "Per 100 sales (% change)",
			url: "../dataset_switch_time_series_choropleth/data_over_time_1.csv",
			timeSelectionMode: "range",
			changeMetric: "percent",
			startFromTime: "2013",
			startToTime: "2015",
			chart: {
				subTitle: "Percentage change between selected years",
				changeSummary: {
					enabled: true,
					threshold: 0.5,
					noSignificantChangeText: "No significant change",
					increaseText: "Increase",
					decreaseText: "Decrease",
					indicatorStyle: "triangle", // "triangle" | "text" | "none"
					requiredContrast: 4.5,
					neutralColour: ONScolours.grey60
				}
			}
		},
	],
	dataUrl: "../dataset_switch_time_series_choropleth/data_over_time_0.csv",

	geoUrl: "../dataset_switch_time_series_choropleth/geog.json",
	geoYear: 2025,
	geoLayer: "ltla",
	geoCountries: ["E", "W", "S", "N"],
	geoIdField: "AREACD",
	geoNameField: "AREANM",
	dataIdField: "areacd",
	dataNameField: "areanm",
	takeNameFromGeo: true,

	mapHeight: "550px",

	colourPalette: [
		ONScolours.sequential.alternative[5],
		ONScolours.diverging.negativeToPositive[5]
	],
	colourUnavailable: ONScolours.noData,
	breaks: ["jenks", [-50, -25, -2, 2, 25, 50]],
	breaksNumber: [5, 5],

	// In range mode, breaks are recomputed for the chosen range.
	timeBreaksMode: "fixed",

	// Timeline formatting
	timeline: {
		displayFormat: "%Y",
		screenreaderFormat: "%B %Y",
		parseFormat: null,
		ticktext: {
			tickMethod: "interval",
			tickCount: { sm: 2, md: 2, lg: 6 },
			tickInterval: { unit: "year", step: { sm: 2, md: 2, lg: 2 } },
			addFirstDate: false,
			addFinalDate: true,
		},
		ariaLabel: "Select time period or range",
		keyboardStep: 5
	},

	valueFormat: [",.1f", ",.1f"],
	valuePrefix: ["", ""],
	valueSuffix: ["", ""],
	changeFormat: [null, ",.1f"],
	changePrefix: [null, ""],
	changeSuffix: [null, "%"],
	legendFormat: [",.0f", ",.0f"],
	legendPrefix: ["", ""],
	legendSuffix: ["", "%"],
	changeLegendFormat: [null, ",.0f"],
	changeLegendPrefix: [null, ""],
	changeLegendSuffix: [null, "%"],

	mapBounds: [[-7, 50.2], [1.77, 59]],
	maxBounds: [[-14, 46], [8, 62]],
	minZoom: 4.3,
	maxZoom: 13,
	fillOpacity: 0.8,
	sourceText: "Office for National Statistics",
	accessibleSummary: "Here is the screenreader text describing the chart.",
	scrollZoomGuard: true,
	keyScaleMargin: { left: 20, right: 15, top: 10, bottom: 10 },
	elements: { select: 1, nav: 1, legend: 1, titles: 0 },

	chart: {
		dimensions: {
			pinned: { width: 420, height: 313 },
			hover: { width: 300, height: 250 }
		},
		margin: { top: 24, right: 20, bottom: 30, left: 30 },
		showMeanLine: true,
		meanLegend: {
			label: "UK Average",
			color: ONScolours.grey25
		},
		yTicks: { pinned: 5, hover: 3 },
		lineStyle: "solid",
		solidStroke: ONScolours.oceanBlue,
		showBreaks: false,
	}
};

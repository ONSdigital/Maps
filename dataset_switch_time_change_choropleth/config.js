/*
Range change choropleth (preconfigured)

This folder is a starter template that reuses the shared implementation from:
  ../dataset_switch_time_series_choropleth/script.js

Edit this config to point at your own time-series CSV(s) and geography.
*/

config = {
	debugInfo: true,

	// Enable range selection (From/To)
	timeSelectionMode: "range", // "point" | "range"
	changeMetric: "percent", // "absolute" | "percent"

	// Optional initial range endpoints (must match a CSV header exactly).
	// If omitted/invalid, defaults to min/max.
	startFromTime: null,
	startToTime: null,

	// Reference the sample datasets from the time-series folder (so we don't duplicate data)
	datasets: [
		{ label: "Per 1,000 population", url: "../dataset_switch_time_series_choropleth/data_over_time_0.csv" },
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

	paletteMode: "single",
	colourPalette: ONScolours.diverging.negativeToPositive[5],
	colourUnavailable: ONScolours.noData,
	breaks: [[-50, -25, -2, 2, 25, 50]],
	breaksNumber: 5,

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
		ariaLabel: "Select time range",
		keyboardStep: 5
	},

	valueFormat: ",.1f",
	valuePrefix: "",
	valueSuffix: "%",
	legendFormat: ",.0f",
	legendPrefix: "",
	legendSuffix: "%",

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
		subTitle: ["", ""],
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

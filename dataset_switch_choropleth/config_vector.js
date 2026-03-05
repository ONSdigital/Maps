// Vector-tile example configuration (global)
// See notes in choropleth/config_vector.js — with PBF vector tiles we don't have full
// client-side feature geometries, so some helper behaviour (e.g. search index building) is limited.

config = {
	dataUrl: "data_energy_efficiency.csv",
	geoUrl: "https://cdn.ons.gov.uk/maptiles/administrative/2021/msoa/v2/boundaries/{z}/{x}/{y}.pbf", //if null uses default topoJSON otherwise can be a .json file or vector tile service (e.g. 'https://cdn.ons.gov.uk/maptiles/administrative/2021/msoa/v2/boundaries/{z}/{x}/{y}.pbf')
	geoYear: 2025, // only needed for default topoJSON
	geoLayer: "msoa", // source layer within default topoJSON or vector tile source
	geoCountries: ["E", "W", "S", "N"], // which countries to include from default topoJSON - E, W, S, N
	geoIdField: "areacd", // feature property in geo file that matches id field in data file
	geoNameField: "areanm", // feature property to use for area name
	dataIdField: "AREACD", // column in data file that matches geoIdField in geo file
	mapHeight: "850px",
	colourPalette: ["#E92730","#f0702f","#f6ae35","#f1ec37","#95ca53","#2ea949","#0a8647"], // can be preset colourbrewer palette or custom array of colours
	colourUnavailable: "#ccc",
	breaks: [0,20,38,54,68,80,91,110], // can be "equal", "jenks", or a custom array of breaks - number of values in palette determines number of breaks
	valueFormat: ",.0f", // d3 format for values
	valuePrefix: "",
	valueSuffix: "",
	legendFormat: ",.0f",
	legendPrefix: " ",
	legendSuffix: "",
	explainerAlignment: "left", // left or right, defaults to left
	explainerPlaceholder: "EPC energy efficiency score",
	explainerPlaceholderTextSize: "0.9em", // font-size for placeholder text (e.g., "0.9em", "14px", or a number for px)
	explainerPrefix: "average EPC energy efficiency score in ",
	explainerSuffix: "",
	unavailablePrefix: "The value for",
	unavailableSuffix: "is unavailable", //could change to suppressed if purposefully suppressed
	mapBounds: [[-6, 50], [2.5, 55.5]],
	maxBounds: [[-14, 46], [8, 62]], // restrict panning to these bounds
	minZoom: 6,
	maxZoom: 13,
	fillOpacity: 0.8,
	sourceText: "Office for National Statistics",
	accessibleSummary: "Here is the screenreader text describing the chart.",
	scrollZoomGuard: true, // if true, user has to hold shift key to zoom map with scroll
	keyScaleMargin: { left: 20, right: 20, top: 10, bottom: 10 },
	elements: { select: 1, nav: 1, legend: 1, titles: 0 },
	chartBuild: {}
};

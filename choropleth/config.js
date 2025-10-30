config = {
	dataUrl: "data.csv",
	geoUrl: "geog.json", //if null uses default topoJSON otherwise can be a .json file or vector tile service (e.g. 'https://cdn.ons.gov.uk/maptiles/administrative/2021/msoa/v2/boundaries/{z}/{x}/{y}.pbf')
	geoYear: 2025, // only needed for default topoJSON
	geoLayer: "ltla", // source layer within default topoJSON or vector tile source
	geoCountries: ["E", "W", "S", "N"], // which countries to include from default topoJSON - E, W, S, N
	geoIdField: "AREACD", // feature property in geo file that matches id field in data file
	geoNameField: "AREANM", // feature property to use for area name
	dataIdField: "areacd", // column in data file that matches geoIdField in geo file
	mapHeight: "650px",
	colourPalette: ['#edf8b1','#c7e9b4','#7fcdbb','#41b6c4','#1d91c0','#225ea8','#0c2c84'], // can be preset colourbrewer palette (e.g. YlGnBu) or custom array of colours
	colourUnavailable: "#ccc",
	breaks: "jenks", // can be "equal", "jenks", or a custom array of breaks - number of values in palette determines number of breaks
	valueFormat: ",.0f", // d3 format for values
	valuePrefix: "£",
	valueSuffix: "",
	legendFormat: ",.0f",
	legendPrefix: "£",
	legendSuffix: "",
	explainerPlaceholder: "Mean monthly private rent price",
	explainerPrefix: "is the mean monthly private rent price in ",
	explainerSuffix: "",
	unavailablePrefix: "The value for",
	unavailableSuffix: "is unavailable", //could change to suppressed if purposefully suppressed
	mapBounds: [[-8.62, 48.87], [1.77, 60.84]], // UK bounds (Shetland cut off a bit): [[-8.62, 48.87], [1.77, 60.84]] England and Wales: [[-6.43, 50], [1.77, 55.81]]
	minZoom: 4.3,
	maxZoom: 13,
	fillOpacity: 0.8,
	sourceText: "Office for National Statistics",
	accessibleSummary: "Here is the screenreader text describing the chart.",
	scrollZoomGuard: true, // if true, user has to hold shift key to zoom map with scroll
	keyScaleMargin: { left: 20, right: 20, top: 10, bottom: 10 },
	elements: { select: 1, nav: 1, legend: 1, titles: 0 },
	chartBuild: {}
};

config = {
	dataUrl: "data.csv",
	geoUrl: "geog.json",
	mapHeight: "650px",
	colourPalette: "YlGnBu", // can be preset colourbrewer palette or custom array of colours
	colourUnavailable: "#ccc",
	unavailablePrefix: "The value for",
	unavailableSuffix: "is unavailable", //could change to suppressed if purposefully suppressed
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

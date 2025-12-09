/*
Multi-dataset behaviour:

- If your data.csv contains multiple value columns (excluding id and name columns),
  buttons will appear above the search box to switch between datasets.

- For config options such as:
    - colourPalette
    - breaks
    - explainerPlaceholder
    - explainerPrefix
    - explainerSuffix
    - unavailablePrefix
    - unavailableSuffix
  you can provide either:
    - an array (one value per dataset, in the same order as the columns), or
    - a single value (used for all datasets).

- Palette selection is controlled by paletteMode:
    - "single":   All datasets use the first palette in colourPalette (or the string value if not an array)
    - "multiple": Each dataset uses its own palette from colourPalette (array, one per dataset)

- When switching datasets, the map, legend, info area, and explainer/unavailable text
  will update to reflect the selected dataset's config values.
*/

config = {
	dataUrl: "data.csv",
	geoUrl: "geog.json", //if null uses default topoJSON otherwise can be a .json file or vector tile service (e.g. 'https://cdn.ons.gov.uk/maptiles/administrative/2021/msoa/v2/boundaries/{z}/{x}/{y}.pbf')
	geoYear: 2025, // only needed for default topoJSON
	geoLayer: "ltla", // source layer within default topoJSON or vector tile source
	geoCountries: ["E", "W", "S", "N"], // which countries to include from default topoJSON - E, W, S, N
	geoIdField: "AREACD", // feature property in geo file that matches id field in data file
	geoNameField: "AREANM", // feature property to use for area name
	dataIdField: "areacd", // column in data file that matches geoIdField in geo file
	dataNameField: "areanm", // column in data file for area name
	takeNameFromGeo: true, // if true, area names are taken from geo file using geoNameField, if false it will use the dataNameField from data file
	mapHeight: "650px",
	paletteMode: "multiple", // "single" = one palette for all datasets, "multiple" = separate palette per dataset
	colourPalette: [['#edf8b1','#c7e9b4','#7fcdbb','#41b6c4','#1d91c0','#225ea8','#0c2c84'],"PuRd"], // can be preset colourbrewer palette (e.g. YlGnBu) or custom array of colours
	colourUnavailable: "#ccc",
	breaks: ["jenks","equal"], // can be "equal", "jenks", or a custom array of breaks - number of values in palette determines number of breaks
	valueFormat: ",.0f", // d3 format for values
	valuePrefix: "£",
	valueSuffix: "",
	legendFormat: ",.0f",
	legendPrefix: "£",
	legendSuffix: "",
	explainerAlignment: "right", // left or right
	explainerPlaceholder: ["Mean monthly private rent price","Random value"], // if multiple datasets, provide array with one entry per dataset
	explainerPrefix: ["Mean monthly private rent price in</br>", "The made up value in "], //can include HTML
	explainerSuffix: ["", " is"],
	unavailablePrefix: "The value for",
	unavailableSuffix: "is unavailable", //could change to suppressed if purposefully suppressed
	mapBounds: [[-7, 50.2], [1.77, 59]], // UK bounds (Shetland cut off a bit): [[-8.62, 48.87], [1.77, 60.84]] England and Wales: [[-6.43, 50], [1.77, 55.81]]
	maxBounds: [[-14, 46], [8, 62]], // restrict panning to these bounds
	minZoom: 4.3,
	maxZoom: 13,
	fillOpacity: 0.8,
	sourceText: "Office for National Statistics",
	accessibleSummary: "Here is the screenreader text describing the chart.",
	scrollZoomGuard: true, // if true, user has to hold shift key to zoom map with scroll
	keyScaleMargin: { left: 20, right: 40, top: 10, bottom: 10 },
	elements: { select: 1, nav: 1, legend: 1, titles: 0 },
	chartBuild: {}
};
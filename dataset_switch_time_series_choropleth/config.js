/*
Multi-dataset behaviour:

- If your data.csv contains multiple value columns (excluding id and name columns),
  buttons will appear above the search box to switch between datasets.

- For config options such as:
    - colourPalette
    - breaks
	- breaksNumber
	- valueFormat/Prefix/Suffix
	- legendFormat/Prefix/Suffix
	- explainerPlaceholder
	- explainerPlaceholderTextSize
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
	debugInfo: true,
	// Time-series datasets (wide format: id + name + one column per time point)
	datasets: [
		{ label: "Per 1,000 population", url: "data_over_time_0.csv" },
		{ label: "Per 100 sales", url: "data_over_time_1.csv" }
	],
	dataUrl: "data_over_time_0.csv", // used as a fallback if datasets is not provided
	geoUrl: "geog.json", //if null uses default topoJSON otherwise can be a .json file or vector tile service (e.g. 'https://cdn.ons.gov.uk/maptiles/administrative/2021/msoa/v2/boundaries/{z}/{x}/{y}.pbf')
	geoYear: 2025, // only needed for default topoJSON
	geoLayer: "ltla", // source layer within default topoJSON or vector tile source
	geoCountries: ["E", "W", "S", "N"], // which countries to include from default topoJSON - E, W, S, N
	geoIdField: "AREACD", // feature property in geo file that matches id field in data file
	geoNameField: "AREANM", // feature property to use for area name
	dataIdField: "areacd", // column in data file that matches geoIdField in geo file
	dataNameField: "areanm", // column in data file for area name
	takeNameFromGeo: true, // if true, area names are taken from geo file using geoNameField, if false it will use the dataNameField from data file
	mapHeight: "550px",
	// Colour scale
	paletteMode: "single",
	colourPalette: ONScolours.sequential.alternative[5], // can be preset d3.scheme palette name or custom array
	colourUnavailable: ONScolours.noData,
	breaks: "jenks", // "equal", "jenks", or a custom array of breaks
	breaksNumber: 5,
	// If true, breaks are calculated once per dataset across all time points (recommended for comparison)
	timeBreaksMode: "fixed", // "fixed" | "perTime"
	// Timeline start position. If null/undefined or not found in the data headers, defaults to the last time point.
	// Example: startTime: "2011"
	startTime: null,
	// Timeline display and accessibility formatting
	// - displayFormat controls the labels under the track and the active pill label
	// - screenreaderFormat controls aria-valuetext (e.g. "January 2004")
	// - parseFormat (optional) is a d3.timeParse format used to parse CSV header strings into Date objects
	//   If omitted, the template will attempt a simple heuristic parse (YYYY, YYYY-MM, YYYY-MM-DD).
	timeline: {
		displayFormat: "%Y",
		screenreaderFormat: "%B %Y",
		parseFormat: null,
		ariaLabel: "Select time period",
		keyboardStep: 5
	},
	valueFormat: ",.1f", // d3 format for values
	valuePrefix: "",
	valueSuffix: "",
	legendFormat: ",.0f",
	legendPrefix: "",
	legendSuffix: "",
	explainerAlignment: "right", // left or right
	explainerPlaceholder: "Select an area",
	explainerPlaceholderTextSize: "0.9em", // font-size for placeholder text (e.g., "0.9em", "14px", or a number for px)
	explainerPrefix: "First time buyer mortgages in</br>",
	explainerSuffix: ["<br>per 1,000 people</br>","</br>per 100 house sales"],
	unavailablePrefix: "The value for",
	unavailableSuffix: "is unavailable", //could change to suppressed if purposefully suppressed
	mapBounds: [[-7, 50.2], [1.77, 59]], // Set to "auto" to use GeoJSON/TopoJSON extents (not supported for vector tiles). Ensure maxBounds and minZoom are set so the auto view displays correctly. UK bounds (Shetland cut off a bit): [[-8.62, 48.87], [1.77, 60.84]] England and Wales: [[-6.43, 50], [1.77, 55.81]]
	maxBounds: [[-14, 46], [8, 62]], // restrict panning to these bounds

	minZoom: 4.3,
	maxZoom: 13,
	fillOpacity: 0.8,
	sourceText: "Office for National Statistics",
	accessibleSummary: "Here is the screenreader text describing the chart.",
	scrollZoomGuard: true, // if true, user has to hold shift key to zoom map with scroll
	keyScaleMargin: { left: 20, right: 27, top: 10, bottom: 10 },
	elements: { select: 1, nav: 1, legend: 1, titles: 0 },

	// Chart config (overlay time-series)
	// Overlay sizing
	// - pinned: shown after click/search selection
	// - hover: tooltip-like preview shown on hover
	chartOverlay: {
		pinned: { width: 420, height: 313 },
		hover: { width: 300, height: 250 }
	},

	chart: {
		// Chart SVG height is derived automatically from chartOverlay.*.height.
		// (Font sizes / stroke widths remain constant; only the available plot area changes.)
		height: 220,
		margin: { top: 24, right: 20, bottom: 30, left: 30 },
		showMeanLine: true,
		meanLegend: {
			label: "UK Average",
			color: ONScolours.grey25
		},
		// Stroke style for the selected-area series in the overlay chart:
		// - "gradient": colour varies along the line based on choropleth breaks
		// - "solid": single stroke colour
		lineStyle: "solid", // "gradient" | "solid"
		solidStroke: ONScolours.oceanBlue,
		// If true, show the choropleth colour scale as swatches beside the chart y-axis
		showBreaks: false,
		// Draw a solid horizontal reference line at this value (set null/undefined to disable)
		zeroLine: 0,
	},

	chartBuild: {}
};
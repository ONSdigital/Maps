/*
Multi-dataset behaviour:

- If your data.csv contains multiple value columns (excluding id and name columns),
  buttons will appear above the search box to switch between datasets.

- For config options such as:
    - colourPalette
    - breaks
	- breaksNumber
	- valueFormat/Prefix/Suffix
	- changeFormat/Prefix/Suffix
	- legendFormat/Prefix/Suffix
	- changeLegendFormat/Prefix/Suffix
	- explainerPlaceholder
	- explainerPlaceholderTextSize
    - explainerPrefix
    - explainerSuffix
    - unavailablePrefix
    - unavailableSuffix
	- chart.subTitle
  you can provide either:
    - an array (one value per dataset, in the same order as the columns), or
    - a single value (used for all datasets).

- Palette selection is controlled by paletteMode:
	- "single":   All datasets use the first palette in colourPalette (or the string value if not an array)
	- "multiple": Each dataset uses its own palette from colourPalette (array, one per dataset)

- If paletteMode is omitted, it is inferred from colourPalette:
	- a flat array of colour strings = a single palette
	- an array of palette entries (palette names or arrays) = per-dataset palettes

- When switching datasets, the map, legend, info area, and explainer/unavailable text
  will update to reflect the selected dataset's config values.
*/

config = {
	debugInfo: true,
	// Time-series datasets (wide format: id + name + one column per time point)
	// Per-dataset overrides are supported on each dataset object, for example:
	// { label: "A", url: "a.csv", timeSelectionMode: "point", startTime: "2011", selectionBreaksMode: "perSelection" }
	// { label: "B", url: "b.csv", timeSelectionMode: "range", startFromTime: "2011", startToTime: "2021", changeMetric: "percent", selectionBreaksMode: "fixed" }
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
	// Controls whether choropleth breaks stay fixed or respond to the current selection.
	// - "fixed":
	//    point mode -> breaks are calculated once from all years in the dataset
	//    range mode -> breaks are calculated once from all valid from<to combinations in the dataset
	// - "perSelection":
	//    point mode -> breaks are recalculated for the currently selected year
	//    range mode -> breaks are recalculated for the currently selected from/to pair
	// This can also be set per dataset inside config.datasets[].
	selectionBreaksMode: "fixed", // "fixed" | "perSelection"
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
		// Configure which tick *text labels* appear under the timeline track.
		// Markers (dots) always render for every time point.
		// If ticktext is omitted (or null), tick labels are shown for every time point
		ticktext: {
			tickMethod: "interval", // "interval" or "total"
			tickCount: { // maximum labels for "total", including forced endpoints
				sm: 2,
				md: 2,
				lg: 6
			},
			tickInterval: { // for "interval" method
				unit: "year", // "year", "month", "quarter", "day"
				step: { // every x "units"
					sm: 2,
					md: 2,
					lg: 2
				}
			},
			addFirstDate: false,
			// If both endpoints are forced with tickCount: 1, the final date takes priority.
			addFinalDate: true,
		},
		ariaLabel: "Select time period",
		keyboardStep: 5
	},
	valueFormat: ",.1f", // d3 format for values
	valuePrefix: "",
	valueSuffix: "",
	// Range-mode computed changes can use a separate display format.
	// If omitted, change displays fall back to the raw value settings above.
	changeFormat: null,
	changePrefix: null,
	changeSuffix: null,
	legendFormat: ",.0f",
	legendPrefix: "",
	legendSuffix: "",
	changeLegendFormat: null,
	changeLegendPrefix: null,
	changeLegendSuffix: null,
	mapBounds: [[-7, 50.2], [1.77, 59]], // Set to "auto" to use GeoJSON/TopoJSON extents (not supported for vector tiles). Ensure maxBounds and minZoom are set so the auto view displays correctly. UK bounds (Shetland cut off a bit): [[-8.62, 48.87], [1.77, 60.84]] England and Wales: [[-6.43, 50], [1.77, 55.81]]
	maxBounds: [[-14, 46], [8, 62]], // restrict panning to these bounds

	minZoom: 4.3,
	maxZoom: 13,
	fillOpacity: 0.8,
	sourceText: "Office for National Statistics",
	accessibleSummary: "Here is the screenreader text describing the chart.",
	scrollZoomGuard: true, // if true, user has to hold shift key to zoom map with scroll
	keyScaleMargin: { top: 10, bottom: 10 },
	elements: { select: 1, nav: 1, legend: 1, titles: 0 },

	// Chart config (overlay time-series)
	chart: {
		// Overlay sizing
		// - pinned: shown after click/search selection
		// - hover: tooltip-like preview shown on hover
		dimensions: {
			pinned: { width: 420, height: 313 },
			hover: { width: 300, height: 250 }
		},
		// Chart SVG height is derived automatically from chart.dimensions.*.height.
		// (Font sizes / stroke widths remain constant; only the available plot area changes.)
		subTitle: ["First time buyers per 1,000 people","First time buyers per 100 house sales"],
		margin: { top: 24, right: 20, bottom: 30, left: 30 },
		showMeanLine: true,
		meanLegend: {
			label: "UK Average",
			color: ONScolours.grey25
		},
		yTicks: {
			pinned: 5,
			hover: 3
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
# Maps
Data visualisation team map templates.

This is the **NEW (work in progress)** map templates repository. The old repository is https://github.com/ONSdigital/maptemplates.

## Current templates
- [Simple Choropleth](https://potential-robot-9qzqj64.pages.github.io/choropleth/)
- [Dataset switch choropleth](https://potential-robot-9qzqj64.pages.github.io/dataset_switch_choropleth/)
- [Dataset switch time‑series choropleth](https://potential-robot-9qzqj64.pages.github.io/dataset_switch_time_series_choropleth/)

## Getting started
- Open any template folder and edit its `config.js` to match your data and styling needs.
- Replace the CSV/GeoJSON files in the template folder with your own (or use the built in default geographies)
- Preview by serving the folder with a local server.

## Configuration
Each template exposes common options such as:
- Data columns and join keys
- Colour scales and breaks
- Titles, labels, and annotations
- Explainer and legend settings

### Calculated break rounding

Set `breaksRoundTo` to a positive rounding interval for `"jenks"` or `"equal"`
breaks, for example `0.01`, `0.1`, `1`, `10`, `100`, `1000`, `10000`, or
`1000000`. Use `null` (the default), or omit the option, to keep unrounded breaks.

Inner breaks round to the nearest interval. The minimum rounds down and the
maximum rounds up so the legend still covers all data. If rounding would make
breaks identical, a configuration error is reported: use a smaller interval or
fewer classes. Custom break arrays are never rounded.

Dataset-switch templates accept a shared interval or an array such as
`breaksRoundTo: [1, 1000]`; a `null` entry disables rounding for that dataset.
Time-series and time-change templates also accept `breaksRoundTo` inside each
`datasets` entry, overriding the top-level setting. Rounding applies in both
`"fixed"` and `"perSelection"` modes.

This changes the numeric thresholds used by the map, not just their labels.
Keep `legendFormat` consistent with the chosen precision. Intervals use the
data's units: for fractional data displayed as percentages, `0.01` is one
percentage point.

### Legends and timelines

Keyscale labels are measured using their rendered text widths. Crowded labels
use additional rows above and below the colour bar, with leader lines and
automatically expanded legend spacing.

In the time-series and time-change templates, `timeline.ticktext.tickMethod:
"total"` treats `tickCount.sm`, `tickCount.md`, and `tickCount.lg` as strict
maximum label counts, including `addFirstDate` and `addFinalDate`. If the limit
is one and both endpoints are forced, the final date takes priority. Non-date
headers also use these limits. Interval mode is unchanged, and all time-point
markers remain available regardless of which text labels are shown.

The time-series and time-change templates support `timeline.mode`: `"auto"` (default),
`"pearls"`, or `"continuous"`, including inside a dataset's `timeline` override.
Auto switches to a continuous track when any adjacent time points are less
than 28px apart, and re-evaluates on resize. Both styles snap to the available
dates and retain keyboard navigation. Timelines highlight only the selected
date in single-date mode; the other markers and
track stay neutral. Range mode continues to highlight the selected span.
Switching between range and single-date datasets updates the date pills
immediately, without needing to interact with the timeline.
Timeline thumbs (including focus rings) and active labels stay within the
keyscale's horizontal bounds, including in
wide pym iframes. Carets point to the selected dates. Range labels separate
horizontally, or stack if they cannot fit.


### Time-series chart average/reference line

The over-time template (`dataset_switch_time_series_choropleth`) supports
`chart.average`:

```js
average: {
  method: "mean", // "mean" | "median" | "row" | "none"
  rowId: null,    // required only for "row": exact ID from dataIdField
  // label: "Published UK average", // optional; defaults to a method-specific label
  color: "#707071"
}
```

The bundled example configuration uses `"row"` with `rowId: "EXAMPLE_AVERAGE"`.
Both example time-series CSVs contain this row, with **fictional, illustrative
values only**, labelled "Example average (illustrative)". These are not
published, population-weighted or statistically valid estimates. Replace the
example values with an appropriate aggregate before publishing.

**Statistical warning:** `"mean"` is the arithmetic mean of available area
values at each time point. Each area has equal weight: it is **not weighted
by population or the relevant denominator**. Averaging area rates or percentages
this way is generally **not a statistically valid national or combined
estimate**. Do not label it "UK Average" or imply it is a population average.
The default label is "Mean of areas (unweighted)", with a warning on the legend.
For a national/combined estimate, prefer a published or correctly calculated
aggregate supplied in the CSV; the template does not calculate weighted estimates.

- `"median"` uses the middle available area value (the mean of the two middle
  values for an even count). This describes a typical **area**, not a typical
  person or a population-weighted/combined estimate.
- `"row"` reads the reference series directly from one CSV row, for example
  `{ method: "row", rowId: "K02000001", label: "Published UK average" }`.
  The ID must match **exactly one** row using `dataIdField`; a missing, blank or
  duplicate ID reports a configuration error, never a fallback mean.
  Supply a value under each time-column header just as for area rows.
  This reference row is excluded from map values, data-derived area lookups and
  fixed/per-selection break calculations. The publisher remains responsible
  for its statistical validity and a label that accurately describes it.
  Geography features are not removed: if the reference ID is also in the
  geography, that area remains selectable but has no mapped area values.
- `"none"` removes the reference line and its legend, and excludes it from
  chart y-axis scaling. It does not disable the separate `chart.zeroLine`.

Mean and median omit blank, non-numeric and non-finite values independently at
each time point, so the set of contributing areas can change over time.
If no valid values remain, the reference has a gap. Row mode also preserves
missing/invalid values as gaps; it never replaces them with calculated values.
Only include the intended set of comparable areas in calculated modes: no
geography/population weighting or filtering of other aggregate rows is inferred.
In range mode the line still represents raw time-point values, not the mean
or median of changes.

Set `datasets[i].chart.average` to override the whole object for one dataset
(including its method, row ID, label and colour). `chart.average` also accepts
an array of objects in dataset order. Omit `label` to use the method-specific
default; supply an appropriate label when switching to a published row.

For existing configurations without `chart.average`, `chart.showMeanLine: false`
still disables the line and `chart.meanLegend` still sets its label/colour.
Otherwise the historical unweighted mean remains the default. An explicit
`chart.average.method` takes precedence over `showMeanLine`.

## Repository structure
- `choropleth/` – single‑dataset choropleth template
- `dataset_switch_choropleth/` – choropleth with dataset switcher
- `dataset_switch_time_series_choropleth/` – time‑series + dataset switcher
- `lib-maps/` – assets shared between map templates
- `lib/` - assets shared with both the map and [chart](https://github.com/ONSdigital/Charts) templates

## Technical notes
- [`lib-maps/README-postcode-lookup.md`](lib-maps/README-postcode-lookup.md) – how postcode search works, including autocomplete, postcode-to-point lookup, and point-in-polygon / rendered-feature area matching


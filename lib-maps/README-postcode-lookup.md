# Postcode lookup flow

This note explains how postcode search currently works in `lib-maps/map-helpers.js`, including the search suggestion step and the area lookup step. It is intended as a reference for reusing the same postcode flow in another tool.

## Where the logic lives

- `detectGeographySource(url)` decides whether the map is using GeoJSON/TopoJSON or vector tiles.
- `setupSearch(areas, config, state, rateById, areaById)` wires the search UI and selection flow.
- `fetchPostcodes(query)` calls the `postcodes.io` autocomplete endpoint for suggestions.
- `pointInPolygon(point, vs)` is the fallback for non-vector geographies.

## End-to-end flow

1. The template calls `setupSearch(...)` after geography and data are loaded.
2. `setupSearch(...)` builds area-name lookups from the loaded features when full GeoJSON features are available.
3. The search box uses `accessibleAutocomplete` with a custom `searchSuggest` function.
4. If the confirmed input looks like a UK postcode, the code runs a postcode lookup against `https://api.postcodes.io/postcodes/{postcode}`.
5. The lookup returns latitude and longitude for the postcode.
6. The map resolves that point to an area in one of two ways:
   - **Vector tiles:** pan/zoom to the postcode location, then poll `queryRenderedFeatures(...)` until the area tile is available.
   - **GeoJSON/TopoJSON:** run `pointInPolygon(...)` against in-memory polygon or multipolygon features.
7. Once a feature is found, `applySelectionForFeature(...)` updates selected state, key/info panel state, and fires `state.onAreaSelected(...)` if the embedding tool needs to react.

## Search suggestions

The search input supports two modes depending on geography source:

| Geography source | Suggestions shown |
| --- | --- |
| `vector` | Postcode suggestions only |
| `geojson` / `topojson` | Area-name matches first, then postcode suggestions if no area names match |

### Suggestion endpoint

Suggestions come from:

```text
GET https://api.postcodes.io/postcodes/{query}/autocomplete
```

`fetchPostcodes(query)` returns `json.result` when present, otherwise `[]`.

### Input normalisation and validation

Before a postcode lookup runs, the input is:

- trimmed
- uppercased
- collapsed to single spaces

Validation uses:

```js
/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/
```

If the confirmed value does not match that pattern, the UI shows `Invalid postcode`.

## Converting a postcode to a point

Once a valid postcode is confirmed, `selectAreaByPostcode(...)` calls:

```text
GET https://api.postcodes.io/postcodes/{normalizedPostcode}
```

The response is expected to provide:

- `result.latitude`
- `result.longitude`

If the request fails, the status is not OK, or the response has no usable coordinates, the UI shows `Area unavailable` or `Invalid postcode` depending on the failure.

## Converting a point to an area

### Vector tile path

For vector tiles, the code cannot inspect a complete area feature collection in memory. Instead it:

1. eases the map to the postcode location
2. uses `postcodeSearchZoom` if configured, otherwise zoom `9`
3. polls every `150ms`
4. times out after `5000ms`
5. calls `map.queryRenderedFeatures(point, { layers: ['area'] })`

When the first rendered feature is found, it is treated as the selected area.

This approach depends on:

- the relevant geography being rendered in the `area` layer
- the tile having loaded at the postcode location
- `config.geoLayer` being correct for feature-state updates

### GeoJSON / TopoJSON path

For non-vector sources, the code uses the postcode coordinates directly against loaded boundary features:

- `Polygon`: test against `geometry.coordinates[0]`
- `MultiPolygon`: test each polygon outer ring with `some(...)`

`pointInPolygon(point, vs)` uses a ray-casting test and expects coordinates in `[longitude, latitude]` order.

## What happens after an area is found

`applySelectionForFeature(...)` is the common path used by postcode search, area-name search, and map clicks. It:

- clears the previous selected and hovered feature state
- stores `state.selectedAreaCode` and `state.selectedAreaName`
- sets feature-state `selected: true`
- updates the legend/key and area information
- optionally zooms to the selected feature bounds
- calls `state.onAreaSelected({ code, areaName, value, source })`

That callback is the cleanest integration point if another tool needs to react to postcode-driven selection.

## Reusing this in another tool

If another tool needs the same postcode flow without the full map template, the minimum reusable steps are:

1. Normalise and validate the postcode input.
2. Call `postcodes.io` autocomplete for suggestions.
3. Call `postcodes.io` postcode lookup to get `latitude` and `longitude`.
4. Resolve the point to a boundary:
   - use rendered-feature queries for vector tiles, or
   - use point-in-polygon against loaded GeoJSON features.
5. Emit one stable selection payload such as `{ code, areaName, source: 'postcode' }`.

## Practical extraction options

There are two sensible reuse patterns:

| Pattern | When to use it |
| --- | --- |
| Reuse `fetchPostcodes(...)`, postcode normalisation, and the vector/point-in-polygon selection flow | Another map-based tool wants the same behaviour |
| Extract postcode normalisation, validation, API calls, and selection payload creation into a small shared helper | A non-map tool wants postcode-to-area lookup without the current map UI |

## Current assumptions and coupling

The current implementation is coupled to:

- `accessibleAutocomplete`
- a map layer named `area`
- `config.geoIdField`, `config.geoNameField`, and `config.geoLayer`
- map state fields such as `selectedAreaCode`, `selectedAreaName`, and `onAreaSelected`

If you apply this to another tool, the cleanest refactor would be to keep postcode lookup and point-to-area resolution as shared logic, while leaving DOM updates and map-specific selection styling inside the host tool.

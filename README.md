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

## Repository structure
- `choropleth/` – single‑dataset choropleth template
- `dataset_switch_choropleth/` – choropleth with dataset switcher
- `dataset_switch_time_series_choropleth/` – time‑series + dataset switcher
- `lib-maps/` – assets shared between map templates
- `lib/` - assets shared with both the map and [chart](https://github.com/ONSdigital/Charts) templates

## Technical notes
- [`lib-maps/README-postcode-lookup.md`](lib-maps/README-postcode-lookup.md) – how postcode search works, including autocomplete, postcode-to-point lookup, and point-in-polygon / rendered-feature area matching

// helpers.js (example structure)

/**
 * Fetches data from a URL and detects if it is GeoJSON, TopoJSON, or general JSON.
 * It also handles the vector tile (.pbf) case.
 *
 * @param {string | null} url The URL of the geographic data source.
 * @returns {Promise<"geojson" | "topojson" | "json" | "vector" | "error: fetch failed" | "error: parse failed" | "error: invalid url">}
 */
export async function detectGeographySource(url) {
    if (!url) {
        return "error: invalid url"; 
    }
    
    if (url.endsWith('.pbf')) {
        return "vector"; // Mapbox Vector Tile format
    }

    let data;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        data = await response.json();
    } catch (e) {
        if (e.message.includes('HTTP error')) {
            console.error(`Fetch failed for ${url}:`, e.message);
            return "error: fetch failed";
        }
        console.error(`Failed to parse JSON for ${url}:`, e.message);
        return "error: parse failed";
    }

    if (typeof data !== 'object' || data === null || !data.type) {
        return "json"; // Default if not a recognized structure or simply plain JSON
    }

    if (data.type === "Topology" && Array.isArray(data.arcs)) {
        return "topojson";
    }

    const geoJsonTypes = new Set([
        "FeatureCollection", "Feature", "Point", "MultiPoint",
        "LineString", "MultiLineString", "Polygon", "MultiPolygon",
        "GeometryCollection"
    ]);

    if (geoJsonTypes.has(data.type)) {
        return "geojson";
    }

    return "json";
}


// Common "balise" (weather beacon) shape used across the whole app.
// Every data source must return an array of objects in this normalized form so
// the frontend never needs to know where the data came from.
//
//   id        {string}  unique balise id (FFVL idBalise)
//   name      {string}  human readable name
//   lat,lon   {number}  WGS84 coordinates (decimal degrees)
//   altitude  {number}  metres, may be null
//   dept      {string}  French department code, may be null
//   windAvg   {number}  average wind speed (km/h), may be null
//   windMax   {number}  gust / max wind speed (km/h), may be null
//   windDir   {number}  wind direction, degrees 0-360 (0 = N), may be null
//   temp      {number}  temperature °C, may be null
//   humidity  {number}  relative humidity %, may be null
//   updated   {string}  ISO timestamp of the measurement, may be null
//   url       {string}  link back to the balise page on balisemeteo.com

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a normalized balise. Unknown fields default to null so the frontend can
 * render partial data without crashing.
 */
function makeBalise(partial) {
  const b = {
    id: partial.id != null ? String(partial.id) : null,
    name: partial.name ?? null,
    lat: num(partial.lat),
    lon: num(partial.lon),
    altitude: num(partial.altitude),
    dept: partial.dept != null ? String(partial.dept) : null,
    windAvg: num(partial.windAvg),
    windMax: num(partial.windMax),
    windDir: num(partial.windDir),
    temp: num(partial.temp),
    humidity: num(partial.humidity),
    updated: partial.updated ?? null,
    url: partial.url ?? (partial.id != null
      ? `https://www.balisemeteo.com/balise.php?idBalise=${partial.id}`
      : null),
  };
  return b;
}

/** Keep only balises that can actually be placed on a map. */
function withCoords(balises) {
  return balises.filter((b) => b.lat != null && b.lon != null);
}

module.exports = { makeBalise, withCoords, num };

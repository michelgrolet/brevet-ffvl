// Official FFVL Open Data API source (RECOMMENDED).
//
// This is the robust, intended way to get balise data. It needs a free API key
// requested from informatique@ffvl.fr, supplied via the FFVL_API_KEY env var.
//
// Two endpoints are merged by balise id:
//   r=list          -> static info (name, lat, lon, altitude, departement)
//   r=releves_meteo -> latest measurements (wind, temperature, humidity)
//
// Field names below are matched defensively (several known spellings are tried)
// because the FFVL API has used slightly different keys over time and this
// adapter could not be run against a live key from the build environment.
const { makeBalise, withCoords, num } = require('../normalize');

const BASE = 'https://data.ffvl.fr/api/';

function endpoint(r, key) {
  return `${BASE}?base=balises&r=${r}&mode=json&key=${encodeURIComponent(key)}`;
}

// Pick the first present value among a list of candidate keys (case-sensitive).
function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return null;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'brevet-ffvl/1.0' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`FFVL API HTTP ${res.status}`);
  if (/FFVL key is disabled|api key|clé api/i.test(text) && text.trim()[0] !== '[' && text.trim()[0] !== '{') {
    throw new Error('FFVL API rejected the key (request/enable one at informatique@ffvl.fr)');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('FFVL API did not return JSON (likely an invalid/disabled key)');
  }
}

async function fetchBalises() {
  const key = process.env.FFVL_API_KEY;
  if (!key) throw new Error('FFVL_API_KEY is not set');

  const [list, releves] = await Promise.all([
    getJson(endpoint('list', key)),
    getJson(endpoint('releves_meteo', key)),
  ]);

  // Index latest measurement by balise id.
  const measByID = new Map();
  for (const m of toArray(releves)) {
    const id = String(pick(m, ['idBalise', 'idbalise', 'id']));
    measByID.set(id, m);
  }

  const balises = toArray(list).map((s) => {
    const id = String(pick(s, ['idBalise', 'idbalise', 'id']));
    const m = measByID.get(id) || {};
    return makeBalise({
      id,
      name: pick(s, ['nom', 'name']),
      lat: pick(s, ['latitude', 'lat']),
      lon: pick(s, ['longitude', 'lon', 'lng']),
      altitude: pick(s, ['altitude', 'alt']),
      dept: pick(s, ['departement', 'dept']),
      windAvg: num(pick(m, ['vitesseVentMoyen', 'vitesseVentMoy', 'vitessevent'])),
      windMax: num(pick(m, ['vitesseVentMax', 'vitesseVentMaxi', 'vitesseventmax'])),
      windDir: num(pick(m, ['directVentMoyen', 'directVent', 'directventmoyen'])),
      temp: num(pick(m, ['temperature', 'temp'])),
      humidity: num(pick(m, ['hygrometrie', 'humidite', 'humidity'])),
      updated: pick(m, ['date', 'lastReleve', 'datetime']),
    });
  });

  return withCoords(balises);
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v);
  return [];
}

module.exports = { fetchBalises };

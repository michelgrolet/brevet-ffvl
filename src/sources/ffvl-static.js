// Static FFVL balise source: the full network's positions (166 balises),
// vendored in data/ffvl-balises.json so the map shows every station with no
// API key and no build-time network call.
//
// This is POSITIONS ONLY — there is no live wind/temperature here. For live
// measurements, set FFVL_API_KEY and use the `ffvl` source instead (it returns
// the same stations plus their latest readings).
//
// The coordinates were derived from the public FFVL balise list (source: FFVL,
// reusable with attribution). Locations are stable, but this snapshot will not
// include balises added/removed after it was captured.
const fs = require('fs');
const path = require('path');
const { makeBalise, withCoords } = require('../normalize');

const DATA = path.join(__dirname, '..', '..', 'data', 'ffvl-balises.json');

async function fetchBalises() {
  const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  // No live measurements in the static list; makeBalise leaves wind/temp null.
  return withCoords(raw.map(makeBalise));
}

module.exports = { fetchBalises };

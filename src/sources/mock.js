// Mock data source: reads the bundled sample dataset.
// Lets the whole app run offline with zero config (no API key, no network).
const fs = require('fs');
const path = require('path');
const { makeBalise, withCoords } = require('../normalize');

const SAMPLE = path.join(__dirname, '..', '..', 'data', 'sample-balises.json');

async function fetchBalises() {
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  return withCoords(raw.map(makeBalise));
}

module.exports = { fetchBalises };

// balisemeteo.com HTML scraper source (FALLBACK — fragile by nature).
//
// ⚠️  IMPORTANT: The selectors/patterns below could NOT be validated against the
//     live site from the build environment, because balisemeteo.com returns HTTP
//     503 to datacenter traffic (it blocks non-browser egress). Run this once
//     from a machine/IP that can load the site and adjust the PATTERNS block if
//     extraction returns nulls. Everything is isolated here on purpose.
//
// Strategy:
//   1. Load an index page and extract (id, name, lat, lon) for every balise.
//      balisemeteo's map injects markers via JS, so we scan for coordinate
//      tuples tied to a balise id.
//   2. For each balise, load its page and regex out the latest wind/temp values
//      by their French labels.
//
// Because the official FFVL API exists and is the supported path, prefer
// DATA_SOURCE=ffvl with a free key whenever possible.
const { makeBalise, withCoords, num } = require('../normalize');

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Tunable extraction patterns — adjust to match the live HTML if needed.
const PATTERNS = {
  // Index page listing all balises with their coordinates. Override via env.
  indexUrl: process.env.SCRAPE_INDEX_URL || 'https://www.balisemeteo.com/',
  // Matches a marker definition like: balise(83,'Saint-Hilaire',45.30,5.88)
  // or a JSON-ish {"idBalise":83,...,"latitude":45.30,"longitude":5.88,...}.
  marker:
    /idBalise"?\s*[:=]\s*"?(\d+)"?[^}]*?(?:nom|name)"?\s*[:=]\s*"([^"]+)"[^}]*?(?:latitude|lat)"?\s*[:=]\s*"?(-?\d+[.,]\d+)"?[^}]*?(?:longitude|lon|lng)"?\s*[:=]\s*"?(-?\d+[.,]\d+)"?/gi,
  balisePage: (id) => `https://www.balisemeteo.com/balise.php?idBalise=${id}`,
  // Per-balise field patterns (label -> value). French labels.
  windAvg: /vent\s*moyen[^0-9-]*(-?\d+[.,]?\d*)/i,
  windMax: /(?:rafale|vent\s*max)[^0-9-]*(-?\d+[.,]?\d*)/i,
  windDir: /direction[^0-9-]*(-?\d+[.,]?\d*)/i,
  temp: /temp[ée]rature[^0-9-]*(-?\d+[.,]?\d*)/i,
  humidity: /(?:hygrom[ée]trie|humidit[ée])[^0-9-]*(-?\d+[.,]?\d*)/i,
};

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`balisemeteo.com HTTP ${res.status} for ${url}`);
  return res.text();
}

function match1(html, re) {
  const m = html.match(re);
  return m ? num(m[1]) : null;
}

async function scrapeIndex() {
  const html = await getText(PATTERNS.indexUrl);
  const found = new Map();
  let m;
  while ((m = PATTERNS.marker.exec(html)) !== null) {
    const [, id, name, lat, lon] = m;
    if (!found.has(id)) found.set(id, { id, name, lat, lon });
  }
  return [...found.values()];
}

async function scrapeBalise(stub) {
  try {
    const html = await getText(PATTERNS.balisePage(stub.id));
    return makeBalise({
      ...stub,
      windAvg: match1(html, PATTERNS.windAvg),
      windMax: match1(html, PATTERNS.windMax),
      windDir: match1(html, PATTERNS.windDir),
      temp: match1(html, PATTERNS.temp),
      humidity: match1(html, PATTERNS.humidity),
      updated: new Date().toISOString(),
    });
  } catch {
    // Keep the balise on the map even if its live values failed to load.
    return makeBalise(stub);
  }
}

// Limit concurrency so we don't hammer the site.
async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchBalises() {
  const stubs = await scrapeIndex();
  if (stubs.length === 0) {
    throw new Error(
      'Scraper found 0 balises — the index marker pattern needs adjusting ' +
        'to the live balisemeteo.com HTML (see PATTERNS in this file).'
    );
  }
  const balises = await mapLimit(stubs, 6, scrapeBalise);
  return withCoords(balises);
}

module.exports = { fetchBalises, PATTERNS };

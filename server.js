// Zero-dependency Node server: hosts the static Leaflet frontend and exposes a
// single cached /api/balises endpoint. The data source is pluggable so the
// frontend never deals with API keys, CORS or scraping.
//
// Config (env):
//   PORT           default 3000
//   DATA_SOURCE    mock | ffvl | scrape        (default: mock)
//   FFVL_API_KEY   required when DATA_SOURCE=ffvl
//   CACHE_TTL_MS   how long to cache upstream data (default 60000)
const http = require('http');
const fs = require('fs');
const path = require('path');

const liveStore = require('./src/live/store');
const livetrack = require('./src/live/livetrack24');

const PORT = Number(process.env.PORT) || 3000;
const DATA_SOURCE = (process.env.DATA_SOURCE || 'static').toLowerCase();
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 60_000;

const SOURCES = {
  mock: () => require('./src/sources/mock'),
  static: () => require('./src/sources/ffvl-static'),
  ffvl: () => require('./src/sources/ffvl-api'),
  scrape: () => require('./src/sources/balisemeteo-scrape'),
};

if (!SOURCES[DATA_SOURCE]) {
  console.error(`Unknown DATA_SOURCE="${DATA_SOURCE}". Use: mock | static | ffvl | scrape`);
  process.exit(1);
}
const source = SOURCES[DATA_SOURCE]();

// --- tiny in-memory cache so we never hammer upstream on every page load ---
let cache = { at: 0, data: null, error: null };

async function getBalises() {
  const fresh = Date.now() - cache.at < CACHE_TTL_MS;
  if (fresh && cache.data) return cache.data;
  try {
    const data = await source.fetchBalises();
    cache = { at: Date.now(), data, error: null };
    return data;
  } catch (err) {
    // Serve stale data if we have any; otherwise surface the error.
    if (cache.data) {
      cache.error = err.message;
      return cache.data;
    }
    throw err;
  }
}

// --- static file serving ---
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  // Prevent path traversal outside public/.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// Build the JSON the /live page polls. Points are compact arrays to keep long
// flights small: [lat, lon, alt, sog, cog, t].
function liveResponse(flightId) {
  if (flightId) {
    const f = liveStore.get(flightId);
    if (!f) return { flight: null };
    return {
      flight: {
        id: f.id, pilot: f.pilot,
        startedAt: f.startedAt, endedAt: f.endedAt, lastSeen: f.lastSeen,
        live: liveStore.isLive(f),
        points: f.points.map((p) => [p.lat, p.lon, p.alt, p.sog, p.cog, p.t]),
      },
    };
  }
  const active = liveStore.activeFlights().map((f) => {
    const last = f.points[f.points.length - 1] || null;
    return {
      id: f.id, pilot: f.pilot, startedAt: f.startedAt, lastSeen: f.lastSeen,
      pointCount: f.points.length,
      last: last ? { lat: last.lat, lon: last.lon, alt: last.alt, sog: last.sog, t: last.t } : null,
    };
  });
  return { now: Date.now(), active };
}

const server = http.createServer(async (req, res) => {
  // Live-tracking ingest from XCTrack (LiveTrack24 protocol). Derive the public
  // base URL from the first request if it wasn't configured, so notification
  // links work out of the box.
  if (!process.env.PUBLIC_BASE_URL && req.headers.host) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    livetrack.setPublicBaseUrl(`${proto}://${req.headers.host}`);
  }
  if (req.url.startsWith('/track.php') || req.url.startsWith('/client.php')) {
    if (livetrack.handle(req, res)) return;
  }

  if (req.url.startsWith('/api/live')) {
    const flightId = new URL(req.url, 'http://x').searchParams.get('flight');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(liveResponse(flightId)));
    return;
  }

  // Pretty path for the live page.
  if (req.url === '/live' || req.url.split('?')[0] === '/live') {
    req.url = '/live.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  }

  if (req.url.startsWith('/api/balises')) {
    try {
      const balises = await getBalises();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({
        source: DATA_SOURCE,
        count: balises.length,
        cachedAt: new Date(cache.at).toISOString(),
        warning: cache.error,
        balises,
      }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message, source: DATA_SOURCE }));
    }
    return;
  }
  serveStatic(req, res);
});

livetrack.startLandingSweep();

server.listen(PORT, () => {
  console.log(`brevet-ffvl running on http://localhost:${PORT}  (DATA_SOURCE=${DATA_SOURCE})`);
  console.log(`  live tracking ingest: POST/GET /track.php  ·  public page: /live`);
});

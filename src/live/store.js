// In-memory store of live-tracking flights received from XCTrack (or any other
// LiveTrack24-compatible instrument). Optionally persisted to a JSON file so a
// server restart mid-flight doesn't lose the track. Zero dependencies.
//
// A "flight" is one tracking session:
//   id              {string}  LiveTrack24 session id (as sent by the client)
//   pilot           {string}  display name (glider name, or PILOT_NAME)
//   startedAt       {number}  ms epoch — when tracking started
//   endedAt         {number}  ms epoch — when the client sent end-of-track, or null
//   lastSeen        {number}  ms epoch — last packet of any kind
//   tookoffNotified {boolean} did we already send the "took off" notification?
//   landedNotified  {boolean} did we already send the "landed" notification?
//   points          {array}   [{ lat, lon, alt, sog, cog, t }]  (t = ms epoch)

const fs = require('fs');
const path = require('path');

// Keep memory + disk bounded: cap points per flight and number of stored flights.
const MAX_POINTS = 20_000;       // ~4 days at 1 point / 15 s
const MAX_FLIGHTS = 50;          // keep the most recent flights only
const PERSIST_PATH = process.env.LIVE_STORE_PATH
  || path.join(__dirname, '..', '..', 'data', 'live-sessions.json');

/** @type {Map<string, object>} */
const flights = new Map();

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(PERSIST_PATH, 'utf8'));
    for (const f of raw.flights || []) flights.set(f.id, f);
  } catch {
    // No persisted state yet — start empty.
  }
}

let saveTimer = null;
function scheduleSave() {
  // Debounce disk writes so a burst of points doesn't hammer the filesystem.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(PERSIST_PATH), { recursive: true });
      fs.writeFileSync(PERSIST_PATH, JSON.stringify({ flights: [...flights.values()] }));
    } catch (err) {
      console.error('live store: could not persist:', err.message);
    }
  }, 2000);
  if (saveTimer.unref) saveTimer.unref();
}

function prune() {
  if (flights.size <= MAX_FLIGHTS) return;
  // Drop the oldest flights by start time.
  const ordered = [...flights.values()].sort((a, b) => a.startedAt - b.startedAt);
  for (const f of ordered.slice(0, flights.size - MAX_FLIGHTS)) flights.delete(f.id);
}

/** Start (or re-open) a tracking session. */
function startFlight(id, pilot) {
  let f = flights.get(id);
  if (!f) {
    f = {
      id,
      pilot: pilot || 'Pilot',
      startedAt: Date.now(),
      endedAt: null,
      lastSeen: Date.now(),
      tookoffNotified: false,
      landedNotified: false,
      points: [],
    };
    flights.set(id, f);
  } else {
    // Client restarted tracking under the same id — reopen it.
    f.endedAt = null;
    f.landedNotified = false;
    if (pilot) f.pilot = pilot;
    f.lastSeen = Date.now();
  }
  prune();
  scheduleSave();
  return f;
}

/** Append a GPS fix. Returns the flight, or null if the session is unknown. */
function addPoint(id, point) {
  let f = flights.get(id);
  if (!f) {
    // Some clients send points without an explicit start — create lazily.
    f = startFlight(id, point.pilot);
  }
  const p = {
    lat: point.lat,
    lon: point.lon,
    alt: point.alt ?? null,
    sog: point.sog ?? null,   // ground speed, km/h
    cog: point.cog ?? null,   // course over ground, deg
    t: point.t ?? Date.now(),
  };
  f.points.push(p);
  if (f.points.length > MAX_POINTS) f.points.splice(0, f.points.length - MAX_POINTS);
  f.lastSeen = Date.now();
  f.endedAt = null;
  scheduleSave();
  return f;
}

/** Mark a session as ended (client sent end-of-track). */
function endFlight(id) {
  const f = flights.get(id);
  if (!f) return null;
  f.endedAt = Date.now();
  f.lastSeen = Date.now();
  scheduleSave();
  return f;
}

const get = (id) => flights.get(id) || null;
const all = () => [...flights.values()];

/**
 * A flight is "live" if it hasn't ended and we've heard from it recently.
 * staleMs defaults to 10 min.
 */
function isLive(f, staleMs = 10 * 60_000) {
  return !f.endedAt && Date.now() - f.lastSeen < staleMs;
}

function activeFlights(staleMs) {
  return all()
    .filter((f) => isLive(f, staleMs))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

load();

module.exports = {
  startFlight, addPoint, endFlight, endFlightObj: endFlight,
  get, all, isLive, activeFlights, scheduleSave,
};

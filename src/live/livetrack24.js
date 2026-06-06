// LiveTrack24 protocol receiver.
//
// XCTrack (and XCSoar, LK8000, etc.) can push live tracking to any
// LiveTrack24-compatible server. Point XCTrack's livetracking server at this
// app and it will call:
//
//   GET /client.php?op=login&user=..&pass=..   -> returns a numeric user id
//   GET /track.php?leolive=2&sid=..&vname=..    -> start of track  (returns sid)
//   GET /track.php?leolive=4&sid=..&lat=..&lon=..&alt=..&sog=..&cog=..&tm=..
//                                               -> a GPS fix       (returns "OK")
//   GET /track.php?leolive=3&sid=..             -> end of track    (returns "OK")
//
// We turn that stream into flights in the store and fire takeoff / landing
// notifications. No auth: any client is accepted (it's your own server).

const url = require('url');
const store = require('./store');
const notify = require('./notify');

const PILOT_NAME = process.env.PILOT_NAME || '';
const TAKEOFF_SPEED_KMH = Number(process.env.TAKEOFF_SPEED_KMH) || 8;
const NOTIFY_ON_START = /^(1|true|yes)$/i.test(process.env.NOTIFY_ON_START || '');
const LANDING_TIMEOUT_MS = (Number(process.env.LANDING_TIMEOUT_MIN) || 5) * 60_000;

let publicBaseUrl = process.env.PUBLIC_BASE_URL || '';

function liveLink(flight) {
  const base = publicBaseUrl.replace(/\/$/, '');
  return `${base}/live?flight=${encodeURIComponent(flight.id)}`;
}

// Horizontal distance between two fixes, metres (haversine).
function distM(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Decide whether this fix means the pilot is actually airborne (not just
// standing on launch with the app running).
function looksAirborne(flight, point) {
  if (NOTIFY_ON_START) return true;
  if (point.sog != null && point.sog >= TAKEOFF_SPEED_KMH) return true;
  const first = flight.points[0];
  if (first && distM(first, point) > 80) return true;     // moved >80 m
  if (first && point.alt != null && first.alt != null
      && point.alt - first.alt > 30) return true;          // climbed >30 m
  return false;
}

function maybeNotifyTakeoff(flight, point) {
  if (flight.tookoffNotified) return;
  if (!looksAirborne(flight, point)) return;
  flight.tookoffNotified = true;
  store.scheduleSave();
  notify.notifyTakeoff(flight, liveLink(flight))
    .catch((e) => console.error('notify takeoff:', e.message));
}

function notifyLanding(flight) {
  if (!flight.tookoffNotified || flight.landedNotified) return;
  flight.landedNotified = true;
  store.scheduleSave();
  notify.notifyLanding(flight, liveLink(flight))
    .catch((e) => console.error('notify landing:', e.message));
}

function text(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

// Returns true if it handled the request.
function handle(req, res) {
  const u = url.parse(req.url, true);
  const q = u.query;

  if (u.pathname === '/client.php') {
    // Login handshake. Return a non-zero user id to signal "ok".
    text(res, 200, '1\n');
    return true;
  }

  if (u.pathname !== '/track.php') return false;

  const leolive = String(q.leolive || '');
  const sid = String(q.sid || q.SID || '').trim() || `xc-${Date.now()}`;
  const pilot = (q.vname || q.VNAME || '').toString().trim() || PILOT_NAME || 'Pilote';

  if (leolive === '2') {
    store.startFlight(sid, pilot);
    if (NOTIFY_ON_START) {
      const f = store.get(sid);
      if (f) maybeNotifyTakeoff(f, { sog: null, alt: null });
    }
    text(res, 200, `${sid}\n`);   // LiveTrack24 expects the session id back
    return true;
  }

  if (leolive === '4') {
    const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const tmSec = parseFloat(q.tm);
      const point = {
        lat, lon,
        alt: q.alt != null ? parseFloat(q.alt) : null,
        sog: q.sog != null ? parseFloat(q.sog) : null,
        cog: q.cog != null ? parseFloat(q.cog) : null,
        t: Number.isFinite(tmSec) ? tmSec * 1000 : Date.now(),
        pilot,
      };
      const f = store.addPoint(sid, point);
      maybeNotifyTakeoff(f, point);
    }
    text(res, 200, 'OK\n');
    return true;
  }

  if (leolive === '3') {
    const f = store.endFlight(sid);
    if (f) notifyLanding(f);
    text(res, 200, 'OK\n');
    return true;
  }

  // Unknown packet type — acknowledge so the client keeps going.
  text(res, 200, 'OK\n');
  return true;
}

// Background sweep: a flight that took off, went quiet, and never sent an
// explicit end-of-track is treated as landed after LANDING_TIMEOUT_MS.
function startLandingSweep() {
  const timer = setInterval(() => {
    for (const f of store.all()) {
      if (f.tookoffNotified && !f.landedNotified && !f.endedAt
          && Date.now() - f.lastSeen > LANDING_TIMEOUT_MS) {
        f.endedAt = f.lastSeen;
        notifyLanding(f);
      }
    }
  }, 60_000);
  if (timer.unref) timer.unref();
  return timer;
}

function setPublicBaseUrl(v) { if (v) publicBaseUrl = v; }

module.exports = { handle, startLandingSweep, setPublicBaseUrl, liveLink };

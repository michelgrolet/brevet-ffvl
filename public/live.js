// Public, no-login live-flight viewer. Polls /api/live and draws the track.
'use strict';

const POLL_MS = 12_000;
const params = new URLSearchParams(location.search);
let flightId = params.get('flight');

const map = L.map('map', { zoomControl: true }).setView([46.2, 2.4], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '© OpenStreetMap',
}).addTo(map);

const track = L.polyline([], { color: '#c0392b', weight: 4, opacity: .85 }).addTo(map);
let marker = null;
let firstFit = true;

const el = (id) => document.getElementById(id);
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toFixed(d));

function gliderIcon() {
  return L.divIcon({
    className: 'glider-icon',
    html: '<div style="font-size:26px;line-height:26px">🪂</div>',
    iconSize: [26, 26], iconAnchor: [13, 13],
  });
}

function durationStr(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function ageStr(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `il y a ${s} s`;
  return `il y a ${Math.round(s / 60)} min`;
}

function setStatus(text) { el('status').textContent = text; }
function setLive(on) {
  const dot = el('live-dot');
  dot.className = on ? 'on' : 'off';
}

function showEmpty(msg) {
  el('empty').classList.remove('hidden');
  el('panel').classList.add('hidden');
  if (msg) el('empty-msg').textContent = msg;
  setLive(false);
}
function hideEmpty() { el('empty').classList.add('hidden'); el('panel').classList.remove('hidden'); }

async function getJSON(u) {
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Without a flight id, find the most recently active flight.
async function discover() {
  try {
    const { active } = await getJSON('/api/live');
    if (active && active.length) {
      flightId = active[0].id;
      const u = new URL(location.href);
      u.searchParams.set('flight', flightId);
      history.replaceState(null, '', u);
      return true;
    }
  } catch (e) { setStatus('hors ligne'); }
  return false;
}

function render(flight) {
  const pts = flight.points || [];
  const latlngs = pts.map((p) => [p[0], p[1]]);
  track.setLatLngs(latlngs);

  const last = pts[pts.length - 1];
  if (last) {
    const ll = [last[0], last[1]];
    if (!marker) marker = L.marker(ll, { icon: gliderIcon() }).addTo(map);
    else marker.setLatLng(ll);

    if (firstFit && latlngs.length) {
      if (latlngs.length > 1) map.fitBounds(track.getBounds().pad(0.2));
      else map.setView(ll, 13);
      firstFit = false;
    } else {
      map.panTo(ll, { animate: true });
    }
  }

  el('title').textContent = `${flight.pilot} — vol en direct`;
  document.title = `${flight.pilot} 🪂 en direct`;
  el('p-pilot').textContent = flight.pilot;
  el('p-alt').textContent = last && last[2] != null ? `${fmt(last[2])} m` : '—';
  el('p-spd').textContent = last && last[3] != null ? `${fmt(last[3])} km/h` : '—';
  el('p-dur').textContent = durationStr(flight.lastSeen - flight.startedAt);
  el('p-age').textContent = last ? ageStr(Date.now() - last[5]) : '—';

  setLive(flight.live);
  if (flight.live) setStatus('en vol');
  else if (flight.endedAt) setStatus('atterri');
  else setStatus('en attente de signal…');
}

async function tick() {
  if (!flightId) {
    const found = await discover();
    if (!found) { showEmpty('Aucun vol en cours pour le moment.'); return; }
  }
  try {
    const { flight } = await getJSON('/api/live?flight=' + encodeURIComponent(flightId));
    if (!flight) { showEmpty('Vol introuvable.'); return; }
    hideEmpty();
    render(flight);
  } catch (e) {
    setStatus('reconnexion…');
  }
}

tick();
setInterval(tick, POLL_MS);

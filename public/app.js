/* Leaflet map of FFVL weather beacons (balises).
 * Each balise is a pin placed at its exact coordinates; clicking it opens the
 * official balisemeteo.com page in a new tab. A "locate me" button centres the
 * map on the user so they can click the balises around them. No live data is
 * fetched — the official page shows the wind. */

const map = L.map('map', { zoomControl: true }).setView([46.6, 2.4], 6); // France
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · balises &copy; <a href="https://www.balisemeteo.com">FFVL</a>',
}).addTo(map);

const layer = L.layerGroup().addTo(map);
const statusEl = document.getElementById('status');

// Teardrop pin whose POINT (bottom tip) sits exactly on the coordinate.
const PIN_SVG =
  '<svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M13 35C13 35 24 21.5 24 13A11 11 0 1 0 2 13C2 21.5 13 35 13 35Z" ' +
  'fill="#c0392b" stroke="#fff" stroke-width="2"/>' +
  '<circle cx="13" cy="13" r="4.2" fill="#fff"/></svg>';

const baliseIcon = L.divIcon({
  html: PIN_SVG,
  className: 'balise-pin',
  iconSize: [26, 36],
  iconAnchor: [13, 35],   // tip of the teardrop
  tooltipAnchor: [0, -30],
});

function officialUrl(b) {
  return b.url || `https://www.balisemeteo.com/balise.php?idBalise=${b.id}`;
}

function render(balises) {
  layer.clearLayers();
  for (const b of balises) {
    if (b.lat == null || b.lon == null) continue;
    const label =
      `${b.name || 'Balise ' + b.id}` + (b.altitude != null ? ` · ${b.altitude} m` : '');
    L.marker([b.lat, b.lon], { icon: baliseIcon, title: b.name || `Balise ${b.id}` })
      .bindTooltip(label, { direction: 'top' })
      .on('click', () => window.open(officialUrl(b), '_blank', 'noopener'))
      .addTo(layer);
  }
}

// On a static host (GitHub Pages) there is no backend; read the generated file.
async function fetchData() {
  try {
    const res = await fetch('/api/balises', { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch { /* no backend — fall through */ }
  const res = await fetch('./balises.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('aucune donnée de balises disponible');
  return await res.json();
}

async function load() {
  statusEl.textContent = 'chargement…';
  try {
    const data = await fetchData();
    if (data.error) throw new Error(data.error);
    render(data.balises);
    statusEl.textContent = `${data.count} balises`;
  } catch (err) {
    statusEl.textContent = `erreur : ${err.message}`;
  }
}

// --- Geolocation -----------------------------------------------------------
let meLayer = null;
const meStyle = { radius: 8, color: '#fff', weight: 2, fillColor: '#1e6fff', fillOpacity: 1 };

document.getElementById('locate').addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    statusEl.textContent = 'géolocalisation non disponible sur cet appareil';
    return;
  }
  statusEl.textContent = 'localisation…';
  map.locate({ setView: true, maxZoom: 12, enableHighAccuracy: true, timeout: 10000 });
});

map.on('locationfound', (e) => {
  if (meLayer) meLayer.remove();
  meLayer = L.layerGroup([
    L.circle(e.latlng, { radius: e.accuracy, color: '#1e6fff', weight: 1, fillOpacity: 0.08 }),
    L.circleMarker(e.latlng, meStyle).bindTooltip('Vous êtes ici', { direction: 'top' }),
  ]).addTo(map);
  statusEl.textContent = `${layer.getLayers().length} balises · position trouvée`;
});

map.on('locationerror', (e) => {
  statusEl.textContent = `localisation impossible : ${e.message}`;
});

load();

/* Leaflet frontend for the FFVL balise map.
 * Pulls normalized balise data from our own /api/balises endpoint and renders
 * each balise as a wind arrow coloured by wind strength. Auto-refreshes. */

const REFRESH_MS = 60_000;

const map = L.map('map', { zoomControl: true }).setView([46.2, 2.4], 6); // France
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · données balises &copy; <a href="https://www.balisemeteo.com">FFVL</a>',
}).addTo(map);

const layer = L.layerGroup().addTo(map);

function windColor(kmh) {
  if (kmh == null) return '#888';
  if (kmh < 10) return '#3b8a3b';
  if (kmh < 20) return '#c9a227';
  if (kmh < 35) return '#d2691e';
  return '#c0392b';
}

// An arrow icon rotated to the wind direction. windDir = where wind comes FROM,
// so the arrow (which we draw pointing "up"=North) is rotated by windDir degrees.
function windIcon(b) {
  const color = windColor(b.windAvg);
  const hasDir = b.windDir != null && b.windAvg != null && b.windAvg > 0;
  const rot = hasDir ? b.windDir : 0;
  const shape = hasDir
    ? `<path d="M12 2 L17 13 L12 10.5 L7 13 Z" fill="${color}"/>`   // arrow
    : `<circle cx="12" cy="12" r="5" fill="${color}"/>`;            // calm: dot
  const html =
    `<div class="balise-marker" style="transform:rotate(${rot}deg)">` +
    `<svg width="24" height="24" viewBox="0 0 24 24">${shape}</svg></div>`;
  return L.divIcon({ html, className: '', iconSize: [24, 24], iconAnchor: [12, 12] });
}

function row(label, val, unit) {
  if (val == null) return '';
  return `<b>${label}</b><span>${val}${unit || ''}</span>`;
}

function popupHtml(b) {
  const when = b.updated ? new Date(b.updated).toLocaleString('fr-FR') : '—';
  return (
    `<div class="popup-name">${b.name || 'Balise ' + b.id}</div>` +
    `<div class="popup-grid">` +
      row('Vent moyen', b.windAvg, ' km/h') +
      row('Rafales', b.windMax, ' km/h') +
      row('Direction', b.windDir, '°') +
      row('Température', b.temp, ' °C') +
      row('Humidité', b.humidity, ' %') +
      row('Altitude', b.altitude, ' m') +
    `</div>` +
    `<div class="popup-meta">Mesuré : ${when}` +
      (b.url ? ` · <a href="${b.url}" target="_blank" rel="noopener">détails</a>` : '') +
    `</div>`
  );
}

function render(balises) {
  layer.clearLayers();
  for (const b of balises) {
    L.marker([b.lat, b.lon], { icon: windIcon(b) })
      .bindPopup(popupHtml(b))
      .bindTooltip(b.name || `Balise ${b.id}`, { direction: 'top' })
      .addTo(layer);
  }
}

const statusEl = document.getElementById('status');

// Try the live server endpoint first; on a static host (e.g. GitHub Pages there
// is no backend) fall back to a pre-generated balises.json next to index.html.
async function fetchData() {
  try {
    const res = await fetch('/api/balises', { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch { /* no backend — fall through to the static snapshot */ }
  const res = await fetch('./balises.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('aucune source de données disponible');
  return await res.json();
}

async function load() {
  statusEl.textContent = 'chargement…';
  try {
    const data = await fetchData();
    if (data.error) throw new Error(data.error);
    render(data.balises);
    const t = new Date().toLocaleTimeString('fr-FR');
    statusEl.textContent =
      `${data.count} balises · source: ${data.source} · maj ${t}` +
      (data.warning ? ` · ⚠ ${data.warning}` : '');
  } catch (err) {
    statusEl.textContent = `erreur : ${err.message}`;
  }
}

document.getElementById('refresh').addEventListener('click', load);
load();
setInterval(load, REFRESH_MS);

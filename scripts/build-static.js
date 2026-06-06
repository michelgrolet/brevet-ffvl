// Builds the combined static site for GitHub Pages into ./_site:
//   - the QCM FFVL question browser at the root (qcm-site/)
//   - the balise weather map under /balise/ (public/ frontend), with a
//     pre-generated balises.json using the configured DATA_SOURCE
//     (falls back to bundled sample data if the live source fails)
//
// On Pages there is no Node backend, so the balise app.js reads balises.json
// directly (it falls back to ./balises.json next to its index.html).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const BALISE_OUT = path.join(OUT, 'balise');
const SOURCE = (process.env.DATA_SOURCE || 'mock').toLowerCase();
const MODULES = { mock: 'mock', static: 'ffvl-static', ffvl: 'ffvl-api', scrape: 'balisemeteo-scrape' };

// Recursively copy a directory's contents into dest.
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // 1. QCM site at the root. Only the web assets (skip README / scripts).
  //    Each HTML page references its JS/CSS with a content-hash query so
  //    browsers fetch the new version as soon as a file changes (GitHub Pages
  //    caches assets for 10 min, which otherwise serves stale JS after deploy).
  const qcmSrc = path.join(ROOT, 'qcm-site');
  const shortHash = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
  // Emit an HTML page, copying its referenced assets and appending ?v=<hash>.
  const emitPage = (htmlName, assets) => {
    let html = fs.readFileSync(path.join(qcmSrc, htmlName), 'utf8');
    for (const asset of assets) {
      const buf = fs.readFileSync(path.join(qcmSrc, asset));
      fs.writeFileSync(path.join(OUT, asset), buf);
      html = html.split(`./${asset}`).join(`./${asset}?v=${shortHash(buf)}`);
    }
    fs.writeFileSync(path.join(OUT, htmlName), html);
  };
  emitPage('index.html', ['style.css', 'app.js']);
  emitPage('revise.html', ['style.css', 'revise.css', 'revise.js']);
  copyDir(path.join(qcmSrc, 'data'), path.join(OUT, 'data'));

  // 2. Balise map under /balise/. The frontend uses relative asset paths and
  //    falls back to ./balises.json, so it works unchanged from a subpath.
  fs.mkdirSync(BALISE_OUT, { recursive: true });
  const pub = path.join(ROOT, 'public');
  for (const f of fs.readdirSync(pub)) {
    fs.copyFileSync(path.join(pub, f), path.join(BALISE_OUT, f));
  }

  // Generate the balise data snapshot.
  let balises = [];
  let warning = null;
  let source = SOURCE;
  try {
    const mod = require(`../src/sources/${MODULES[SOURCE] || 'mock'}`);
    balises = await mod.fetchBalises();
  } catch (err) {
    warning = `${SOURCE} source failed (${err.message}); using sample data`;
    source = 'mock';
    balises = await require('../src/sources/mock').fetchBalises();
  }

  // The static list has positions but no live wind — make that explicit in the UI.
  if (source === 'static' && !warning) {
    warning = 'positions seules — définir FFVL_API_KEY pour le vent en temps réel';
  }

  fs.writeFileSync(
    path.join(BALISE_OUT, 'balises.json'),
    JSON.stringify({
      source,
      count: balises.length,
      generatedAt: new Date().toISOString(),
      warning,
      balises,
    })
  );

  console.log(
    `Built _site: QCM at /, balise map at /balise/ (${balises.length} balises, source=${source}${warning ? ', ' + warning : ''})`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

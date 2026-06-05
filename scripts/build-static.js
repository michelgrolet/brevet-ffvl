// Builds the static site for GitHub Pages into ./_site:
//   - copies the public/ frontend
//   - pre-generates balises.json using the configured DATA_SOURCE
//     (falls back to bundled sample data if the live source fails)
//
// On Pages there is no Node backend, so app.js reads this balises.json directly.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const SOURCE = (process.env.DATA_SOURCE || 'mock').toLowerCase();
const MODULES = { mock: 'mock', ffvl: 'ffvl-api', scrape: 'balisemeteo-scrape' };

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // Copy the flat public/ frontend.
  const pub = path.join(ROOT, 'public');
  for (const f of fs.readdirSync(pub)) {
    fs.copyFileSync(path.join(pub, f), path.join(OUT, f));
  }

  // Generate the data snapshot.
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

  fs.writeFileSync(
    path.join(OUT, 'balises.json'),
    JSON.stringify({
      source,
      count: balises.length,
      generatedAt: new Date().toISOString(),
      warning,
      balises,
    })
  );

  console.log(`Built _site with ${balises.length} balises (source=${source}${warning ? ', ' + warning : ''})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

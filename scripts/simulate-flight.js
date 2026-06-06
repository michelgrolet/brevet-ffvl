// Pretend to be XCTrack: push a short fake flight to the live receiver using the
// LiveTrack24 protocol, so you can test /live and the notifications without a
// phone. Run the server first (node server.js), then:
//
//   node scripts/simulate-flight.js
//   BASE=http://localhost:3000 PILOT="Michel" POINTS=40 node scripts/simulate-flight.js
//
// It sends a start packet, a stream of GPS fixes that drift across the sky
// (ground speed above the takeoff threshold so the "took off" notification
// fires), then an end packet.

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const PILOT = process.env.PILOT || 'Michel (test)';
const POINTS = Number(process.env.POINTS) || 30;
const STEP_MS = Number(process.env.STEP_MS) || 800;   // delay between fixes
const sid = process.env.SID || String(Math.floor(Math.random() * 1e8));

const get = async (qs) => {
  const r = await fetch(`${BASE}/track.php?${qs}`);
  return r.text();
};

(async () => {
  console.log(`Simulating flight ${sid} for "${PILOT}" -> ${BASE}`);
  await get(`leolive=2&sid=${sid}&pid=0&vname=${encodeURIComponent(PILOT)}&vtype=8`);
  console.log('  start sent. Open', `${BASE}/live?flight=${sid}`);

  let lat = 45.90, lon = 6.12, alt = 1400;   // launch near Chamonix-ish
  for (let i = 1; i <= POINTS; i++) {
    lat += 0.0015 + Math.random() * 0.0008;
    lon += 0.0010 + Math.random() * 0.0006;
    alt += Math.round((Math.random() - 0.45) * 40);
    const tm = Math.floor(Date.now() / 1000);
    const sog = 28 + Math.round(Math.random() * 12);   // > takeoff threshold
    const cog = 45;
    await get(`leolive=4&sid=${sid}&pid=${i}&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`
      + `&alt=${alt}&sog=${sog}&cog=${cog}&tm=${tm}`);
    process.stdout.write(`\r  point ${i}/${POINTS}  (${lat.toFixed(4)}, ${lon.toFixed(4)})  ${alt} m`);
    await new Promise((r) => setTimeout(r, STEP_MS));
  }

  await get(`leolive=3&sid=${sid}&pid=${POINTS + 1}&prid=0`);
  console.log('\n  end sent. Flight complete.');
})().catch((e) => { console.error(e); process.exit(1); });

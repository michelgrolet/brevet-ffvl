// WhatsApp via QR-code login (the "WhatsApp Web" way).
//
// You link YOUR own WhatsApp account once by scanning a QR code, then the
// server can post to any chat/group you're in — so the people you notify do
// NOTHING (no per-person key, unlike CallMeBot). Great for a group where your
// girlfriend + friends just need to be members.
//
// ⚠️ Caveats (be aware):
//   - Uses the Baileys library, an UNOFFICIAL WhatsApp Web client. It's against
//     WhatsApp's ToS; low risk for personal low-volume use, but a real (small)
//     risk of a number ban.
//   - The login session is stored on disk (WHATSAPP_AUTH_DIR). If that folder is
//     wiped you must re-scan the QR. On hosts with an ephemeral filesystem
//     (e.g. Render free) that happens on every redeploy — prefer an always-on
//     machine or a persistent disk.
//
// Enable with WHATSAPP_QR=1. Baileys is an optional dependency: if it isn't
// installed, this module stays inert and the rest of the app runs normally.
//
// Config (env):
//   WHATSAPP_QR          set to 1/true/yes to enable this channel
//   WHATSAPP_AUTH_DIR    where to persist the login (default: data/wa-auth)
//   WHATSAPP_GROUP_JID   target chat id(s), comma-separated, e.g.
//                        "12036304@g.us". Open /whatsapp-setup after linking to
//                        list your groups and their ids. If empty, sends to
//                        yourself (your own number).

const path = require('path');

const ENABLED = /^(1|true|yes)$/i.test(process.env.WHATSAPP_QR || '');
const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR
  || path.join(__dirname, '..', '..', 'data', 'wa-auth');

let baileys = null;           // lazily-required module
let sock = null;              // current socket
let ready = false;            // connection open + logged in
let currentQR = null;         // pending QR string to scan (null once linked)
let groups = [];              // [{ jid, name }] once linked
let starting = false;
let lastError = null;

function isEnabled() { return ENABLED; }
function isReady() { return ready; }
function getQR() { return currentQR; }
function listGroups() { return groups; }
function status() {
  return {
    enabled: ENABLED,
    available: Boolean(baileys) || !triedRequire,
    ready,
    qr: currentQR,
    groups,
    error: lastError,
  };
}

let triedRequire = false;
function loadBaileys() {
  if (triedRequire) return baileys;
  triedRequire = true;
  try {
    baileys = require('@whiskeysockets/baileys');
  } catch (err) {
    baileys = null;
    lastError = 'Baileys non installé (npm install @whiskeysockets/baileys)';
    console.error('whatsapp-qr:', lastError);
  }
  return baileys;
}

async function refreshGroups() {
  try {
    const all = await sock.groupFetchAllParticipating();
    groups = Object.values(all).map((g) => ({ jid: g.id, name: g.subject }));
  } catch {
    /* groups are best-effort */
  }
}

function targets() {
  const configured = (process.env.WHATSAPP_GROUP_JID || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (configured.length) return configured;
  // Fallback: send to yourself.
  if (sock?.user?.id && baileys?.jidNormalizedUser) {
    return [baileys.jidNormalizedUser(sock.user.id)];
  }
  return [];
}

async function connect() {
  const b = loadBaileys();
  if (!b) return;
  const makeWASocket = b.default || b.makeWASocket;
  const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = b;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch { /* use default */ }

  sock = makeWASocket({ version, auth: state, printQRInTerminal: false, browser: ['brevet-ffvl', 'Chrome', '1.0'] });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      currentQR = qr;
      lastError = null;
      // Also render in the logs (handy on hosts that only show stdout).
      try { require('qrcode-terminal').generate(qr, { small: true }); } catch { /* optional */ }
      console.log('whatsapp-qr: scan the QR at /whatsapp-setup (or above) to link your account');
    }
    if (connection === 'open') {
      ready = true;
      currentQR = null;
      lastError = null;
      console.log('whatsapp-qr: linked and ready ✅');
      await refreshGroups();
    }
    if (connection === 'close') {
      ready = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === (DisconnectReason && DisconnectReason.loggedOut);
      if (loggedOut) {
        lastError = 'Déconnecté (logged out) — relance le scan du QR';
        console.error('whatsapp-qr:', lastError);
      } else {
        // Transient drop — reconnect.
        setTimeout(() => connect().catch((e) => console.error('whatsapp-qr reconnect:', e.message)), 3000);
      }
    }
  });
}

async function init() {
  if (!ENABLED || starting) return;
  starting = true;
  try {
    await connect();
  } catch (err) {
    lastError = err.message;
    console.error('whatsapp-qr init:', err.message);
  }
}

/** Send a message to the configured group(s) / self. No-op if not ready. */
async function send(text) {
  if (!ENABLED) return;
  if (!ready || !sock) {
    console.error('whatsapp-qr: not linked yet — open /whatsapp-setup to scan the QR');
    return;
  }
  const jids = targets();
  if (!jids.length) {
    console.error('whatsapp-qr: no target — set WHATSAPP_GROUP_JID (see /whatsapp-setup)');
    return;
  }
  await Promise.all(jids.map(async (jid) => {
    try {
      await sock.sendMessage(jid, { text });
    } catch (err) {
      console.error(`whatsapp-qr: send to ${jid} failed:`, err.message);
    }
  }));
}

module.exports = { init, isEnabled, isReady, getQR, listGroups, status, send };

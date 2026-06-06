// Pluggable "someone is flying" notifier. Sends a takeoff / landing message
// through any channels configured via env. All channels are optional and several
// can be enabled at once. Zero dependencies — uses Node 18's global fetch.
//
// Channels (env):
//   WHATSAPP_RECIPIENTS   CallMeBot WhatsApp, free, no business account needed.
//                         Format: "phone:apikey,phone:apikey". Each recipient
//                         must message the CallMeBot number once for an apikey
//                         (one-time consent required by WhatsApp) — see README.
//   NTFY_TOPIC            ntfy.sh push topic (anyone subscribed sees it).
//   NTFY_SERVER           ntfy server (default https://ntfy.sh)
//   NOTIFY_WEBHOOK_URL    generic webhook — receives a JSON POST.

function whatsappRecipients() {
  return (process.env.WHATSAPP_RECIPIENTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(':');
      return { phone: pair.slice(0, i).trim(), apikey: pair.slice(i + 1).trim() };
    })
    .filter((r) => r.phone && r.apikey);
}

async function sendWhatsApp(text) {
  const recips = whatsappRecipients();
  await Promise.all(recips.map(async ({ phone, apikey }) => {
    const url = 'https://api.callmebot.com/whatsapp.php'
      + `?phone=${encodeURIComponent(phone)}`
      + `&text=${encodeURIComponent(text)}`
      + `&apikey=${encodeURIComponent(apikey)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) console.error(`notify: WhatsApp to ${phone} -> HTTP ${res.status}`);
    } catch (err) {
      console.error(`notify: WhatsApp to ${phone} failed:`, err.message);
    }
  }));
}

async function sendNtfy(title, text, link) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const server = process.env.NTFY_SERVER || 'https://ntfy.sh';
  try {
    const headers = { Title: title };
    if (link) { headers.Click = link; headers.Actions = `view, Suivre le vol, ${link}`; }
    const res = await fetch(`${server.replace(/\/$/, '')}/${encodeURIComponent(topic)}`, {
      method: 'POST', headers, body: text,
    });
    if (!res.ok) console.error(`notify: ntfy -> HTTP ${res.status}`);
  } catch (err) {
    console.error('notify: ntfy failed:', err.message);
  }
}

async function sendWebhook(payload) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error(`notify: webhook -> HTTP ${res.status}`);
  } catch (err) {
    console.error('notify: webhook failed:', err.message);
  }
}

/** True if at least one channel is configured. */
function isConfigured() {
  return Boolean(
    whatsappRecipients().length || process.env.NTFY_TOPIC || process.env.NOTIFY_WEBHOOK_URL,
  );
}

async function dispatch(event, { pilot, link, title, text }) {
  const withLink = link ? `${text}\n${link}` : text;
  await Promise.all([
    sendWhatsApp(withLink),
    sendNtfy(title, text, link),
    sendWebhook({ event, pilot, link, text, at: new Date().toISOString() }),
  ]);
}

async function notifyTakeoff(flight, link) {
  const pilot = flight.pilot || 'Pilote';
  await dispatch('takeoff', {
    pilot, link,
    title: `🪂 ${pilot} vient de décoller`,
    text: `🪂 ${pilot} vient de décoller ! Suivez le vol en direct :`,
  });
}

async function notifyLanding(flight, link) {
  const pilot = flight.pilot || 'Pilote';
  const mins = Math.max(1, Math.round((flight.lastSeen - flight.startedAt) / 60_000));
  await dispatch('landing', {
    pilot, link,
    title: `✅ ${pilot} a atterri`,
    text: `✅ ${pilot} a atterri après ${mins} min de vol.`,
  });
}

module.exports = { notifyTakeoff, notifyLanding, isConfigured };

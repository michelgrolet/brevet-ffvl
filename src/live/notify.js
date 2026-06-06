// Pluggable "someone is flying" notifier. Sends a takeoff / landing message
// through any channels configured via env. All channels are optional and several
// can be enabled at once. Zero dependencies — uses Node 18's global fetch.
//
// Channels (env):
//   TELEGRAM_BOT_TOKEN    Telegram bot token from @BotFather. With
//   TELEGRAM_CHAT_ID      group/channel/person id(s), comma-separated, sends to
//                         a whole group — everyone in it receives the alert.
//                         Recipients just need Telegram + to be in the group;
//                         no per-person key, and YOU set it all up. See README.
//   WHATSAPP_RECIPIENTS   CallMeBot WhatsApp, free, no business account needed.
//                         Format: "phone:apikey,phone:apikey". Each recipient
//                         must message the CallMeBot number once for an apikey
//                         (no groups) — see README.
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

function telegramChats() {
  return (process.env.TELEGRAM_CHAT_ID || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chats = telegramChats();
  if (!token || !chats.length) return;
  await Promise.all(chats.map(async (chat_id) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text, disable_web_page_preview: false }),
      });
      if (!res.ok) console.error(`notify: Telegram to ${chat_id} -> HTTP ${res.status}`);
    } catch (err) {
      console.error(`notify: Telegram to ${chat_id} failed:`, err.message);
    }
  }));
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
    (process.env.TELEGRAM_BOT_TOKEN && telegramChats().length)
    || whatsappRecipients().length || process.env.NTFY_TOPIC || process.env.NOTIFY_WEBHOOK_URL,
  );
}

async function dispatch(event, { pilot, link, title, text }) {
  const withLink = link ? `${text}\n${link}` : text;
  await Promise.all([
    sendTelegram(withLink),
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

// Baileys auth-state backed by Upstash Redis (REST API).
//
// Problem this solves: the QR-login session (src/live/whatsapp-qr.js) is
// normally stored on local disk. On hosts with an ephemeral filesystem
// (Render free) that disk is wiped on every redeploy, forcing a fresh QR scan.
// Storing the session in Upstash (free Redis, REST) makes it survive restarts,
// so you scan the QR once and never again.
//
// No extra npm dependency: we talk to Upstash over plain HTTP with fetch.
//
// Config (env):
//   UPSTASH_REDIS_REST_URL    from the Upstash console
//   UPSTASH_REDIS_REST_TOKEN  from the Upstash console
//   UPSTASH_PREFIX            key namespace (default "wa-auth")

function isConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

// Run one Redis command via the Upstash REST endpoint. Commands are sent as a
// JSON array body, so values with any bytes/length are handled safely.
async function cmd(args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`Upstash ${args[0]} -> HTTP ${res.status}`);
  const json = await res.json();
  return json.result;
}

/**
 * Build a Baileys-compatible auth state persisted to Upstash.
 * @param {object} baileys the required @whiskeysockets/baileys module
 * @returns {Promise<{state: object, saveCreds: function}>}
 */
async function useUpstashAuthState(baileys) {
  const { initAuthCreds, BufferJSON, proto } = baileys;
  const prefix = process.env.UPSTASH_PREFIX || 'wa-auth';
  const k = (key) => `${prefix}:${key}`;

  const writeData = (key, data) => cmd(['SET', k(key), JSON.stringify(data, BufferJSON.replacer)]);
  const readData = async (key) => {
    const raw = await cmd(['GET', k(key)]);
    return raw ? JSON.parse(raw, BufferJSON.reviver) : null;
  };
  const removeData = (key) => cmd(['DEL', k(key)]);

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(key, value) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData('creds', creds),
  };
}

module.exports = { isConfigured, useUpstashAuthState };

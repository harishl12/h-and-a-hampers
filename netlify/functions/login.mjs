// Owner login — verifies the password (server-side) against the DASHBOARD_PASSWORD
// env var and returns a short-lived signed session token. The password is never
// shipped to the browser. Failed attempts are rate-limited per IP.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_FAILS = 10;               // failed attempts per IP
const RL_WINDOW = 15 * 60 * 1000;   // window

function signToken(secret) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function clientIp(req, context) {
  return (context && context.ip)
    || req.headers.get('x-nf-client-connection-ip')
    || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'unknown';
}

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const password = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.DASHBOARD_SECRET;
  if (!password || !secret) {
    return json({ error: 'Dashboard not configured. Set DASHBOARD_PASSWORD and DASHBOARD_SECRET in Netlify.' }, 500);
  }

  // Per-IP brute-force throttle (best-effort; never blocks login if storage is down)
  let store, rlKey, rl;
  try {
    store = getStore('ha-ratelimit');
    rlKey = 'login:' + clientIp(req, context);
    rl = (await store.get(rlKey, { type: 'json' })) || { count: 0, start: Date.now() };
    if (Date.now() - rl.start > RL_WINDOW) rl = { count: 0, start: Date.now() };
    if (rl.count >= MAX_FAILS) return json({ error: 'Too many attempts. Please try again later.' }, 429);
  } catch { store = null; }

  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const given = String(body.password || '');

  // Constant-time comparison
  const a = Buffer.from(given);
  const b = Buffer.from(password);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  // Small fixed delay to blunt brute-force attempts
  await new Promise((r) => setTimeout(r, 400));

  if (!ok) {
    if (store) { try { rl.count += 1; await store.setJSON(rlKey, rl); } catch { /* ignore */ } }
    return json({ error: 'Incorrect password' }, 401);
  }

  if (store) { try { await store.delete(rlKey); } catch { /* ignore */ } }
  return json({ token: signToken(secret), expiresIn: TTL_MS });
};

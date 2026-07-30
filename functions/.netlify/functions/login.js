// Owner login — verifies the password (server-side) against the DASHBOARD_PASSWORD
// env var and returns a short-lived signed session token. Failed attempts are
// rate-limited per IP using Cloudflare KV.
import { json, signToken } from '../../_lib/auth.js';

const MAX_FAILS = 10;
const RL_WINDOW = 15 * 60 * 1000;

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  const password = env.DASHBOARD_PASSWORD;
  const secret = env.DASHBOARD_SECRET;
  if (!password || !secret) {
    return json({ error: 'Dashboard not configured. Set DASHBOARD_PASSWORD and DASHBOARD_SECRET in Cloudflare.' }, 500);
  }

  const ip = request.headers.get('cf-connecting-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const rlKey = 'ratelimit:login:' + ip;
  let rl = { count: 0, start: Date.now() };
  try {
    const raw = await env.HA_KV.get(rlKey);
    if (raw) rl = JSON.parse(raw);
    if (Date.now() - (rl.start || 0) > RL_WINDOW) rl = { count: 0, start: Date.now() };
    if (rl.count >= MAX_FAILS) return json({ error: 'Too many attempts. Please try again later.' }, 429);
  } catch { /* best-effort */ }

  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const given = String(body.password || '');
  const ok = timingSafeEqualStr(given, password);

  await new Promise((r) => setTimeout(r, 400)); // blunt brute-force timing

  if (!ok) {
    try { rl.count += 1; await env.HA_KV.put(rlKey, JSON.stringify(rl), { expirationTtl: 900 }); } catch { /* ignore */ }
    return json({ error: 'Incorrect password' }, 401);
  }

  try { await env.HA_KV.delete(rlKey); } catch { /* ignore */ }
  return json({ token: await signToken(secret), expiresIn: 12 * 60 * 60 * 1000 });
}

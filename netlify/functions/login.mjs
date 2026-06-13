// Owner login — verifies the password (server-side) against the DASHBOARD_PASSWORD
// env var and returns a short-lived signed session token. The password is never
// shipped to the browser.
import crypto from 'node:crypto';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function signToken(secret) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const password = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.DASHBOARD_SECRET;
  if (!password || !secret) {
    return json({ error: 'Dashboard not configured. Set DASHBOARD_PASSWORD and DASHBOARD_SECRET in Netlify.' }, 500);
  }

  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const given = String(body.password || '');

  // Constant-time comparison
  const a = Buffer.from(given);
  const b = Buffer.from(password);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  // Small fixed delay to blunt brute-force attempts
  await new Promise((r) => setTimeout(r, 400));

  if (!ok) return json({ error: 'Incorrect password' }, 401);
  return json({ token: signToken(secret), expiresIn: TTL_MS });
};

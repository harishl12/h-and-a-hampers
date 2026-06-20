// Email-OTP login — step 2: verify the code and, on success, issue the same signed
// session token used by password login (so the rest of the dashboard works unchanged).
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const TTL_MS = 12 * 60 * 60 * 1000; // 12-hour session (matches password login)

function signToken(secret) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return json({ error: 'Not configured' }, 500);

  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = String(body.email || '').trim().toLowerCase();
  const otp = String(body.otp || '').trim();
  if (!email || !/^\d{6}$/.test(otp)) return json({ error: 'Enter the 6-digit code.' }, 400);

  const store = getStore('ha-otp');
  const key = Buffer.from(email).toString('base64url');
  const rec = await store.get(key, { type: 'json' });

  if (!rec || !rec.otpHash) return json({ error: 'No code requested. Please request a new one.' }, 400);
  if (Date.now() > rec.exp) { await store.delete(key); return json({ error: 'Code expired. Please request a new one.' }, 400); }
  if ((rec.attempts || 0) >= 5) { await store.delete(key); return json({ error: 'Too many attempts. Please request a new code.' }, 429); }

  const hash = crypto.createHmac('sha256', secret).update(email + ':' + otp).digest('hex');
  const a = Buffer.from(hash);
  const b = Buffer.from(rec.otpHash);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    rec.attempts = (rec.attempts || 0) + 1;
    await store.setJSON(key, rec);
    return json({ error: 'Incorrect code. Please try again.' }, 401);
  }

  await store.delete(key); // single use
  return json({ token: signToken(secret), expiresIn: TTL_MS });
};

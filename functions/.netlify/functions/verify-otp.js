// Email-OTP login — step 2: verify the code and, on success, issue the same signed
// session token used by password login (so the rest of the dashboard works unchanged).
import { json, signToken, hmacDigestHex } from '../../_lib/auth.js';

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  const secret = env.DASHBOARD_SECRET;
  if (!secret) return json({ error: 'Not configured' }, 500);

  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const email = String(body.email || '').trim().toLowerCase();
  const otp = String(body.otp || '').trim();
  if (!email || !/^\d{6}$/.test(otp)) return json({ error: 'Enter the 6-digit code.' }, 400);

  const key = 'otp:' + btoa(email);
  let rec = null;
  try { const raw = await env.HA_KV.get(key); if (raw) rec = JSON.parse(raw); } catch { /* ignore */ }

  if (!rec || !rec.otpHash) return json({ error: 'No code requested. Please request a new one.' }, 400);
  if (Date.now() > rec.exp) { await env.HA_KV.delete(key); return json({ error: 'Code expired. Please request a new one.' }, 400); }
  if ((rec.attempts || 0) >= 5) { await env.HA_KV.delete(key); return json({ error: 'Too many attempts. Please request a new code.' }, 429); }

  const hash = await hmacDigestHex(secret, email + ':' + otp);
  const ok = timingSafeEqualStr(hash, rec.otpHash);

  if (!ok) {
    rec.attempts = (rec.attempts || 0) + 1;
    await env.HA_KV.put(key, JSON.stringify(rec));
    return json({ error: 'Incorrect code. Please try again.' }, 401);
  }

  await env.HA_KV.delete(key);
  return json({ token: await signToken(secret), expiresIn: 12 * 60 * 60 * 1000 });
}

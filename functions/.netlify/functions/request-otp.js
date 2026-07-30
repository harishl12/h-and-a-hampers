// Email-OTP login — step 1: generate a 6-digit code, store it (hashed) in
// Cloudflare KV with an expiry + rate limit, and email it via Resend.
// Cloudflare Workers can't open raw SMTP sockets, so this migration drops the
// Gmail SMTP path entirely — Resend (a simple HTTP API) is now the only option.
// Sign up free at resend.com and set RESEND_API_KEY in Cloudflare to enable this.
import { json, hmacDigestHex } from '../../_lib/auth.js';

const OFFICIAL = 'h.and.a.gifts.hampers@gmail.com';
const OTP_TTL = 10 * 60 * 1000;
const WINDOW = 15 * 60 * 1000;
const MAX_SENDS = 5;
const COOLDOWN = 30 * 1000;

function allowedEmails(env) {
  const raw = env.ALLOWED_EMAILS || env.OTP_EMAIL || OFFICIAL;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function randomOtp() {
  const arr = crypto.getRandomValues(new Uint32Array(1));
  return String(100000 + (arr[0] % 900000));
}

export async function onRequestPost({ request, env }) {
  const secret = env.DASHBOARD_SECRET;
  if (!secret) return json({ error: 'Dashboard not configured (DASHBOARD_SECRET missing).' }, 500);

  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const email = String(body.email || '').trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (!allowedEmails(env).includes(email)) return json({ error: 'This email is not authorized for dashboard access.' }, 403);

  const key = 'otp:' + btoa(email);
  const now = Date.now();
  let rec = { sent: 0, windowStart: now };
  try { const raw = await env.HA_KV.get(key); if (raw) rec = JSON.parse(raw); } catch { /* ignore */ }
  if (now - (rec.windowStart || 0) > WINDOW) { rec.sent = 0; rec.windowStart = now; }
  if (rec.sent >= MAX_SENDS) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
  if (rec.lastSent && now - rec.lastSent < COOLDOWN) return json({ error: 'Please wait a few seconds before requesting another code.' }, 429);

  const otp = randomOtp();
  rec.otpHash = await hmacDigestHex(secret, email + ':' + otp);
  rec.exp = now + OTP_TTL;
  rec.attempts = 0;
  rec.sent = (rec.sent || 0) + 1;
  rec.lastSent = now;
  await env.HA_KV.put(key, JSON.stringify(rec), { expirationTtl: Math.ceil(OTP_TTL / 1000) + 60 });

  const subject = `${otp} is your H & A Hampers dashboard code`;
  const text = `Your owner dashboard login code is ${otp}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`;
  const html = `<div style="font-family:Georgia,serif;max-width:440px;margin:auto;padding:28px;background:#f4f1e8;border-radius:16px;color:#262019">
      <h2 style="color:#1e3d34;font-weight:600;margin:0 0 6px">H &amp; A Hampers</h2>
      <p style="color:#6c655b;font-size:14px;margin:0 0 20px">Owner dashboard login</p>
      <div style="background:#fff;border-radius:12px;padding:20px;text-align:center;border:1px solid #ece3d2">
        <div style="font-size:12px;letter-spacing:.1em;color:#6c655b;text-transform:uppercase">Your code</div>
        <div style="font-size:34px;letter-spacing:.3em;font-weight:bold;color:#d56f4c;margin-top:6px">${otp}</div>
      </div>
      <p style="color:#6c655b;font-size:13px;margin-top:18px">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
    </div>`;

  const resendKey = env.RESEND_API_KEY;
  if (!resendKey) {
    console.log(`[OTP] Dashboard login code for ${email}: ${otp} (set RESEND_API_KEY in Cloudflare to email it)`);
    return json({ ok: true, devMode: true });
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM || 'H & A Hampers <onboarding@resend.dev>', to: [email], subject, text, html })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[OTP] Resend failed —', r.status, detail);
      return json({ error: 'Could not send the email via Resend — see Cloudflare function logs.' }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    console.error('[OTP] Resend error —', e && e.message);
    return json({ error: 'Could not reach Resend — see Cloudflare function logs.' }, 502);
  }
}

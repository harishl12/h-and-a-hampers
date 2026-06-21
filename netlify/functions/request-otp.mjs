// Email-OTP login — step 1: generate a 6-digit code, store it (hashed) in Netlify
// Blobs with an expiry + rate limit, and email it to an allowed owner address.
// Sends from/to the official Gmail using a Gmail App Password (GMAIL_APP_PASSWORD).
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const OFFICIAL = 'h.and.a.gifts.hampers@gmail.com';
const OTP_TTL = 10 * 60 * 1000;        // code valid 10 minutes
const WINDOW = 15 * 60 * 1000;         // rate-limit window
const MAX_SENDS = 5;                   // per window
const COOLDOWN = 30 * 1000;            // between sends

function allowedEmails() {
  const raw = process.env.ALLOWED_EMAILS || process.env.OTP_EMAIL || OFFICIAL;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return json({ error: 'Dashboard not configured (DASHBOARD_SECRET missing).' }, 500);

  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = String(body.email || '').trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (!allowedEmails().includes(email)) return json({ error: 'This email is not authorized for dashboard access.' }, 403);

  const store = getStore('ha-otp');
  const key = Buffer.from(email).toString('base64url');
  const now = Date.now();
  let rec = (await store.get(key, { type: 'json' })) || { sent: 0, windowStart: now };
  if (now - (rec.windowStart || 0) > WINDOW) { rec.sent = 0; rec.windowStart = now; }
  if (rec.sent >= MAX_SENDS) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
  if (rec.lastSent && now - rec.lastSent < COOLDOWN) return json({ error: 'Please wait a few seconds before requesting another code.' }, 429);

  const otp = String(crypto.randomInt(100000, 1000000)); // CSPRNG, always 6 digits
  rec.otpHash = crypto.createHmac('sha256', secret).update(email + ':' + otp).digest('hex');
  rec.exp = now + OTP_TTL;
  rec.attempts = 0;
  rec.sent = (rec.sent || 0) + 1;
  rec.lastSent = now;
  await store.setJSON(key, rec);

  // Email content (shared across providers)
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

  const resendKey = process.env.RESEND_API_KEY;
  // Gmail shows App Passwords as "abcd efgh ijkl mnop" — strip any spaces the owner pasted.
  const appPass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const fromEmail = (process.env.OTP_EMAIL || OFFICIAL).trim();

  // ── Option 1: Resend (simple HTTP API, no SMTP/2FA) ──
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.RESEND_FROM || 'H & A Hampers <onboarding@resend.dev>', to: [email], subject, text, html })
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        console.error('[OTP] Resend failed —', r.status, detail);
        return json({ error: 'Could not send the email via Resend — see Netlify function logs.' }, 502);
      }
      return json({ ok: true });
    } catch (e) {
      console.error('[OTP] Resend error —', e && e.message);
      return json({ error: 'Could not reach Resend — see Netlify function logs.' }, 502);
    }
  }

  // ── Option 2: Gmail SMTP (App Password) ──
  if (appPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 465, secure: true,
        auth: { user: fromEmail, pass: appPass }
      });
      await transporter.sendMail({ from: `"H & A Hampers" <${fromEmail}>`, to: email, subject, text, html });
      return json({ ok: true });
    } catch (e) {
      console.error('[OTP] Gmail send failed —',
        'message:', e && e.message, '| code:', e && e.code,
        '| responseCode:', e && e.responseCode, '| response:', e && e.response);
      const authErr = e && (e.responseCode === 535 || e.code === 'EAUTH');
      return json({
        error: authErr
          ? 'Gmail rejected the login. Turn ON 2-Step Verification for h.and.a.gifts.hampers@gmail.com and use an App Password from that account — or set RESEND_API_KEY to use Resend instead.'
          : 'Could not send the email — see Netlify function logs for the exact error.'
      }, 502);
    }
  }

  // ── Option 3: no provider configured — log for testing ──
  console.log(`[OTP] Dashboard login code for ${email}: ${otp} (set RESEND_API_KEY or GMAIL_APP_PASSWORD to email it)`);
  return json({ ok: true, devMode: true });
};

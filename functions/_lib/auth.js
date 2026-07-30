// Shared helpers for Cloudflare Pages Functions — session token verify + JSON responses.
// Mirrors the HMAC-signed-token scheme originally used on Netlify, unchanged, so
// existing dashboard sessions/logic keep working identically after the migration.

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacBase64Url(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(sig));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const TTL_MS = 12 * 60 * 60 * 1000; // 12-hour session

export async function signToken(secret) {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ exp: Date.now() + TTL_MS })));
  const sig = await hmacBase64Url(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyToken(req, secret) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = await hmacBase64Url(secret, payload);
  if (!timingSafeEqual(sig, expected)) return false;
  try {
    const { exp } = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    return Date.now() < exp;
  } catch { return false; }
}

export async function hmacDigestHex(secret, message) {
  return hmacHex(secret, message);
}

export const SESSION_TTL_MS = TTL_MS;

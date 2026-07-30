// Authenticated product-photo upload. Accepts a base64 (data URL) image, stores
// the binary in Cloudflare KV, and returns a same-origin URL to serve it.
import { json, verifyToken } from '../../_lib/auth.js';

const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 1.5 * 1024 * 1024;

function randHex(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  const secret = env.DASHBOARD_SECRET;
  if (!secret) return json({ error: 'Not configured' }, 500);
  if (!(await verifyToken(request, secret))) return json({ error: 'Unauthorized' }, 401);

  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const { data, contentType, productId } = body;
  if (typeof data !== 'string' || !ALLOWED[contentType]) return json({ error: 'Invalid image' }, 400);

  const comma = data.indexOf(',');
  const b64 = data.startsWith('data:') && comma >= 0 ? data.slice(comma + 1) : data;
  let bytes;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch { return json({ error: 'Bad image data' }, 400); }
  if (!bytes.length) return json({ error: 'Empty image' }, 400);
  if (bytes.length > MAX_BYTES) return json({ error: 'Image too large (max ~1.5 MB).' }, 413);

  const pid = String(productId || 'x').replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'x';
  const key = `p${pid}-${Date.now().toString(36)}${randHex(3)}.${ALLOWED[contentType]}`;

  try {
    await env.HA_KV.put('img:' + key, bytes, { metadata: { contentType } });
  } catch (e) {
    return json({ error: 'Could not save the image.' }, 500);
  }

  return json({ ok: true, key, url: `/img/${key}` });
}

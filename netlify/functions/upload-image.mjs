// Authenticated product-photo upload. Accepts a base64 (data URL) image, stores
// the binary in Netlify Blobs, and returns a same-origin URL to serve it.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

function verify(req, secret) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Date.now() < exp;
  } catch { return false; }
}

const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 1.5 * 1024 * 1024; // safety cap (images are resized in the browser first)

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return json({ error: 'Not configured' }, 500);
  if (!verify(req, secret)) return json({ error: 'Unauthorized' }, 401);

  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const { data, contentType, productId } = body;
  if (typeof data !== 'string' || !ALLOWED[contentType]) return json({ error: 'Invalid image' }, 400);

  const comma = data.indexOf(',');
  const b64 = data.startsWith('data:') && comma >= 0 ? data.slice(comma + 1) : data;
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return json({ error: 'Bad image data' }, 400); }
  if (!buf.length) return json({ error: 'Empty image' }, 400);
  if (buf.length > MAX_BYTES) return json({ error: 'Image too large (max ~1.5 MB).' }, 413);

  const pid = String(productId || 'x').replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'x';
  const key = `p${pid}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}.${ALLOWED[contentType]}`;

  try {
    const store = getStore('ha-images');
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    await store.set(key, ab, { metadata: { contentType } });
  } catch (e) {
    return json({ error: 'Could not save the image.' }, 500);
  }

  return json({ ok: true, key, url: `/img/${key}` });
};

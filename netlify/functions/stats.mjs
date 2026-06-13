// Returns view + product analytics from Netlify Blobs. Requires a valid session token.
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

export default async (req) => {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return json({ error: 'Not configured' }, 500);
  if (!verify(req, secret)) return json({ error: 'Unauthorized' }, 401);

  let data = { views: 0, daily: {}, products: {} };
  try {
    const store = getStore('ha-analytics');
    data = (await store.get('data', { type: 'json' })) || data;
  } catch { /* return empty defaults */ }

  return json(data);
};

// Returns view + product analytics from Cloudflare KV. Requires a valid session token.
import { json, verifyToken } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const secret = env.DASHBOARD_SECRET;
  if (!secret) return json({ error: 'Not configured' }, 500);
  if (!(await verifyToken(request, secret))) return json({ error: 'Unauthorized' }, 401);

  let data = { views: 0, daily: {}, products: {} };
  try {
    const raw = await env.HA_KV.get('analytics:data');
    if (raw) data = JSON.parse(raw);
  } catch { /* return empty defaults */ }

  return json(data);
}

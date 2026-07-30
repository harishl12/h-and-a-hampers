// Returns contact-form messages, newsletter signups and orders from Cloudflare KV
// (populated by submit-form.js). Requires a valid session token.
import { json, verifyToken } from '../../_lib/auth.js';

async function getList(env, form) {
  try {
    const raw = await env.HA_KV.get('forms:' + form);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function onRequestGet({ request, env }) {
  const secret = env.DASHBOARD_SECRET;
  if (!secret) return json({ error: 'Not configured' }, 500);
  if (!(await verifyToken(request, secret))) return json({ error: 'Unauthorized' }, 401);

  const [contact, newsletter, orderRows] = await Promise.all([
    getList(env, 'contact'),
    getList(env, 'newsletter'),
    getList(env, 'order')
  ]);

  const orders = orderRows.map((o) => ({
    id: o.id, name: o.name, phone: o.phone, email: o.email, address: o.address,
    items: o.items, total: o.total, payment: o.payment, notes: o.notes, created: o.created
  }));

  return json({ contact, newsletter, orders });
}

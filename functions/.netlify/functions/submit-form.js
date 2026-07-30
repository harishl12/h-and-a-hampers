// Public form intake — replaces Netlify's built-in form capture (no Cloudflare
// equivalent exists). Accepts contact / newsletter / order submissions and stores
// them in Cloudflare KV as a list per form, capped so it can't grow unbounded.
// Read back by messages.js for the dashboard's Messages / Orders panels.
import { json } from '../../_lib/auth.js';

const ALLOWED_FORMS = new Set(['contact', 'newsletter', 'order']);
const MAX_PER_FORM = 500;

function randId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function onRequestPost({ request, env }) {
  let body = {};
  const ct = request.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) body = await request.json();
    else {
      const fd = await request.formData();
      body = Object.fromEntries(fd.entries());
    }
  } catch { return json({ error: 'Bad request' }, 400); }

  const form = String(body['form-name'] || body.form || '').trim();
  if (!ALLOWED_FORMS.has(form)) return json({ error: 'Unknown form' }, 400);

  const clip = (v, n) => String(v || '').slice(0, n);
  const entry = {
    id: randId(),
    form,
    name: clip(body.name, 100),
    email: clip(body.email, 150),
    phone: clip(body.phone, 40),
    category: clip(body.category, 60),
    message: clip(body.message, 2000),
    address: clip(body.address, 400),
    city: clip(body.city, 80),
    state: clip(body.state, 80),
    pin: clip(body.pin, 20),
    notes: clip(body.notes, 500),
    payment: clip(body.payment, 40),
    items: clip(body.items, 2000),
    total: clip(body.total, 40),
    created: new Date().toISOString()
  };

  const listKey = 'forms:' + form;
  try {
    const raw = await env.HA_KV.get(listKey);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(entry);
    if (list.length > MAX_PER_FORM) list.length = MAX_PER_FORM;
    await env.HA_KV.put(listKey, JSON.stringify(list));
  } catch (e) {
    return json({ error: 'Could not save submission' }, 500);
  }

  return json({ ok: true });
}

// Public analytics beacon — called from the storefront (no auth).
// Records page views and "Add to Bag" events into Netlify Blobs.
import { getStore } from '@netlify/blobs';

const blank = () => ({ views: 0, daily: {}, products: {} });

export default async (req) => {
  if (req.method !== 'POST') return new Response('', { status: 405 });

  let body = {};
  try { body = await req.json(); } catch { /* ignore malformed */ }
  const type = body.type;
  if (type !== 'view' && type !== 'add') return new Response('', { status: 204 });

  try {
    const store = getStore('ha-analytics');
    const data = (await store.get('data', { type: 'json' })) || blank();
    if (!data.daily) data.daily = {};
    if (!data.products) data.products = {};

    const today = new Date().toISOString().slice(0, 10);

    if (type === 'view') {
      data.views = (data.views || 0) + 1;
      data.daily[today] = (data.daily[today] || 0) + 1;
    } else if (type === 'add') {
      const id = String(body.id || '').slice(0, 40);
      if (id) {
        const p = data.products[id] || { name: String(body.name || id).slice(0, 80), count: 0 };
        p.count += 1;
        if (body.name) p.name = String(body.name).slice(0, 80);
        data.products[id] = p;
      }
    }

    // Keep only the most recent 60 days of daily data
    const cutoff = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    for (const d of Object.keys(data.daily)) if (d < cutoff) delete data.daily[d];

    await store.setJSON('data', data);
  } catch (e) {
    // Never let analytics break the user experience
  }
  return new Response('', { status: 204 });
};

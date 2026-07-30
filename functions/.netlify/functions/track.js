// Public analytics beacon — called from the storefront (no auth).
// Records page views and "Add to Bag" events into Cloudflare KV.
const blank = () => ({ views: 0, daily: {}, products: {} });

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch { /* ignore malformed */ }
  const type = body.type;
  if (type !== 'view' && type !== 'add') return new Response('', { status: 204 });

  try {
    const raw = await env.HA_KV.get('analytics:data');
    const data = raw ? JSON.parse(raw) : blank();
    if (!data.daily) data.daily = {};
    if (!data.products) data.products = {};

    const today = new Date().toISOString().slice(0, 10);

    if (type === 'view') {
      data.views = (data.views || 0) + 1;
      data.daily[today] = (data.daily[today] || 0) + 1;
    } else if (type === 'add') {
      const id = String(body.id || '').slice(0, 40);
      const existing = data.products[id];
      if (id && (existing || Object.keys(data.products).length < 200)) {
        const p = existing || { name: String(body.name || id).slice(0, 80), count: 0 };
        p.count += 1;
        if (body.name) p.name = String(body.name).slice(0, 80);
        data.products[id] = p;
      }
    }

    const cutoff = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    for (const d of Object.keys(data.daily)) if (d < cutoff) delete data.daily[d];

    await env.HA_KV.put('analytics:data', JSON.stringify(data));
  } catch (e) {
    // Never let analytics break the user experience
  }
  return new Response('', { status: 204 });
}

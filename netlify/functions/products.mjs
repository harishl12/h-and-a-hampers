// Product catalog store.
//   GET  (public)        → current product list for the storefront
//   POST (owner, signed) → replace the product list (edit price / add / delete)
// Data lives in Netlify Blobs; seeded from DEFAULTS on first read.
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

const DEFAULTS = [
  { id: 1, name: 'Rustic Gift Hamper', desc: 'Curated handmade items in a beautiful wicker basket', price: 1299, orig: 1599, icon: 'i-basket', bg: 'p-bg-1', cat: 'handmade', badge: 'Bestseller' },
  { id: 2, name: 'Personalized Name Jar', desc: "Custom engraved glass jar with your loved one's name", price: 599, orig: 799, icon: 'i-jar', bg: 'p-bg-2', cat: 'personalized', badge: 'Custom' },
  { id: 3, name: 'Diwali Celebration Box', desc: 'Festive goodies — sweets, candles & handcrafted decor', price: 1899, orig: 2299, icon: 'i-diya', bg: 'p-bg-3', cat: 'seasonal', badge: 'Festive' },
  { id: 4, name: 'Macramé Wall Hanging', desc: 'Handwoven bohemian wall art, made to order', price: 849, orig: null, icon: 'i-macrame', bg: 'p-bg-4', cat: 'handmade', badge: null },
  { id: 5, name: 'Anniversary Love Box', desc: 'Rose petals, chocolates & a personalised note card', price: 1499, orig: 1799, icon: 'i-lovebox', bg: 'p-bg-5', cat: 'personalized', badge: 'Popular' },
  { id: 6, name: 'Scented Candle Set', desc: 'Set of 3 hand-poured soy candles in seasonal scents', price: 749, orig: 999, icon: 'i-candle', bg: 'p-bg-6', cat: 'handmade', badge: null },
  { id: 7, name: 'Birthday Surprise Hamper', desc: 'Balloons, treats, handmade goodies & personalised card', price: 1199, orig: 1499, icon: 'i-cake', bg: 'p-bg-7', cat: 'seasonal', badge: 'New' },
  { id: 8, name: 'Custom Photo Memory Box', desc: 'Wooden keepsake box engraved with a photo & message', price: 1699, orig: null, icon: 'i-photo', bg: 'p-bg-8', cat: 'personalized', badge: 'Premium' }
];

const CATS = ['handmade', 'personalized', 'seasonal'];
const ICONS = ['i-basket', 'i-jar', 'i-diya', 'i-macrame', 'i-lovebox', 'i-candle', 'i-cake', 'i-photo', 'i-gift'];

function clean(list) {
  return (Array.isArray(list) ? list : []).slice(0, 100).map((p, idx) => {
    const num = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : null; };
    return {
      id: Number(p.id) || idx + 1,
      name: String(p.name || 'Untitled').slice(0, 80),
      desc: String(p.desc || '').slice(0, 220),
      price: num(p.price) || 0,
      orig: num(p.orig),
      icon: ICONS.includes(p.icon) ? p.icon : 'i-gift',
      bg: /^p-bg-[1-8]$/.test(p.bg || '') ? p.bg : `p-bg-${(idx % 8) + 1}`,
      cat: CATS.includes(p.cat) ? p.cat : 'handmade',
      badge: p.badge ? String(p.badge).slice(0, 24) : null,
      // Only same-origin image paths (e.g. /img/p1-abc.jpg) — blocks external/script URLs
      image: typeof p.image === 'string' && /^\/[A-Za-z0-9._/?=&-]{1,160}$/.test(p.image) ? p.image : null
    };
  });
}

export default async (req) => {
  const store = getStore('ha-products');

  if (req.method === 'GET') {
    let list;
    try { list = await store.get('list', { type: 'json' }); } catch { /* fall through */ }
    if (!Array.isArray(list) || !list.length) list = DEFAULTS;
    return json({ products: list });
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const secret = process.env.DASHBOARD_SECRET;
    if (!secret) return json({ error: 'Not configured' }, 500);
    if (!verify(req, secret)) return json({ error: 'Unauthorized' }, 401);

    let body = {};
    try { body = await req.json(); } catch { /* ignore */ }
    if (!Array.isArray(body.products)) return json({ error: 'products array required' }, 400);

    const list = clean(body.products);
    try { await store.setJSON('list', list); }
    catch (e) { return json({ error: 'Could not save products' }, 500); }
    return json({ ok: true, products: list });
  }

  return json({ error: 'Method not allowed' }, 405);
};

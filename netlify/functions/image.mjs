// Public image server — streams an uploaded product photo from Netlify Blobs.
// Reached via the /img/* redirect (see netlify.toml) which maps to ?key=<name>.
import { getStore } from '@netlify/blobs';

function guessType(k) {
  if (k.endsWith('.png')) return 'image/png';
  if (k.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export default async (req) => {
  const u = new URL(req.url);
  // The /img/* redirect (see netlify.toml) hands the function the original
  // incoming URL rather than rewriting the query string, so read the key
  // from the path itself; ?key=... is kept as a fallback for direct calls.
  let key = u.searchParams.get('key') || '';
  if (!key) {
    const parts = u.pathname.split('/').filter(Boolean);
    key = parts[parts.length - 1] || '';
  }
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(key)) return new Response('Bad request', { status: 400 });

  try {
    const store = getStore('ha-images');
    const res = await store.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!res || !res.data) return new Response('Not found', { status: 404 });
    const ct = (res.metadata && res.metadata.contentType) || guessType(key);
    return new Response(res.data, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Netlify-CDN-Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (e) {
    return new Response('Error', { status: 500 });
  }
};

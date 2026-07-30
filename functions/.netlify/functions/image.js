// Public image server — streams an uploaded product photo from Cloudflare KV.
// Reached via the /img/* rewrite in _redirects.
function guessType(k) {
  if (k.endsWith('.png')) return 'image/png';
  if (k.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  let key = u.searchParams.get('key') || '';
  if (!key) {
    const parts = u.pathname.split('/').filter(Boolean);
    key = parts[parts.length - 1] || '';
  }
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(key)) return new Response('Bad request', { status: 400 });

  try {
    const obj = await env.HA_KV.getWithMetadata('img:' + key, { type: 'arrayBuffer' });
    if (!obj || !obj.value) return new Response('Not found', { status: 404 });
    const ct = (obj.metadata && obj.metadata.contentType) || guessType(key);
    return new Response(obj.value, {
      status: 200,
      headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=31536000, immutable' }
    });
  } catch (e) {
    return new Response('Error', { status: 500 });
  }
}

// Returns contact-form messages and newsletter signups from the Netlify Forms API.
// Requires a valid session token. Uses NETLIFY_AUTH_TOKEN (a personal access token)
// and the site id (NETLIFY_SITE_ID, or Netlify's built-in SITE_ID).
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

export default async (req, context) => {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return json({ error: 'Not configured' }, 500);
  if (!verify(req, secret)) return json({ error: 'Unauthorized' }, 401);

  // Site ID is auto-detected from the function runtime — no env var needed.
  const siteId = process.env.NETLIFY_SITE_ID || context?.site?.id || process.env.SITE_ID;
  const apiToken = process.env.NETLIFY_AUTH_TOKEN;
  if (!apiToken) {
    return json({ error: 'Set NETLIFY_AUTH_TOKEN in Netlify to load messages.' }, 500);
  }
  if (!siteId) {
    return json({ error: 'Could not determine the site id. Set NETLIFY_SITE_ID in Netlify.' }, 500);
  }

  let subs = [];
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/submissions?per_page=200`, {
      headers: { Authorization: `Bearer ${apiToken}` }
    });
    if (!r.ok) return json({ error: `Netlify API error ${r.status}` }, 502);
    subs = await r.json();
  } catch (e) {
    return json({ error: 'Could not reach the Netlify API' }, 502);
  }

  const norm = (subs || []).map((s) => ({
    id: s.id,
    form: s.form_name,
    name: s.name || s.data?.name || '',
    email: s.email || s.data?.email || '',
    phone: s.data?.phone || '',
    category: s.data?.category || '',
    message: s.data?.message || '',
    created: s.created_at
  }));

  return json({
    contact: norm.filter((s) => s.form === 'contact'),
    newsletter: norm.filter((s) => s.form === 'newsletter')
  });
};

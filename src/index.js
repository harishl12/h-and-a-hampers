// Worker entry point for h-and-a-hampers.
// This project was created under Cloudflare's unified Workers model (a single
// Worker serving static assets + API routes), not the older separate "Pages"
// product — so routing happens here instead of via file-based Pages Functions.
// Each handler below is unchanged, just imported from where it already lived.
import { onRequestGet as imageGet } from '../functions/.netlify/functions/image.js';
import { onRequestPost as loginPost } from '../functions/.netlify/functions/login.js';
import { onRequestGet as messagesGet } from '../functions/.netlify/functions/messages.js';
import { onRequest as productsAny } from '../functions/.netlify/functions/products.js';
import { onRequestGet as statsGet } from '../functions/.netlify/functions/stats.js';
import { onRequestPost as submitFormPost } from '../functions/.netlify/functions/submit-form.js';
import { onRequestPost as trackPost } from '../functions/.netlify/functions/track.js';
import { onRequestPost as requestOtpPost } from '../functions/.netlify/functions/request-otp.js';
import { onRequestPost as verifyOtpPost } from '../functions/.netlify/functions/verify-otp.js';
import { onRequestPost as uploadImagePost } from '../functions/.netlify/functions/upload-image.js';

const ROUTES = {
  '/.netlify/functions/products': productsAny,
  '/.netlify/functions/login': loginPost,
  '/.netlify/functions/messages': messagesGet,
  '/.netlify/functions/stats': statsGet,
  '/.netlify/functions/submit-form': submitFormPost,
  '/.netlify/functions/track': trackPost,
  '/.netlify/functions/request-otp': requestOtpPost,
  '/.netlify/functions/verify-otp': verifyOtpPost,
  '/.netlify/functions/upload-image': uploadImagePost
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/img/')) {
      return imageGet({ request, env });
    }

    const handler = ROUTES[url.pathname];
    if (handler) {
      try {
        return await handler({ request, env, ctx });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Internal error' }), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Everything else is a static asset from /public
    return env.ASSETS.fetch(request);
  }
};

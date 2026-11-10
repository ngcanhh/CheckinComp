import { handleApi } from './server/app.mjs';
export default {
  async fetch(request, env) {
    let response;
    if (new URL(request.url).pathname.startsWith('/api/')) {
      const headers = new Headers(request.headers);
      headers.set('x-client-ip', request.headers.get('cf-connecting-ip') || 'unknown');
      response = await handleApi(new Request(request, { headers }), env);
    } else response = await env.ASSETS.fetch(request);
    const secured = new Response(response.body, response);
    secured.headers.set('X-Content-Type-Options', 'nosniff');
    secured.headers.set('Referrer-Policy', 'no-referrer');
    secured.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    return secured;
  },
};

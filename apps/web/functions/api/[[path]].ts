// Cloudflare Pages Function: forwards /api/* to the API so the browser stays same-origin
// (the session cookie is SameSite=Lax, and this replaces the rewrite that used to live in vercel.json).
// Set API_ORIGIN in Pages → Settings → Variables, e.g. https://203-0-113-7.sslip.io
interface Env {
  API_ORIGIN: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.set("X-Real-Client-IP", request.headers.get("CF-Connecting-IP") ?? "");
  return fetch(new Request(target, new Request(request, { headers })));
};

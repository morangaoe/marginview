# Migrating off Vercel + Railway

Target: Cloudflare Pages (web) + Oracle Always-Free VM (API, worker, Redis) + Neon (Postgres). All free.

The API cannot scale to zero: it runs a BullMQ worker and a 1-minute scrape scheduler in-process.

## 1. Database: Railway → Neon
1. Create a Neon project. Copy the **direct** connection string (not the `-pooler` one: the scheduler uses `pg_advisory_lock`).
2. `pg_dump -Fc --no-owner --no-acl "$RAILWAY_DATABASE_URL" -f mv.dump`
3. `pg_restore --no-owner --no-acl -d "$NEON_DIRECT_URL" mv.dump`
4. Neon free tier is 0.5 GB. Snapshot pruning (`SNAPSHOT_RETENTION_DAYS`) helps; lower it if you get close.

## 2. API: Railway → Oracle VM
1. Create an Always-Free **Ampere A1** instance (Ubuntu). In the VCN security list open TCP 80 and 443, and on the VM: `sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT` (persist with `netfilter-persistent save`).
2. Install Docker: `curl -fsSL https://get.docker.com | sh`
3. Clone the repo, then `cd deploy` and create `.env`:
   - `API_HOST=<public-ip-with-dashes>.sslip.io` (free hostname so Caddy can get a Let's Encrypt cert; use your own domain if you have one)
   - everything in `apps/api/.env.example`, with `DATABASE_URL` = Neon direct URL, `FRONTEND_URL=https://<project>.pages.dev` (or your custom domain), `APP_URL` same, plus your existing `JWT_SECRET`, Stripe, SerpAPI, etc. (reuse the Railway values; a new `JWT_SECRET` logs everyone out).
   - Leave `REDIS_URL` out: compose sets it.
4. `docker compose up -d --build`, then `curl https://$API_HOST/health`.

## 3. Web: Vercel → Cloudflare Pages
1. Pages → Create project → connect the repo. Build command `npm run build`, output dir `apps/web/dist`, root directory = repo root.
2. Add variable `API_ORIGIN=https://<API_HOST>` (read by `apps/web/functions/api/[[path]].ts`, which proxies `/api/*`). Leave `VITE_API_URL` unset.
3. Headers and the SPA fallback come from `apps/web/public/_headers` and `_redirects`.

## 4. Cut over
- Google sign-in: add the new web origin to Authorized JavaScript origins.
- Stripe: update the webhook URL to `https://<web-origin>/api/billing/webhook`.
- SendGrid / magic links use `APP_URL`, so check it points at the new origin.
- Keep Railway/Vercel running until login, a scrape ("Check now"), and a Stripe test event all work, then delete them (including `vercel.json` files).

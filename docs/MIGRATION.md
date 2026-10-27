# Going live: Render + Supabase (both free)

- **Supabase**: Postgres. Also holds the scrape job queue and schedules it with `pg_cron`.
- **Render** (free web service): one container that runs the API and serves the website (built from `apps/web` during the Docker build). It sleeps when idle; the cron ping below wakes it every minute, which also keeps it awake all month (a free service gets 750 h, a month is ~744 h).

The website and API share one origin, so the session cookie works without a proxy. No Redis. Jobs are rows in `scraping_job_runs` (migration 014). Scrapy runs inside the container (`SCRAPY_LOCAL=true`).

## 1. Supabase
1. supabase.com → New project. Save the database password.
2. Project Settings → Database → Connection string → **Session pooler** (port 5432). Replace `[YOUR-PASSWORD]`. This is `DATABASE_URL`. Not Direct (IPv6 only) and not Transaction (6543; breaks advisory locks).
3. Optional, to keep local data:
   ```
   pg_dump -Fc --no-owner --no-acl postgres://localhost:5432/marginview -f mv.dump
   pg_restore --no-owner --no-acl -d "<SESSION_POOLER_URL>" mv.dump
   ```
   Otherwise the API creates the schema on first start (`AUTO_MIGRATE=true`). Migration 013 enables RLS on every table so Supabase's REST API exposes nothing; the API connects as `postgres` and is unaffected.
4. Free tier is 500 MB. `SNAPSHOT_RETENTION_DAYS` limits snapshot growth.

## 2. Render (API)
1. render.com → New → Blueprint → pick this repo (it reads `render.yaml`), or New → Web Service → Docker with Dockerfile path `apps/api/Dockerfile`, context `.`, plan Free.
2. Set environment variables:
   - `DATABASE_URL` = Supabase Session pooler URL
   - `JWT_SECRET` = `openssl rand -base64 48`
   - `CRON_SECRET` = `openssl rand -hex 32` (used again in step 4)
   - `FRONTEND_URL` and `APP_URL` = the service's own URL (`https://<service>.onrender.com` or your custom domain); set them after the first deploy, once you know it
   - `PLATFORM_ADMIN_EMAILS` = your email
   - plus whichever you use: `SCRAPING_API_KEY`, `SERPAPI_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`, `SENDGRID_API_KEY`, `MAIL_FROM`
3. Deploy (the first build also compiles the website), then open `https://<service>.onrender.com/health` (should return `{"ok":true}`). Note the URL.

## 3. Supabase cron (runs the scraper)
SQL Editor → run, with your Render URL and the same `CRON_SECRET`:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'marginview-tick',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://<service>.onrender.com/internal/tick',
       headers := '{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb,
       timeout_milliseconds := 60000
     ) $$
);
```
Each call wakes Render if it is asleep (about 30 s cold start), queues due sources and works the queue. Check it with `select * from cron.job_run_details order by start_time desc limit 5;`. Stop it with `select cron.unschedule('marginview-tick');`.

## 4. External services
- **Stripe**: webhook URL `https://<service>.onrender.com/api/billing/webhook`; events `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`; signing secret → `STRIPE_WEBHOOK_SECRET`.
- **Google sign-in**: add `https://<service>.onrender.com` under Authorized JavaScript origins.
- **SendGrid**: `MAIL_FROM` must be a verified sender; links use `APP_URL`.

## 5. Check it
1. Sign in on the Render URL with an email in `PLATFORM_ADMIN_EMAILS` (public sign-up is off; add other people from the app).
2. Add a competitor URL and press **Check now**; the run moves queued → running → succeeded.
3. Supabase → Table Editor: tables exist, each marked RLS enabled.

## Limits of the free setup
- Render free has 512 MB RAM: keep `SCRAPE_CONCURRENCY` at 2.
- First request after a deploy or a restart takes ~30 s; the minute ping prevents sleeping otherwise.
- Scrapy does not run JavaScript. JS-rendered or bot-protected sites fall through to paid providers if you set `SCRAPING_API_KEY` / `BRIGHTDATA_WS_ENDPOINT`.

## Self-hosting instead (any VPS)
`deploy/docker-compose.yml` runs the API plus Caddy (HTTPS) with the same image. Set `API_HOST=<ip-with-dashes>.sslip.io` and the API variables in `deploy/.env`, then `docker compose up -d --build`. The API polls its own queue every 5 s, so the cron job is optional there.

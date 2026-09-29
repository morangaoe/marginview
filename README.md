# Marginview

Pricing intelligence, inventory, and procurement platform. See the six planning
documents (PRD, TRD, App Flow, UI/UX Design Brief, Backend Schema, Implementation
Plan) for the full specification this code implements against.

## Structure

```
marginview/
  apps/
    api/   Node + TypeScript + Express + PostgreSQL backend
    web/   React + Vite frontend
```

## Status

This is the Phase 0 to 1 scaffold from the Implementation Plan:

- Full database schema (`apps/api/src/db/schema.sql`), matching the Backend
  Schema document.
- Core API: auth (stub), organizations/locations, products and variants,
  inventory levels and movements, all six pricing strategies, manual
  competitor price entry, basic procurement suggestions and purchase orders.
- Frontend: responsive app shell (sidebar on desktop, bottom tabs on mobile),
  Dashboard, Inventory, Pricing (with the strategy selector), Procurement,
  and Billing pages wired to the API, plus the "Ask Marginview" assistant
  widget (calling a stub endpoint for now, see `apps/api/src/routes/assistant.ts`).
- Billing and packaging per the Pricing & Packaging Strategy document: three
  seeded plans (Starter, Growth, Scale) keyed to tracked-competitor-source
  volume, a trial that starts on first successful price check rather than
  at signup, and a soft usage nudge instead of a hard limit (`apps/api/src/services/billing.ts`).

Not yet built (Phase 2+): the scraping engine, real LLM-backed assistant
retrieval, e-commerce connectors.

## Running it locally

This scaffold was written in an environment with no package registry access,
so nothing has been `npm install`-ed or run here. To run it yourself:

```bash
# 1. Database
createdb marginview
psql marginview < apps/api/src/db/schema.sql

# 2. API
cd apps/api
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
npm install
npm run dev            # http://localhost:4000

# 3. Web
cd apps/web
npm install
npm run dev             # http://localhost:5173, proxies /api to the backend
```

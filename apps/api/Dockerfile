# Build from the repo root:  docker build -f apps/api/Dockerfile -t marginview-api .
# Includes Python + Scrapy so the API can fetch pages itself (SCRAPY_LOCAL=true) on single-container hosts.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w @marginview/api
COPY apps/api apps/api
RUN npm run build -w @marginview/api

FROM node:20-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci -w @marginview/web
COPY apps/web apps/web
# Demo.tsx imports the pricing maths straight from the API source, so that source must be present.
COPY apps/api/src apps/api/src
RUN npm run build -w @marginview/web

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w @marginview/api --omit=dev

FROM node:20-slim
ENV NODE_ENV=production SCRAPY_LOCAL=true
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY apps/scrapy/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app/apps/api
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist ./dist
# The API serves the built website, so one container is the whole app.
COPY --from=web /app/apps/web/dist /app/apps/web/dist
# Migrations are read from src/db at runtime (see db/migrate.ts).
COPY apps/api/src/db ./src/db
COPY apps/api/package.json ./
COPY apps/scrapy/fetch_spider.py /app/apps/scrapy/fetch_spider.py
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]

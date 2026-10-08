# Build from the repo root:  docker build -f apps/api/Dockerfile -t marginview-api .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w @marginview/api
COPY apps/api apps/api
RUN npm run build -w @marginview/api

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w @marginview/api --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist ./dist
# Migrations are read from src/db at runtime (see db/migrate.ts).
COPY apps/api/src/db ./src/db
COPY apps/api/package.json ./
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]

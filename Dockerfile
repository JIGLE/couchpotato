# syntax=docker/dockerfile:1

# ---- build: install everything and compile server + web ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

# ---- runtime: only what the server needs ----
FROM node:22-alpine AS runtime
# Set by the release workflow; shown at /healthz so you can see which build is running.
ARG APP_VERSION=dev
ENV NODE_ENV=production PORT=3000 WEB_DIR=/app/web APP_VERSION=$APP_VERSION
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --workspace @couchpotato/server; else npm install --omit=dev --workspace @couchpotato/server; fi \
 && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "apps/server/dist/index.js"]

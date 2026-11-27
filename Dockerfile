# syntax=docker/dockerfile:1

# ---- Build: install production dependencies and build the frontend ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev

COPY web/frontend/package.json frontend/
RUN cd frontend && npm install --omit=dev --no-audit --no-fund

COPY web .
ARG SHOPIFY_API_KEY
RUN cd frontend \
  && SHOPIFY_API_KEY=$SHOPIFY_API_KEY npm run build \
  && find . -mindepth 1 -maxdepth 1 ! -name dist -exec rm -rf {} +

# ---- Runtime ------------------------------------------------------------------
FROM node:22-alpine
# tini forwards signals to Node and reaps zombies, so SIGTERM triggers the
# app's graceful shutdown.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=8081
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node

EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" > /dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# Run node directly (not via npm) so signals reach the app.
CMD ["node", "index.js"]

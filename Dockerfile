# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY . .
RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7930 \
    COMFY_PROXY_LOOPBACK_HOST=host.docker.internal

COPY --from=build /app/app-dist ./app-dist
COPY server ./server

EXPOSE 7930

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:7930/__infinity_health >/dev/null || exit 1

CMD ["node", "server/serve.mjs"]

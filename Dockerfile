# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7930 \
    COMFY_PROXY_LOOPBACK_HOST=host.docker.internal

COPY --from=build /app/dist ./dist
COPY server ./server

EXPOSE 7930

CMD ["node", "server/serve.mjs"]

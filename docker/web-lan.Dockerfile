# syntax=docker/dockerfile:1
# Build the LAN HTTPS edge with Caddy's internal CA configuration.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w @office/client
COPY tsconfig.base.json ./
COPY apps/client apps/client
COPY packages/shared packages/shared
ENV VITE_ONLINE=1
RUN npm run build -w @office/client

FROM caddy:2-alpine
COPY docker/Caddyfile.lan /etc/caddy/Caddyfile
COPY --from=build /app/apps/client/dist /srv
EXPOSE 80 443

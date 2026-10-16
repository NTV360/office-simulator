# syntax=docker/dockerfile:1
# Build the LAN HTTPS edge: Caddy serving the client over HTTPS, with certificates from Caddy's internal CA (default) or from Let's Encrypt.
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

# Caddy with the Cloudflare DNS plugin (for real Let's Encrypt certificates by the DNS-01 challenge: LAN_TLS=cloudflare; see docker/caddy-tls/).
FROM caddy:2-builder-alpine AS caddy-build
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine
COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
COPY docker/Caddyfile.lan /etc/caddy/Caddyfile
COPY docker/caddy-tls /etc/caddy/tls
COPY --from=build /app/apps/client/dist /srv
COPY docker/lan-setup.html /srv-setup/index.html
EXPOSE 80 443

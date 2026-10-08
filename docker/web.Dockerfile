# syntax=docker/dockerfile:1
# Build context is the repository root (it needs to see the workspaces).

FROM node:22-alpine AS build
WORKDIR /app
# Manifests first so the dependency layer is cached until a package.json changes.
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w @office/client
COPY apps/client apps/client
RUN npm run build -w @office/client

FROM caddy:2-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/client/dist /srv
EXPOSE 80

# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY --from=ghcr.io/pnpm/pnpm:12.15.0-alpine /opt/pnpm /opt/pnpm
RUN ln -s /opt/pnpm/pnpm /usr/local/bin/pnpm
RUN pnpm config set store-dir /pnpm/store

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Keep fetched packages in a layer so GitHub's layer cache can restore them
# even on runners without a persistent BuildKit cache mount.
RUN pnpm fetch

COPY apps/web/package.json ./apps/web/package.json
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json
RUN pnpm install --filter @pixforge/web... --frozen-lockfile --offline --package-import-method=copy

FROM deps AS builder
COPY turbo.json ./
COPY packages/typescript-config ./packages/typescript-config
COPY apps/web ./apps/web

# Public links are embedded in Vite's static output, not read at runtime.
ARG VITE_RELEASES_URL=""
ARG VITE_GITHUB_URL=""
ENV VITE_RELEASES_URL=${VITE_RELEASES_URL}
ENV VITE_GITHUB_URL=${VITE_GITHUB_URL}
RUN pnpm --filter @pixforge/web build

FROM nginxinc/nginx-unprivileged:stable-alpine AS runner
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

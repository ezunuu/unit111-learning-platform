FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @unit111/api build
RUN corepack pnpm --filter @unit111/web build

# Retain migration tooling and versioned SQL for controlled release migrations.
FROM build AS api
ENV NODE_ENV=production API_PORT=4000
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]

FROM caddy:2 AS web
COPY --from=build /app/apps/web/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

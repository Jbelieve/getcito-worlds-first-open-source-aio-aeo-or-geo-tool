# Getcito
# Supports: web app (Nitro server) and worker

# Base stage with Node.js
FROM node:24-bookworm-slim AS base
RUN corepack enable pnpm
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Dependencies stage
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/ui/package.json ./packages/ui/
COPY packages/config/package.json ./packages/config/
COPY packages/lib/package.json ./packages/lib/
COPY packages/local/package.json ./packages/local/
COPY packages/whitelabel/package.json ./packages/whitelabel/
COPY packages/deployment/package.json ./packages/deployment/
COPY packages/og/package.json ./packages/og/
COPY packages/api-spec/package.json ./packages/api-spec/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Builder stage
FROM base AS builder
WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/node_modules
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=deps /app/packages/lib/node_modules ./packages/lib/node_modules
COPY --from=deps /app/packages/local/node_modules ./packages/local/node_modules
COPY --from=deps /app/packages/whitelabel/node_modules ./packages/whitelabel/node_modules
COPY --from=deps /app/packages/deployment/node_modules ./packages/deployment/node_modules
COPY --from=deps /app/packages/og/node_modules ./packages/og/node_modules

# Copy source code
COPY . .

# Build arguments for VITE_ env vars (baked into client bundle)
ARG DEPLOYMENT_MODE=local
ARG VITE_DEPLOYMENT_MODE=${DEPLOYMENT_MODE}
ARG VITE_APP_NAME
ARG VITE_APP_ICON
ARG VITE_APP_URL
ARG VITE_APP_PARENT_NAME
ARG VITE_APP_PARENT_URL
ARG VITE_OPTIMIZATION_URL_TEMPLATE
ARG VITE_ONBOARDING_REDIRECT_URL_TEMPLATE
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_APP_TIMEZONE
ARG VITE_APP_LOCALE
ENV VITE_DEPLOYMENT_MODE=${VITE_DEPLOYMENT_MODE}
ENV VITE_APP_NAME=${VITE_APP_NAME}
ENV VITE_APP_ICON=${VITE_APP_ICON}
ENV VITE_APP_URL=${VITE_APP_URL}
ENV VITE_APP_PARENT_NAME=${VITE_APP_PARENT_NAME}
ENV VITE_APP_PARENT_URL=${VITE_APP_PARENT_URL}
ENV VITE_OPTIMIZATION_URL_TEMPLATE=${VITE_OPTIMIZATION_URL_TEMPLATE}
ENV VITE_ONBOARDING_REDIRECT_URL_TEMPLATE=${VITE_ONBOARDING_REDIRECT_URL_TEMPLATE}
ENV VITE_AUTH0_DOMAIN=${VITE_AUTH0_DOMAIN}
ENV VITE_AUTH0_CLIENT_ID=${VITE_AUTH0_CLIENT_ID}
ENV VITE_APP_TIMEZONE=${VITE_APP_TIMEZONE}
ENV VITE_APP_LOCALE=${VITE_APP_LOCALE}

# Build the web application (increase heap for large bundles)
RUN pnpm --filter @workspace/web build

# Runner stage for web app (Nitro)
FROM base AS web
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 getcito

# Copy entrypoint script
COPY docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Copy Nitro output - this is the entire server bundle
COPY --from=builder --chown=getcito:nodejs /app/apps/web/.output ./.output

# @takumi-rs/wasm is loaded by a dynamic import at runtime, so Nitro leaves the
# bare specifier in the server bundle. Copy the package for OG image rendering
# instead of shipping all node_modules.
COPY --from=builder --chown=getcito:nodejs /app/node_modules/.pnpm/@takumi-rs+wasm@*/node_modules/@takumi-rs/wasm ./node_modules/@takumi-rs/wasm
COPY --from=builder --chown=getcito:nodejs /app/node_modules/.pnpm/@takumi-rs+helpers@*/node_modules/@takumi-rs/helpers ./node_modules/@takumi-rs/helpers

USER getcito

EXPOSE 3000
ENV PORT=3000
ENV HOST="0.0.0.0"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]

# Migration stage — runs drizzle-kit migrate then exits
FROM base AS migrate
WORKDIR /app

COPY --from=builder /app ./
WORKDIR /app/packages/lib

CMD ["npx", "drizzle-kit", "migrate"]

# Worker stage
FROM base AS worker
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 worker

COPY docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

COPY --from=builder --chown=worker:nodejs /app ./

USER worker

ENTRYPOINT ["/entrypoint.sh"]
WORKDIR /app/apps/worker
CMD ["npx", "tsx", "src/index.ts"]

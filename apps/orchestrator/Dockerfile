# ---------- build stage ----------
FROM node:20-alpine AS build

RUN corepack enable

WORKDIR /app

# Copy the whole monorepo so workspace resolution works.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY apps/orchestrator ./apps/orchestrator

RUN pnpm install --frozen-lockfile=false

RUN pnpm --filter @agentboard/orchestrator build

# ---------- runtime stage ----------
FROM node:20-alpine AS runtime

RUN corepack enable \
  && npm install -g pm2 \
  && apk add --no-cache git

WORKDIR /app

COPY --from=build /app /app

ENV NODE_ENV=production

EXPOSE 3001

# Launch via PM2 (single source of truth for restart policy).
CMD ["pm2-runtime", "start", "ecosystem.config.cjs", "--only", "orchestrator"]

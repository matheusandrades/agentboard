# syntax=docker/dockerfile:1.7

# -------- Build stage --------
FROM node:20-alpine AS build
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy workspace manifests first for better caching
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile=false --filter @agentboard/web... || pnpm install --filter @agentboard/web...

# Copy sources
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_WS_URL=${VITE_WS_URL}

RUN pnpm --filter @agentboard/web build

# -------- Runtime stage --------
FROM nginx:alpine AS runtime

COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

# SPA routing: fall back to index.html
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

FROM node:20-slim AS builder

RUN npm install -g pnpm@10
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/frontend/package.json ./packages/frontend/

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/frontend ./packages/frontend

# VITE_API_URL injetado no build via ARG
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --filter @rcs/shared build 2>/dev/null || true
RUN pnpm --filter @rcs/frontend build

FROM nginx:alpine
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

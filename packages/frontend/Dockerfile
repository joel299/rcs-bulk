FROM node:20-alpine AS builder

RUN npm install -g pnpm@9
WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY packages/shared ./packages/shared
COPY packages/frontend ./packages/frontend

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rcs/shared build
RUN pnpm --filter @rcs/frontend build

FROM nginx:alpine
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

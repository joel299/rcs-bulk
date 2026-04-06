# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Instala pnpm
RUN npm install -g pnpm@10

WORKDIR /app

# Copia manifests para instalar dependências com cache
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/

RUN pnpm install --frozen-lockfile

# Copia código-fonte
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Build do shared e backend
RUN pnpm --filter @rcs/shared build 2>/dev/null || true
RUN pnpm --filter @rcs/backend build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Dependências do sistema para Chromium + Playwright
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Diz ao Playwright para usar o Chromium do sistema
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN npm install -g pnpm@10

WORKDIR /app

# Copia manifests + node_modules do builder
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/

RUN pnpm install --frozen-lockfile --prod

# Copia build gerado
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist

EXPOSE 3002

CMD ["node", "packages/backend/dist/index.js"]

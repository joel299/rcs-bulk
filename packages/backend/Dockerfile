FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Instala pnpm
RUN npm install -g pnpm@9

# Copia workspace config
COPY pnpm-workspace.yaml ./
COPY package.json ./

# Copia shared e backend
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Instala dependências
RUN pnpm install

# Build shared primeiro
RUN pnpm --filter @rcs/shared build

# Build backend
RUN pnpm --filter @rcs/backend build

# Playwright browsers já vêm na imagem base
WORKDIR /app/packages/backend

EXPOSE 3000

CMD ["node", "dist/index.js"]

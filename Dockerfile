FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY scripts/prepare-assets.mjs scripts/prepare-assets.mjs
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY . .
ENV DATABASE_URL=file:/app/data/workbench.db
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production DATA_DIR=/app/data DATABASE_URL=file:/app/data/workbench.db PRIVATE_CLOUD=1
EXPOSE 4173
CMD ["node", "scripts/cloud-start.mjs"]

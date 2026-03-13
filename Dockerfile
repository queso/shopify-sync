FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Final image
FROM base
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# DATABASE_PATH defaults to ./data/shopify-sync.db — mount a PVC at /app/data
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["bun", "index.ts"]

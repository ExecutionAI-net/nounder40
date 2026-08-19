# syntax=docker/dockerfile:1

# ---- base: deps installed, source copied. Dev uses this target directly. ----
FROM node:22-slim AS base
WORKDIR /app

# Install dependencies from lockfile first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000
# Dev server; compose overrides the command explicitly to bind 0.0.0.0.
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]

# ---- builder: production build ----
FROM base AS builder
RUN npm run build

# ---- runner: minimal production image ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]

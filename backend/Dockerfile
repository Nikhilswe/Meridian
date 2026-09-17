# Multi-stage build. Build context is the REPO ROOT (see ../docker-compose.yml),
# so all paths below are relative to that root.

# ---------- Stage 1: build shared-types + backend ----------
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY backend/package.json backend/package.json

RUN npm install --workspace=packages/shared-types --workspace=backend --include-workspace-root

COPY packages/shared-types packages/shared-types
COPY backend backend
COPY tsconfig.base.json tsconfig.base.json

RUN npm run build --workspace=packages/shared-types
RUN npm run build --workspace=backend

# ---------- Stage 2: runtime ----------
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared-types/package.json packages/shared-types/package.json
COPY --from=builder /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=builder /app/backend/package.json backend/package.json
COPY --from=builder /app/backend/dist backend/dist
COPY backend/entrypoint.sh backend/entrypoint.sh

RUN chmod +x backend/entrypoint.sh

WORKDIR /app/backend
EXPOSE $PORT

ENTRYPOINT ["./entrypoint.sh"]

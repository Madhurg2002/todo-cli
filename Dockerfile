# todo.sh — single-container image (web + API + SSH TUI)
#
# Build:  docker build -t todo.sh .
# Run:    docker run -p 3000:3000 -p 2222:2222 -v todo-data:/app/.data todo.sh
#
# Data lives in /app/.data (accounts, sessions, per-user task files).
# Mount a volume there to persist across restarts. To use Postgres
# instead, pass DATABASE_URL and mount nothing — accounts, sessions and
# tasks all move to the database, which is what allows a disk-less host.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SSH_PORT=2222 \
    TODO_DATA_DIR=/app/.data

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN mkdir -p /app/.data && npm run build:web

EXPOSE 3000 2222
VOLUME ["/app/.data"]

USER node
CMD ["node", "apps/backend/server/all.js"]

# Build context is the repo root (see docker-compose.yml, same as web/Dockerfile) — api/watch/
# needs frontend/src/lib/ available to COPY, since it imports the training logic straight from
# there rather than duplicating it (see docs/WATCH_APP.md).
FROM node:25-alpine
WORKDIR /app/api

# ── AI Coach runtimes ─────────────────────────────────────────────────────────
# Claude's Agent SDK ships with its matching native runtime. Codex is installed as a local
# package so the Coach uses a pinned CLI rather than an arbitrary host binary. Its ChatGPT
# device-code login keeps credentials in the dedicated /codex bind mount, never in this image.
# libgcc/libstdc++ support the native runtimes on Alpine; bubblewrap enforces the Codex
# workspace-only permission profile for agent-spawned commands on Linux.
RUN apk add --no-cache bubblewrap libgcc libstdc++

# Coach jobs run as this user, which is not root and cannot read /data (chmod 0700 at boot).
# The Agent SDK runtime therefore sees its job's temp directory and nothing else — no state files, no
# db.json, no session secret, no provider credential.
RUN addgroup -S coach && adduser -S -G coach -H -s /sbin/nologin coach

COPY api/package.json api/package-lock.json* ./
RUN npm ci --omit=dev --include=optional \
 && npm cache clean --force \
 && node -e "import('@anthropic-ai/claude-agent-sdk').then(() => console.log('Claude Agent SDK ready'))" \
 && ./node_modules/.bin/codex --version
COPY api/server.js api/store.js api/password.js ./
COPY api/coach/ ./coach/
COPY api/watch/ ./watch/
COPY frontend/src/lib/ /app/frontend/src/lib/
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]

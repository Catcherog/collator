# syntax=docker/dockerfile:1.7
# Collator V1 Core Service — minimal production image.
# Multi-stage build: builder (full deps + tsc compile) -> runtime (prod deps + dist + legacy modules).

FROM node:20-bookworm-slim AS builder
WORKDIR /app
# Copy lockfile + manifest first for cache-friendly install.
COPY package.json package-lock.json ./
RUN npm ci
# Copy tsconfig + source. .dockerignore filters secrets/artifacts/temp scripts.
COPY tsconfig.json tsconfig.test.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    TASK_REPOSITORY=memory \
    LOG_LEVEL=info
# Install production deps only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force
# Copy compiled output from builder.
COPY --from=builder /app/dist ./dist
# Copy Legacy source modules required at runtime by the LegacyModuleLoader
# (reads src/data-cleaning/**/*.js via fs.readFileSync at /app/src/data-cleaning).
COPY --from=builder /app/src/data-cleaning ./src/data-cleaning
# Copy legacy module profiles (runtime data required by legacy-audit.ts loadProfiles).
# .dockerignore excludes reports/ except this file.
COPY reports/phase2/legacy-module-profiles.json ./reports/phase2/legacy-module-profiles.json
# Run as the non-root node user provided by the official image (uid 1000).
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'8787')+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/app.js"]

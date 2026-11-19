# Production image for Cloud Run: API + dashboard + video worker in one container.
#   docker build -t affiliate-video-app .
# Debian 13 (trixie) ships FFmpeg 7.1 built with libass + HarfBuzz — needed for Thai/Myanmar captions.

# ---- 1) build the React dashboard
FROM node:22-trixie-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/web --include-workspace-root=false
COPY apps/web apps/web
RUN npm --workspace apps/web run build

# ---- 2) runtime
FROM node:22-trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -hide_banner -filters | grep -q " ass " # fail the build if libass is missing
WORKDIR /app
ENV NODE_ENV=production \
    WEB_DIST=/app/apps/web/dist \
    STORAGE_DIR=/data \
    WORK_DIR=/tmp/avs-work \
    TTS_PROVIDER=gemini
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/providers/package.json packages/providers/
COPY packages/video-engine/package.json packages/video-engine/
RUN npm ci --omit=dev --workspace apps/api --workspace apps/worker --include-workspace-root=false \
 && npm cache clean --force
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY deploy/start.mjs deploy/start.mjs
COPY --from=web /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "deploy/start.mjs"]

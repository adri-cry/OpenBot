#!/bin/sh
# OpenBot, with this deployment's app build served from /root/openbot/app-dist.
# The image is pinned: the app dist is built from the same commit, and a moving :latest
# could change the API under a dist that no longer matches it. Update both together.
set -e
IMAGE=ghcr.io/copilotkit/openbot@sha256:479cccd42fc8942c98c7f326b065ca53cfd58f91d78fd1d5a2680b684e1a5f70
docker --context kiri rm -f openbot >/dev/null 2>&1 || true
docker --context kiri run -d --name openbot --restart unless-stopped \
  --network host --env-file /root/openbot/.env \
  -e EMBEDDED_POSTGRES=on -e APP_DIST_DIR=/app/app-dist \
  -v openbot-data:/var/lib/postgresql \
  -v /root/openbot/app-dist:/app/app-dist:ro \
  "$IMAGE" >/dev/null

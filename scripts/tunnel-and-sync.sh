#!/bin/bash
# Starts a Cloudflare quick tunnel to the opengym web container, waits for the
# assigned *.trycloudflare.com URL and writes it into .env as ORIGIN, then
# recreates the api container so it picks the new value up.
#
# The WebAuthn passkeys this script used to keep in step with RP_ID are gone —
# sign-in is a username and a password now (docs/AUTH.md), so a URL change no
# longer invalidates anything. ORIGIN is only what decides whether the session
# cookie is marked Secure. Runs in foreground for systemd.
set -euo pipefail

REPO_DIR="/home/ubuntu/opengym"
ENV_FILE="$REPO_DIR/.env"
LOG_FILE="/tmp/cloudflared-opengym.log"

cd "$REPO_DIR"

: > "$LOG_FILE"
cloudflared tunnel --url http://localhost:8080 >> "$LOG_FILE" 2>&1 &
CF_PID=$!

# Wait (up to 60s) for cloudflared to print the assigned quick-tunnel URL.
URL=""
for i in $(seq 1 60); do
    URL=$(grep -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' "$LOG_FILE" | head -n1 || true)
    if [ -n "$URL" ]; then
        break
    fi
    sleep 1
done

if [ -z "$URL" ]; then
    echo "cloudflared did not report a tunnel URL in time" >&2
    kill "$CF_PID" 2>/dev/null || true
    exit 1
fi

HOST="${URL#https://}"
echo "Tunnel ready: $URL"

if [ -f "$ENV_FILE" ]; then
    sed -i -e "s#^ORIGIN=.*#ORIGIN=${URL}#" "$ENV_FILE"
else
    cp "$REPO_DIR/.env.example" "$ENV_FILE"
    sed -i -e "s#^ORIGIN=.*#ORIGIN=${URL}#" "$ENV_FILE"
fi

docker compose up -d --force-recreate api

echo "openGym is live at: $URL"

# Keep the service alive as long as cloudflared runs.
wait "$CF_PID"

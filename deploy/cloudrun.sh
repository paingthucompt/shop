#!/usr/bin/env bash
# Deploy Affiliate Video Studio to Google Cloud Run (Singapore).
#
#   PROJECT_ID=my-project REDIS_URL='rediss://default:...@....upstash.io:6379' ./deploy/cloudrun.sh
#
# Creates (once) and reuses: Artifact Registry repo, Cloud SQL Postgres 16, a Cloud Storage bucket
# mounted at /data, Secret Manager secrets, and one Cloud Run service running API + dashboard + worker.
# Re-run it to deploy a new version: existing resources are kept, only the image and service update.
# Secrets are read from your local .env (GEMINI_API_KEY, LLM_*, SHOPEE_*) — never printed.
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID (gcloud projects list)}"
: "${REDIS_URL:?set REDIS_URL (e.g. an Upstash rediss:// URL)}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-affiliate-video}"
SQL_INSTANCE="${SQL_INSTANCE:-avs-db}"
SQL_TIER="${SQL_TIER:-db-f1-micro}"
BUCKET="${BUCKET:-${PROJECT_ID}-avs-media}"
REPO="${REPO:-avs}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/app:$(date +%Y%m%d-%H%M%S)"
ENV_FILE="${ENV_FILE:-.env}"

cd "$(dirname "$0")/.."
gcloud config set project "$PROJECT_ID" >/dev/null
# value of KEY in .env (surrounding quotes removed; empty when missing)
envval() { local v; v="$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)" || true; v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"; printf '%s' "$v"; }

echo "▶ enabling APIs"
gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com storage.googleapis.com >/dev/null

echo "▶ Artifact Registry"
gcloud artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION"

echo "▶ Cloud Storage bucket (uploads + videos, mounted at /data)"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access --public-access-prevention

echo "▶ Cloud SQL (Postgres 16) — the first run takes ~10 minutes"
if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$SQL_INSTANCE" --database-version POSTGRES_16 --edition ENTERPRISE \
    --tier "$SQL_TIER" --region "$REGION" --storage-size 10 --storage-auto-increase
  gcloud sql databases create affiliate_video --instance "$SQL_INSTANCE"
  DB_PASS="$(openssl rand -hex 24)"
  gcloud sql users create app --instance "$SQL_INSTANCE" --password "$DB_PASS"
  CONN="$(gcloud sql instances describe "$SQL_INSTANCE" --format 'value(connectionName)')"
  printf '%s' "postgres://app:${DB_PASS}@/affiliate_video?host=/cloudsql/${CONN}" > /tmp/avs-dburl
fi
CONN="$(gcloud sql instances describe "$SQL_INSTANCE" --format 'value(connectionName)')"

echo "▶ secrets"
put_secret() { # name value — creates the secret or adds a version when the value changed
  local name="$1" value="$2"
  [ -z "$value" ] && return 0
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    [ "$(gcloud secrets versions access latest --secret "$name" 2>/dev/null)" = "$value" ] && return 0
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  else
    printf '%s' "$value" | gcloud secrets create "$name" --replication-policy automatic --data-file=- >/dev/null
  fi
}
[ -f /tmp/avs-dburl ] && { put_secret avs-database-url "$(cat /tmp/avs-dburl)"; rm -f /tmp/avs-dburl; }
gcloud secrets describe avs-jwt-secret >/dev/null 2>&1 || put_secret avs-jwt-secret "$(openssl rand -hex 32)"
put_secret avs-redis-url "$REDIS_URL"
put_secret avs-gemini-api-key "$(envval GEMINI_API_KEY)"
put_secret avs-llm-api-key "$(envval LLM_API_KEY)"
put_secret avs-shopee-secret "$(envval SHOPEE_SECRET)"

echo "▶ service account for the Cloud Run service"
SA="avs-run@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create avs-run --display-name "Affiliate Video Studio (Cloud Run)"
for role in roles/secretmanager.secretAccessor roles/cloudsql.client; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA" --role "$role" --condition None >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$SA" --role roles/storage.objectAdmin >/dev/null

echo "▶ building the image with Cloud Build"
gcloud builds submit --tag "$IMAGE" .

SECRETS="DATABASE_URL=avs-database-url:latest,JWT_SECRET=avs-jwt-secret:latest,REDIS_URL=avs-redis-url:latest"
gcloud secrets describe avs-gemini-api-key >/dev/null 2>&1 && SECRETS+=",GEMINI_API_KEY=avs-gemini-api-key:latest"
gcloud secrets describe avs-llm-api-key   >/dev/null 2>&1 && SECRETS+=",LLM_API_KEY=avs-llm-api-key:latest"
gcloud secrets describe avs-shopee-secret >/dev/null 2>&1 && SECRETS+=",SHOPEE_SECRET=avs-shopee-secret:latest"

# non-secret settings come from .env (image defaults when missing); "@" separates them because
# values may contain commas
ENV_VARS="NODE_ENV=production"
for k in CLIP_MODE TTS_PROVIDER TTS_PROVIDER_TH TTS_PROVIDER_MY GEMINI_TTS_VOICE GEMINI_VIDEO_MODEL GEMINI_VIDEO_DURATION GEMINI_VIDEO_RESOLUTION \
         LLM_BASE_URL LLM_MODEL JOB_CREDIT_COST SIGNUP_FREE_CREDITS SCRIPT_GEN_PER_HOUR SHOPEE_APP_ID SHOPEE_AFFILIATE_ENDPOINT; do
  v="$(envval "$k")"; [ -n "$v" ] && ENV_VARS+="@$k=$v"
done

echo "▶ deploying Cloud Run service $SERVICE"
# One always-on instance: the BullMQ worker must keep running between web requests
# (--no-cpu-throttling + min 1). max 1 keeps API and worker on the same /tmp and avoids double work.
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" \
  --service-account "$SA" --allow-unauthenticated --port 8080 --cpu 1 --memory 2Gi --timeout 300 \
  --min-instances 1 --max-instances 1 --no-cpu-throttling --execution-environment gen2 \
  --add-cloudsql-instances "$CONN" \
  --add-volume name=data,type=cloud-storage,bucket="$BUCKET" --add-volume-mount volume=data,mount-path=/data \
  --set-secrets "$SECRETS" \
  --set-env-vars "^@^$ENV_VARS"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "WEB_ORIGIN=$URL" >/dev/null
echo "✓ live at $URL"
echo "  database console: https://console.cloud.google.com/sql/instances/$SQL_INSTANCE/studio?project=$PROJECT_ID"

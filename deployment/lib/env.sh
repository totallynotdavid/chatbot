#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/validation.sh"

get_public_url() {
	local project_root="$1"
	local url_file="$project_root/.cloudflare-url"

	if [ -f "$url_file" ]; then
		cat "$url_file" | tr -d '\n\r'
	else
		prompt_required "PUBLIC_URL"
	fi
}

collect_whatsapp_config() {
	echo ""
	echo "WhatsApp Cloud API"

	WHATSAPP_TOKEN=$(prompt_required "WHATSAPP_TOKEN")
	WHATSAPP_PHONE_ID=$(prompt_required "WHATSAPP_PHONE_ID")
	WHATSAPP_WEBHOOK_VERIFY_TOKEN=$(prompt_required "WHATSAPP_WEBHOOK_VERIFY_TOKEN")
}

collect_calidda_config() {
	echo ""
	echo "Calidda FNB"

	CALIDDA_USERNAME=$(prompt_required "CALIDDA_USERNAME")
	CALIDDA_PASSWORD=$(prompt_secret "CALIDDA_PASSWORD")
}

collect_powerbi_config() {
	echo ""
	echo "PowerBI (Gaso)"

	POWERBI_RESOURCE_KEY=$(prompt_required "POWERBI_RESOURCE_KEY")
	POWERBI_REPORT_ID=$(prompt_required "POWERBI_REPORT_ID")
	POWERBI_DATASET_ID=$(prompt_required "POWERBI_DATASET_ID")
	POWERBI_MODEL_ID=$(prompt_required "POWERBI_MODEL_ID")
}

collect_optional_config() {
	echo ""
	echo "Optional Configuration"

	GEMINI_API_KEY=$(prompt_optional "GEMINI_API_KEY")
	WHATSAPP_GROUP_AGENT=$(prompt_optional "WHATSAPP_GROUP_AGENT")
	WHATSAPP_GROUP_DEV=$(prompt_optional "WHATSAPP_GROUP_DEV")
}

generate_env_file() {
	local output_file="$1"

	cat >"$output_file" <<EOF
NODE_ENV=production
LOG_LEVEL=info

PORT=3000
NOTIFIER_PORT=3001
FRONTEND_URL=http://localhost:5173

DB_PATH=./data/database.sqlite
UPLOAD_DIR=./data/uploads
JWT_SECRET=$JWT_SECRET
PUBLIC_URL=$PUBLIC_URL

NOTIFIER_URL=http://localhost:3001
NOTIFIER_DATA_PATH=./data/notifier
BACKEND_URL=http://localhost:3000

WHATSAPP_GROUP_AGENT=$WHATSAPP_GROUP_AGENT
WHATSAPP_GROUP_DEV=$WHATSAPP_GROUP_DEV

WHATSAPP_TOKEN=$WHATSAPP_TOKEN
WHATSAPP_PHONE_ID=$WHATSAPP_PHONE_ID
WHATSAPP_WEBHOOK_VERIFY_TOKEN=$WHATSAPP_WEBHOOK_VERIFY_TOKEN

CALIDDA_BASE_URL=https://appweb.calidda.com.pe
CALIDDA_USERNAME=$CALIDDA_USERNAME
CALIDDA_PASSWORD=$CALIDDA_PASSWORD

POWERBI_RESOURCE_KEY=$POWERBI_RESOURCE_KEY
POWERBI_REPORT_ID=$POWERBI_REPORT_ID
POWERBI_DATASET_ID=$POWERBI_DATASET_ID
POWERBI_MODEL_ID=$POWERBI_MODEL_ID

GEMINI_API_KEY=$GEMINI_API_KEY
EOF
}

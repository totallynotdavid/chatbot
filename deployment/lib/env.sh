#!/usr/bin/env bash

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$LIB_DIR/validation.sh"
source "$LIB_DIR/envfile.sh"

get_public_url() {
    local root="$1"
    local file="$root/.cloudflare-url"
    
    if [ -f "$file" ]; then
        local url=$(trim "$(cat "$file")")
        is_valid "$url" || {
            echo "Error: Invalid .cloudflare-url" >&2
            exit 1
        }
        echo "$url"
        return 0
    fi
    
    prompt_required "PUBLIC_URL"
}

collect_whatsapp_vars() {
    echo "WhatsApp Cloud API"
    WHATSAPP_TOKEN=$(prompt_required "WHATSAPP_TOKEN")
    WHATSAPP_PHONE_ID=$(prompt_required "WHATSAPP_PHONE_ID")
    WHATSAPP_WEBHOOK_VERIFY_TOKEN=$(prompt_required "WHATSAPP_WEBHOOK_VERIFY_TOKEN")
}

collect_calidda_vars() {
    echo "Calidda FNB"
    CALIDDA_USERNAME=$(prompt_required "CALIDDA_USERNAME")
    CALIDDA_PASSWORD=$(prompt_secret "CALIDDA_PASSWORD")
}

collect_powerbi_vars() {
    echo "PowerBI"
    POWERBI_RESOURCE_KEY=$(prompt_required "POWERBI_RESOURCE_KEY")
    POWERBI_REPORT_ID=$(prompt_required "POWERBI_REPORT_ID")
    POWERBI_DATASET_ID=$(prompt_required "POWERBI_DATASET_ID")
    POWERBI_MODEL_ID=$(prompt_required "POWERBI_MODEL_ID")
}

collect_optional_vars() {
    echo "Optional"
    GEMINI_API_KEY=$(prompt_optional "GEMINI_API_KEY")
    WHATSAPP_GROUP_AGENT=$(prompt_optional "WHATSAPP_GROUP_AGENT")
    WHATSAPP_GROUP_DEV=$(prompt_optional "WHATSAPP_GROUP_DEV")
}

setup_environment() {
    local root="$1"
    local env_file="$root/.env.production"
    
    [ -f "$env_file" ] && return 0
    
    JWT_SECRET=$(openssl rand -base64 32)
    PUBLIC_URL=$(get_public_url "$root")
    
    collect_whatsapp_vars
    collect_calidda_vars
    collect_powerbi_vars
    collect_optional_vars
    
    generate_env_file "$env_file"
}

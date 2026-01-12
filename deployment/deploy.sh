#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_USER="${SUDO_USER:-$USER}"

install_mise() {
    if ! command -v mise &> /dev/null; then
        curl https://mise.run | sh
        export PATH="$HOME/.local/bin:$PATH"
    fi
    eval "$(mise activate bash)"
}

setup_tools() {
    cd "$PROJECT_ROOT"
    mise install
    local bun_path=$(mise where bun)/bin/bun
    sudo setcap 'cap_net_bind_service=+ep' "$bun_path"
    [ ! -L /usr/local/bin/bun ] && sudo ln -sf "$bun_path" /usr/local/bin/bun
}

setup_env() {
    [ -f "$PROJECT_ROOT/.env.production" ] && return
    cat > "$PROJECT_ROOT/.env.production" << 'EOF'
# ENVIRONMENT
NODE_ENV=production
LOG_LEVEL=info

# SERVICES (ports in sequence: 3000, 3001, 5173)
PORT=3000
NOTIFIER_PORT=3001
FRONTEND_URL=http://localhost:5173

# BACKEND
DB_PATH=./data/database.sqlite
UPLOAD_DIR=./data/uploads
JWT_SECRET=
PUBLIC_URL=

# NOTIFIER (team notifications via whatsapp-web.js)
NOTIFIER_URL=http://localhost:3001
NOTIFIER_DATA_PATH=./data/notifier
BACKEND_URL=http://localhost:3000

# WhatsApp groups (optional, can be auto-registered with @activate)
WHATSAPP_GROUP_AGENT=
WHATSAPP_GROUP_DEV=

# WHATSAPP CLOUD API (required in production)
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=

# EXTERNAL PROVIDERS
# Calidda FNB
CALIDDA_BASE_URL=https://appweb.calidda.com.pe
CALIDDA_USERNAME=
CALIDDA_PASSWORD=

# Calidda Gaso (PowerBI)
POWERBI_RESOURCE_KEY=
POWERBI_REPORT_ID=
POWERBI_DATASET_ID=
POWERBI_MODEL_ID=

# LLM
GEMINI_API_KEY=
EOF
}

build() {
    cd "$PROJECT_ROOT"
    [ ! -d "node_modules" ] && bun install
    cd apps/frontend && bun run build
}

install_service() {
    local template="$PROJECT_ROOT/deployment/systemd/$1.service"
    sed "s|DEPLOY_USER|$DEPLOY_USER|g; s|PROJECT_ROOT|$PROJECT_ROOT|g" "$template" \
        | sudo tee "/etc/systemd/system/$1.service" > /dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable "$1"
    sudo systemctl restart "$1"
}

install_mise
setup_tools
setup_env
build
install_service totem-backend
install_service totem-frontend
install_service totem-notifier

echo "http://$(hostname -I | awk '{print $1}')"

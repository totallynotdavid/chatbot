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
NODE_ENV=production
BACKEND_URL=http://localhost:3001
PORT=3001
DATABASE_PATH=./data/database.sqlite
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

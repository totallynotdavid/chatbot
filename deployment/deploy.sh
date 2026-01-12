#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_USER="${SUDO_USER:-$USER}"
DEPLOY_HOME=$(eval echo "~$DEPLOY_USER")

[ ! -d "$SCRIPT_DIR/lib" ] && {
    echo "Error: Missing lib directory" >&2
    exit 1
}

source "$SCRIPT_DIR/lib/tools.sh"
source "$SCRIPT_DIR/lib/build.sh"
source "$SCRIPT_DIR/lib/env.sh"
source "$SCRIPT_DIR/lib/envfile.sh"
source "$SCRIPT_DIR/lib/services.sh"

main() {
    echo "==> Installing tools"
    install_mise "$DEPLOY_HOME"
    setup_bun "$PROJECT_ROOT" "$DEPLOY_HOME"
    
    echo "==> Setting up environment"
    setup_environment "$PROJECT_ROOT"
    
    echo "==> Building project"
    build_project "$PROJECT_ROOT"
    
    echo "==> Installing services"
    install_all_services "$DEPLOY_USER" "$DEPLOY_HOME" "$PROJECT_ROOT"
    
    local ip=$(hostname -I | awk '{print $1}')
    echo "==> Deployment complete: http://$ip"
}

main

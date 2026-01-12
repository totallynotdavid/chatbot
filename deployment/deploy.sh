#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_USER="${SUDO_USER:-$USER}"

source "$SCRIPT_DIR/lib/tools.sh"
source "$SCRIPT_DIR/lib/env.sh"
source "$SCRIPT_DIR/lib/services.sh"

setup_environment() {
	local env_file="$PROJECT_ROOT/.env.production"

	if [ -f "$env_file" ]; then
		echo ".env.production exists"
		return
	fi

    echo "==="
	echo "Environment setup"
    echo "==="

	JWT_SECRET=$(openssl rand -base64 32)
	echo "Generated JWT_SECRET"

	PUBLIC_URL=$(get_public_url "$PROJECT_ROOT")
	echo "PUBLIC_URL configured"

	collect_whatsapp_config
	collect_calidda_config
	collect_powerbi_config
	collect_optional_config

	generate_env_file "$env_file"
	echo ".env.production created"
}

main() {
	install_mise
	setup_tools "$PROJECT_ROOT"
	setup_environment
	build_project "$PROJECT_ROOT"
	install_all_services "$DEPLOY_USER" "$PROJECT_ROOT"

	echo ""
	echo "Deployment complete!"
	echo "Server: http://$(hostname -I | awk '{print $1}')"
}

main

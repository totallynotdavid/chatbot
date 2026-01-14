#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PROVIDED_ENV="${1:-}"

[ ! -d "$SCRIPT_DIR/lib" ] && {
	echo "Error: Missing lib directory" >&2
	exit 1
}

source "$SCRIPT_DIR/lib/output.sh"
source "$SCRIPT_DIR/lib/preflight.sh"
source "$SCRIPT_DIR/lib/bun.sh"
source "$SCRIPT_DIR/lib/system.sh"
source "$SCRIPT_DIR/lib/env.sh"
source "$SCRIPT_DIR/lib/build.sh"
source "$SCRIPT_DIR/lib/service-install.sh"

deploy_as_system() {
	local source_root="$1"
	local env_file="$2"

	local repo_url=$(git -C "$source_root" config --get remote.origin.url 2>/dev/null || echo "https://github.com/totallynotdavid/totem")

	setup_system_deployment "$repo_url"
	copy_env_to_system "$source_root" "$env_file"

	sudo -H -u totem bash <<'EOSCRIPT'
        export HOME=/opt/totem
        bun_bin="$HOME/.bun/bin/bun"

        if [ ! -x "$bun_bin" ]; then
            curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
            echo "  ✓ bun installed"
        else
            echo "  ✓ bun already installed"
        fi
EOSCRIPT

	local bun_bin=$(get_bun_path "/opt/totem")
	set_bun_capabilities "$bun_bin"
	symlink_bun_globally "$bun_bin"
}

deploy_as_user() {
	install_bun "$HOME"
	local bun_bin=$(get_bun_path "$HOME")
	set_bun_capabilities "$bun_bin"
}

main() {
	preflight_check "$PROJECT_ROOT"

	local deploy_user="${SUDO_USER:-$USER}"
	local deploy_home=$(eval echo "~$deploy_user")
	local project_root="$PROJECT_ROOT"

	step "Installing Bun runtime"
	if [ "$(id -u)" -eq 0 ]; then
		deploy_as_system "$PROJECT_ROOT" "$PROVIDED_ENV"
		deploy_user="totem"
		deploy_home="/opt/totem"
		project_root="/opt/totem"
	else
		deploy_as_user
	fi

	step "Setting up environment"
	setup_environment "$project_root" "$PROVIDED_ENV"

	step "Building project"
	local bun_bin=$(get_bun_path "$deploy_home")
	build_project "$project_root" "$bun_bin"

	step "Installing services"
	install_all_services "$deploy_user" "$deploy_home" "$project_root"

	local ip=$(hostname -I | awk '{print $1}')
	echo ""
	echo "Deployment complete: http://$ip"
}

main

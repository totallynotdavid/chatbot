#!/usr/bin/env bash

install_mise() {
	if command -v mise &>/dev/null; then
		echo "mise already installed"
		return
	fi

	echo "Installing mise..."
	curl https://mise.run | sh
	export PATH="$HOME/.local/bin:$PATH"
	eval "$(mise activate bash)"
	echo "mise installed"
}

setup_tools() {
	local project_root="$1"

	cd "$project_root"
	mise install

	local bun_path=$(mise where bun)/bin/bun
	sudo setcap 'cap_net_bind_service=+ep' "$bun_path"

	if [ ! -L /usr/local/bin/bun ]; then
		sudo ln -sf "$bun_path" /usr/local/bin/bun
	fi

	echo "tools configured"
}

build_project() {
	local project_root="$1"

	cd "$project_root"

	if [ ! -d "node_modules" ]; then
		bun install
	fi

	cd apps/frontend
	bun run build

	echo "project built"
}

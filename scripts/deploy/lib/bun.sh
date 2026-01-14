install_bun() {
	local home="$1"
	local bun_bin="$home/.bun/bin/bun"

	[ -x "$bun_bin" ] && {
		substep "bun already installed"
		return 0
	}

	curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || {
		echo "Error: Failed to install bun" >&2
		exit 1
	}

	substep "bun installed"
}

get_bun_path() {
	local home="$1"
	echo "$home/.bun/bin/bun"
}

set_bun_capabilities() {
	local bun_bin="$1"

	[ ! -f "$bun_bin" ] && {
		echo "Error: Bun not found at $bun_bin" >&2
		exit 1
	}

	sudo setcap 'cap_net_bind_service=+ep' "$bun_bin" 2>/dev/null || {
		echo "Error: Failed to set bun capabilities" >&2
		exit 1
	}
}

symlink_bun_globally() {
	local bun_bin="$1"

	[ -L /usr/local/bin/bun ] && return 0

	sudo ln -sf "$bun_bin" /usr/local/bin/bun 2>/dev/null || true
}

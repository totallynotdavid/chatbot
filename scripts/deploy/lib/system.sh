SYSTEM_USER="totem"
SYSTEM_HOME="/opt/totem"
SYSTEM_ETC="/etc/totem"
SYSTEM_VAR="/var/lib/totem"
SYSTEM_LOG="/var/log/totem"

create_system_user() {
	id "$SYSTEM_USER" >/dev/null 2>&1 && return 0

	useradd --system --shell /usr/sbin/nologin --home "$SYSTEM_HOME" "$SYSTEM_USER" >/dev/null 2>&1 || {
		echo "Error: Failed to create system user" >&2
		exit 1
	}

	substep "created system user: $SYSTEM_USER"
}

create_system_directories() {
	mkdir -p "$SYSTEM_HOME" "$SYSTEM_ETC" "$SYSTEM_VAR" "$SYSTEM_LOG"
	chown -R "$SYSTEM_USER":"$SYSTEM_USER" "$SYSTEM_HOME" "$SYSTEM_ETC" "$SYSTEM_VAR" "$SYSTEM_LOG"
}

clone_system_repository() {
	local repo_url="$1"

	[ -d "$SYSTEM_HOME/.git" ] && {
		substep "repository already cloned"
		return 0
	}

	sudo -u "$SYSTEM_USER" git clone --quiet --recurse-submodules "$repo_url" "$SYSTEM_HOME" || {
		echo "Error: git clone failed" >&2
		exit 1
	}

	substep "repository cloned"
}

setup_system_deployment() {
	local repo_url="$1"

	create_system_user
	create_system_directories
	clone_system_repository "$repo_url"
}

copy_env_to_system() {
	local source_root="$1"
	local provided_env="$2"
	local target="$SYSTEM_ETC/.env.production"

	[ -f "$target" ] && return 0

	local source_file=""
	if [ -n "$provided_env" ]; then
		source_file="$provided_env"
	elif [ -f "$source_root/.env.production" ]; then
		source_file="$source_root/.env.production"
	else
		return 0
	fi

	cp "$source_file" "$target" 2>/dev/null || {
		echo "Error: Failed to copy env file" >&2
		exit 1
	}

	chown "$SYSTEM_USER":"$SYSTEM_USER" "$target"

	sed -i 's|^DB_PATH=.*|DB_PATH=/var/lib/totem/database.sqlite|' "$target" 2>/dev/null || true
	sed -i 's|^UPLOAD_DIR=.*|UPLOAD_DIR=/var/lib/totem/uploads|' "$target" 2>/dev/null || true
	sed -i 's|^NOTIFIER_DATA_PATH=.*|NOTIFIER_DATA_PATH=/var/lib/totem/notifier|' "$target" 2>/dev/null || true
}

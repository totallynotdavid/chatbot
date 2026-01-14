preflight_check() {
	local root="$1"

	[ ! -f "$root/package.json" ] && {
		echo "Error: Not a valid project root" >&2
		exit 1
	}

	[ ! -d "$root/apps/backend" ] || [ ! -d "$root/apps/frontend" ] || [ ! -d "$root/apps/notifier" ] && {
		echo "Error: Missing required app directories" >&2
		exit 1
	}

	[ "$(id -u)" -eq 0 ] && [ -z "${SUDO_USER:-}" ] && {
		echo "Error: Do not run as root directly, use sudo" >&2
		exit 1
	}

	if [ "$(id -u)" -ne 0 ]; then
		command -v sudo >/dev/null 2>&1 || {
			echo "Error: sudo is required for non-root deployment" >&2
			exit 1
		}
	fi
}

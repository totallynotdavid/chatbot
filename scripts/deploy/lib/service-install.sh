source "$(dirname "${BASH_SOURCE[0]}")/service-template.sh"

service_needs_update() {
	local name="$1"
	local new_content="$2"
	local target="/etc/systemd/system/totem-$name.service"

	[ ! -f "$target" ] && return 0

	local current=$(sudo cat "$target" 2>/dev/null || echo "")
	[ "$current" != "$new_content" ]
}

install_service() {
	local name="$1"
	local user="$2"
	local home="$3"
	local root="$4"

	local template=$(find_service_template "$name" "$root")
	local content=$(render_service_template "$template" "$user" "$home" "$root")
	content=$(add_writable_paths "$content" "$root")

	local target="/etc/systemd/system/totem-$name.service"

	if service_needs_update "$name" "$content"; then
		echo "$content" | sudo tee "$target" >/dev/null
		sudo systemctl daemon-reload
		sudo systemctl enable "totem-$name" >/dev/null 2>&1
		sudo systemctl restart "totem-$name"
		substep "$name (restarted)"
	else
		if ! sudo systemctl is-active --quiet "totem-$name"; then
			sudo systemctl start "totem-$name"
			substep "$name (started)"
		else
			substep "$name (running)"
		fi
	fi

	sudo systemctl is-active --quiet "totem-$name" || {
		echo "Error: totem-$name failed to start" >&2
		sudo systemctl status "totem-$name" --no-pager -n 20 >&2
		exit 1
	}
}

install_all_services() {
	local user="$1"
	local home="$2"
	local root="$3"

	install_service "backend" "$user" "$home" "$root"
	install_service "frontend" "$user" "$home" "$root"
	install_service "notifier" "$user" "$home" "$root"
}

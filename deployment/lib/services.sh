#!/usr/bin/env bash

service_file_changed() {
	local service_name="$1"
	local deploy_user="$2"
	local project_root="$3"

	local template="$project_root/deployment/systemd/$service_name.service"
	local service_file="/etc/systemd/system/$service_name.service"

	if [ ! -f "$service_file" ]; then
		return 0
	fi

	local new_content=$(sed "s|DEPLOY_USER|$deploy_user|g; s|PROJECT_ROOT|$project_root|g" "$template")
	local old_content=$(sudo cat "$service_file" 2>/dev/null || echo "")

	[ "$new_content" != "$old_content" ]
}

install_service() {
	local service_name="$1"
	local deploy_user="$2"
	local project_root="$3"

	local template="$project_root/deployment/systemd/$service_name.service"
	local service_file="/etc/systemd/system/$service_name.service"

	if [ ! -f "$template" ]; then
		echo "Error: Service template not found: $template" >&2
		exit 1
	fi

	local needs_update=false

	if service_file_changed "$service_name" "$deploy_user" "$project_root"; then
		sed "s|DEPLOY_USER|$deploy_user|g; s|PROJECT_ROOT|$project_root|g" "$template" |
			sudo tee "$service_file" >/dev/null
		sudo systemctl daemon-reload
		needs_update=true
		echo "$service_name configuration updated"
	fi

	if ! sudo systemctl is-enabled --quiet "$service_name" 2>/dev/null; then
		sudo systemctl enable "$service_name"
		needs_update=true
	fi

	if [ "$needs_update" = true ]; then
		sudo systemctl restart "$service_name"
	fi

	if ! sudo systemctl is-active --quiet "$service_name"; then
		echo "Error: $service_name failed to start" >&2
		sudo systemctl status "$service_name" --no-pager
		exit 1
	fi

	if [ "$needs_update" = true ]; then
		echo "$service_name restarted"
	else
		echo "$service_name already running (no changes)"
	fi
}

install_all_services() {
	local deploy_user="$1"
	local project_root="$2"

	install_service "totem-backend" "$deploy_user" "$project_root"
	install_service "totem-frontend" "$deploy_user" "$project_root"
	install_service "totem-notifier" "$deploy_user" "$project_root"
}

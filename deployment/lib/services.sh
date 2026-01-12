#!/usr/bin/env bash

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

	sed "s|DEPLOY_USER|$deploy_user|g; s|PROJECT_ROOT|$project_root|g" "$template" |
		sudo tee "$service_file" >/dev/null

	sudo systemctl daemon-reload
	sudo systemctl enable "$service_name"
	sudo systemctl restart "$service_name"

	if ! sudo systemctl is-active --quiet "$service_name"; then
		echo "Warning: $service_name failed to start" >&2
		sudo systemctl status "$service_name" --no-pager
		return 1
	fi

	echo "$service_name installed and running"
}

install_all_services() {
	local deploy_user="$1"
	local project_root="$2"

	install_service "totem-backend" "$deploy_user" "$project_root"
	install_service "totem-frontend" "$deploy_user" "$project_root"
	install_service "totem-notifier" "$deploy_user" "$project_root"
}

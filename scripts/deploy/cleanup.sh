#!/usr/bin/env bash
# deployment/cleanup.sh
set -euo pipefail

FORCE=false
SERVICES_ONLY=false
KEEP_DATA=false
IS_SYSTEM_DEPLOY=false

for arg in "$@"; do
	case $arg in
	--force) FORCE=true ;;
	--services-only) SERVICES_ONLY=true ;;
	--keep-data) KEEP_DATA=true ;;
	*)
		echo "Unknown option: $arg" >&2
		exit 1
		;;
	esac
done

[ "$(id -u)" -eq 0 ] && IS_SYSTEM_DEPLOY=true

step() {
	echo "==> $1"
}

substep() {
	echo "  ✓ $1"
}

validate_path() {
	local path="$1"
	[[ "$path" == /opt/totem* ]] || [[ "$path" == /var/lib/totem* ]] ||
		[[ "$path" == /var/log/totem* ]] || [[ "$path" == /etc/totem* ]] || {
		echo "Error: Refusing to delete unexpected path: $path" >&2
		exit 1
	}
}

safe_remove() {
	local target="$1"
	[ ! -e "$target" ] && return 0
	validate_path "$target"
	sudo rm -rf "$target"
}

show_cleanup_plan() {
	echo ""
	echo "Cleanup plan"
	echo "============"
	echo ""

	echo "Services to remove:"
	for svc in backend frontend notifier; do
		if systemctl list-unit-files | grep -q "totem-$svc.service"; then
			echo "  • totem-$svc.service"
		fi
	done
	echo ""

	if [ "$SERVICES_ONLY" = true ]; then
		echo "Mode: Services only (keeping all files and data)"
		return
	fi

	if [ "$IS_SYSTEM_DEPLOY" = true ]; then
		echo "Directories to delete:"
		[ -d /opt/totem ] && echo "  • /opt/totem (application code)"
		[ -d /etc/totem ] && echo "  • /etc/totem (configuration)"
		[ -d /var/log/totem ] && echo "  • /var/log/totem (logs)"

		if [ "$KEEP_DATA" = false ]; then
			[ -d /var/lib/totem ] && echo "  • /var/lib/totem (data)"
		fi
		echo ""

		if [ -f /var/lib/totem/database.sqlite ]; then
			local timestamp=$(date +%Y%m%d_%H%M%S)
			echo "Database backup:"
			echo "  • /var/lib/totem/database.sqlite → ./totem_database_backup_$timestamp.sqlite"
			echo ""
		fi

		if id totem >/dev/null 2>&1; then
			echo "System user to remove:"
			echo "  • totem"
			echo ""
		fi
	else
		echo "Mode: User deployment"
		echo "  • Systemd services will be removed"
		echo "  • Project files remain untouched"
		echo ""
	fi

	[ "$KEEP_DATA" = true ] && echo "Note: Data directory will be preserved"
}

confirm_cleanup() {
	[ "$FORCE" = true ] && return 0

	echo ""
	read -p "Continue with cleanup? (yes/no): " confirm
	[ "$confirm" = "yes" ] || {
		echo "Cleanup cancelled"
		exit 0
	}
	echo ""
}

cleanup_services() {
	step "Removing services"

	for svc in backend frontend notifier; do
		local service="totem-$svc"

		if systemctl is-active --quiet "$service" 2>/dev/null; then
			sudo systemctl stop "$service"
			substep "$svc stopped"
		fi

		if systemctl is-enabled --quiet "$service" 2>/dev/null; then
			sudo systemctl disable "$service" >/dev/null 2>&1
		fi

		if [ -f "/etc/systemd/system/$service.service" ]; then
			sudo rm "/etc/systemd/system/$service.service"
			substep "$svc removed"
		fi
	done

	sudo systemctl daemon-reload
}

backup_database() {
	local db_path="/var/lib/totem/database.sqlite"
	[ ! -f "$db_path" ] && return 0

	step "Backing up database"

	local timestamp=$(date +%Y%m%d_%H%M%S)
	local backup_path="./totem_database_backup_$timestamp.sqlite"

	sudo cp "$db_path" "$backup_path"
	sudo chown "$SUDO_USER:$SUDO_USER" "$backup_path" 2>/dev/null ||
		sudo chown "$USER:$USER" "$backup_path" 2>/dev/null || true

	substep "Database saved to: $backup_path"
}

cleanup_system_deployment() {
	[ "$SERVICES_ONLY" = true ] && return 0

	backup_database

	step "Removing application files"

	safe_remove /opt/totem
	[ -d /opt/totem ] || substep "/opt/totem removed"

	safe_remove /etc/totem
	[ -d /etc/totem ] || substep "/etc/totem removed"

	safe_remove /var/log/totem
	[ -d /var/log/totem ] || substep "/var/log/totem removed"

	if [ "$KEEP_DATA" = false ]; then
		safe_remove /var/lib/totem
		[ -d /var/lib/totem ] || substep "/var/lib/totem removed"
	fi

	if id totem >/dev/null 2>&1; then
		step "Removing system user"
		sudo userdel totem 2>/dev/null || true
		substep "totem user removed"
	fi
}

cleanup_user_deployment() {
	echo ""
	substep "User deployment: Only services removed"
}

main() {
	show_cleanup_plan
	confirm_cleanup

	cleanup_services

	if [ "$IS_SYSTEM_DEPLOY" = true ]; then
		cleanup_system_deployment
	else
		cleanup_user_deployment
	fi

	echo ""
	echo "Cleanup complete!"
}

main

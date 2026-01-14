find_service_template() {
	local name="$1"
	local root="$2"

	local templates=(
		"$root/deployment/systemd/$name.service"
		"$root/deployment/systemd/totem-$name.service"
	)

	for template in "${templates[@]}"; do
		[ -f "$template" ] && {
			echo "$template"
			return 0
		}
	done

	echo "Error: Service template not found: $name" >&2
	exit 1
}

render_service_template() {
	local template="$1"
	local user="$2"
	local home="$3"
	local root="$4"

	sed -e "s|DEPLOY_USER|$user|g" \
		-e "s|DEPLOY_HOME|$home|g" \
		-e "s|PROJECT_ROOT|$root|g" \
		"$template"
}

add_writable_paths() {
	local content="$1"
	local root="$2"

	if echo "$content" | grep -q "ReadWritePaths="; then
		local paths="$root $root/data $root/apps/backend/data"
		for path in $paths; do
			if ! echo "$content" | grep -q "$path"; then
				content=$(echo "$content" | sed "s|ReadWritePaths=\(.*\)|ReadWritePaths=\1 $path|")
			fi
		done
	fi

	echo "$content"
}

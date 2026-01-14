needs_install() {
	local dir="$1"
	[ ! -d "$dir/node_modules" ]
}

build_project() {
	local root="$1"
	local bun="$2"

	mkdir -p "$root/data/uploads" "$root/data/notifier"

	if needs_install "$root"; then
		cd "$root"
		"$bun" install --silent || {
			echo "Error: Root dependencies failed" >&2
			exit 1
		}
		substep "root dependencies installed"
	fi

	if needs_install "$root/apps/backend"; then
		cd "$root/apps/backend"
		"$bun" install --silent || {
			echo "Error: Backend dependencies failed" >&2
			exit 1
		}
		substep "backend dependencies installed"
	fi

	cd "$root/apps/frontend"
	if [ ! -d "dist" ] || [ "package.json" -nt "dist" ]; then
		"$bun" run build || {
			echo "Error: Frontend build failed" >&2
			exit 1
		}
		substep "frontend built"
	else
		substep "frontend up to date"
	fi
}

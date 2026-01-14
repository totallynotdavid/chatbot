setup_nginx() {
	local nginx_config="/etc/nginx/sites-available/totem"
	local nginx_enabled="/etc/nginx/sites-enabled/totem"

	# Check if nginx is installed
	if ! command -v nginx &> /dev/null; then
		apt-get update && apt-get install -y nginx >/dev/null 2>&1
		substep "nginx installed"
	else
		substep "nginx already installed"
	fi

	# Ensure directories exist
	mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

	if [ ! -f "$nginx_config" ]; then
		cat >"$nginx_config" <<'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 10M;

    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
		ln -sf "$nginx_config" "$nginx_enabled"

		# Verify config syntax before reloading
		if ! nginx -t >/dev/null 2>&1; then
			echo "Error: nginx configuration is invalid" >&2
			return 1
		fi

		if ! systemctl reload nginx; then
			echo "Error: failed to reload nginx" >&2
			return 1
		fi
		substep "nginx configured"
	else
		substep "nginx already configured"
	fi
}

#!/usr/bin/env bash

install_service() {
    local name="$1"
    local user="$2"
    local home="$3"
    local root="$4"
    local template="$root/deployment/systemd/$name.service"
    local target="/etc/systemd/system/totem-$name.service"
    
    [ ! -f "$template" ] && {
        echo "Error: Service template not found: $name" >&2
        exit 1
    }
    
    local content
    content=$(sed "s|DEPLOY_USER|$user|g; s|DEPLOY_HOME|$home|g; s|PROJECT_ROOT|$root|g" "$template")
    
    local needs_restart=false
    
    if [ ! -f "$target" ] || [ "$(sudo cat "$target")" != "$content" ]; then
        echo "$content" | sudo tee "$target" >/dev/null
        sudo systemctl daemon-reload
        needs_restart=true
    fi
    
    sudo systemctl is-enabled --quiet "totem-$name" 2>/dev/null || {
        sudo systemctl enable "totem-$name" >/dev/null
        needs_restart=true
    }
    
    if [ "$needs_restart" = true ]; then
        sudo systemctl restart "totem-$name"
        echo "    $name: restarted"
    else
        echo "    $name: running"
    fi
    
    sudo systemctl is-active --quiet "totem-$name" || {
        echo "Error: totem-$name failed to start" >&2
        sudo systemctl status "totem-$name" --no-pager >&2
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

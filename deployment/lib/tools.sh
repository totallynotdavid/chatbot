#!/usr/bin/env bash

install_mise() {
    local home="$1"
    local mise_bin="$home/.local/bin/mise"
    
    if [ -x "$mise_bin" ]; then
        return 0
    fi
    
    curl -fsSL https://mise.run | sh >/dev/null 2>&1 || {
        echo "Error: Failed to install mise" >&2
        exit 1
    }
    
    if ! grep -q "mise activate bash" "$home/.bashrc" 2>/dev/null; then
        echo 'eval "$(~/.local/bin/mise activate bash)"' >> "$home/.bashrc"
    fi
}

setup_bun() {
    local root="$1"
    local home="$2"
    
    export PATH="$home/.local/bin:$PATH"
    eval "$($home/.local/bin/mise activate bash)"
    
    cd "$root" || {
        echo "Error: Invalid project root" >&2
        exit 1
    }
    
    mise trust --all >/dev/null 2>&1
    mise install >/dev/null 2>&1 || {
        echo "Error: mise install failed" >&2
        exit 1
    }
    
    local bun_path=$(mise where bun)/bin/bun
    [ ! -f "$bun_path" ] && {
        echo "Error: Bun executable not found" >&2
        exit 1
    }
    
    sudo setcap 'cap_net_bind_service=+ep' "$bun_path" >/dev/null 2>&1 || {
        echo "Error: Failed to set bun capabilities" >&2
        exit 1
    }
}

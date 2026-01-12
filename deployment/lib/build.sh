#!/usr/bin/env bash

build_project() {
    local root="$1"
    
    mkdir -p "$root/data/uploads" "$root/data/notifier"
    
    cd "$root" || exit 1
    [ ! -d "node_modules" ] && {
        bun install >/dev/null 2>&1 || {
            echo "Error: Root bun install failed" >&2
            exit 1
        }
    }
    
    cd "$root/apps/backend" || exit 1
    [ ! -d "node_modules" ] && {
        bun install >/dev/null 2>&1 || {
            echo "Error: Backend bun install failed" >&2
            exit 1
        }
    }
    
    cd "$root/apps/frontend" || exit 1
    bun run build >/dev/null 2>&1 || {
        echo "Error: Frontend build failed" >&2
        exit 1
    }
}

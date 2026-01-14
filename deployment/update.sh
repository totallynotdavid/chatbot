#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

source "$SCRIPT_DIR/lib/output.sh"

step "Stopping services"
sudo systemctl stop totem-backend totem-frontend totem-notifier

step "Pulling latest changes"
sudo -u totem git -C /opt/totem pull

step "Rebuilding project"
sudo -u totem bash -c 'cd /opt/totem && /opt/totem/.bun/bin/bun install'
sudo -u totem bash -c 'cd /opt/totem/apps/frontend && /opt/totem/.bun/bin/bun run build'

step "Starting services"
sudo systemctl start totem-backend totem-frontend totem-notifier

echo ""
echo "Update complete"

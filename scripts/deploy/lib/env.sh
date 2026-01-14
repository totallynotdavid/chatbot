source "$(dirname "${BASH_SOURCE[0]}")/validation.sh"
source "$(dirname "${BASH_SOURCE[0]}")/envfile.sh"

REQUIRED_VARS=(
	"JWT_SECRET"
	"PUBLIC_URL"
	"WHATSAPP_TOKEN"
	"WHATSAPP_PHONE_ID"
	"WHATSAPP_WEBHOOK_VERIFY_TOKEN"
	"CALIDDA_USERNAME"
	"CALIDDA_PASSWORD"
	"POWERBI_RESOURCE_KEY"
	"POWERBI_REPORT_ID"
	"POWERBI_DATASET_ID"
	"POWERBI_MODEL_ID"
)

validate_env_file() {
	local file="$1"

	[ ! -f "$file" ] && {
		echo "Error: Env file not found: $file" >&2
		exit 1
	}

	for var in "${REQUIRED_VARS[@]}"; do
		grep -q "^$var=" "$file" || {
			echo "Error: Missing required variable: $var" >&2
			exit 1
		}
	done
}

get_public_url() {
	local root="$1"
	local file="$root/.cloudflare-url"

	[ -f "$file" ] && {
		local url=$(trim "$(cat "$file")")
		is_valid "$url" && {
			echo "$url"
			return 0
		}
	}

	prompt_required "PUBLIC_URL"
}

collect_credentials() {
	echo ""
	echo "WhatsApp Cloud API Configuration"
	WHATSAPP_TOKEN=$(prompt_required "WHATSAPP_TOKEN")
	WHATSAPP_PHONE_ID=$(prompt_required "WHATSAPP_PHONE_ID")
	WHATSAPP_WEBHOOK_VERIFY_TOKEN=$(prompt_required "WHATSAPP_WEBHOOK_VERIFY_TOKEN")

	echo ""
	echo "Calidda FNB Configuration"
	CALIDDA_USERNAME=$(prompt_required "CALIDDA_USERNAME")
	CALIDDA_PASSWORD=$(prompt_secret "CALIDDA_PASSWORD")

	echo ""
	echo "PowerBI Configuration"
	POWERBI_RESOURCE_KEY=$(prompt_required "POWERBI_RESOURCE_KEY")
	POWERBI_REPORT_ID=$(prompt_required "POWERBI_REPORT_ID")
	POWERBI_DATASET_ID=$(prompt_required "POWERBI_DATASET_ID")
	POWERBI_MODEL_ID=$(prompt_required "POWERBI_MODEL_ID")

	echo ""
	echo "Optional Configuration"
	GEMINI_API_KEY=$(prompt_optional "GEMINI_API_KEY")
	WHATSAPP_GROUP_AGENT=$(prompt_optional "WHATSAPP_GROUP_AGENT")
	WHATSAPP_GROUP_DEV=$(prompt_optional "WHATSAPP_GROUP_DEV")
}

setup_environment() {
	local root="$1"
	local provided_env="${2:-}"
	local target_env="$root/.env.production"

	[ -f "$target_env" ] && {
		substep "environment already configured"
		return 0
	}

	if [ -n "$provided_env" ]; then
		validate_env_file "$provided_env"
		cp "$provided_env" "$target_env" || {
			echo "Error: Failed to copy env file" >&2
			exit 1
		}
		substep "using provided environment file"
	else
		JWT_SECRET=$(openssl rand -base64 32)
		PUBLIC_URL=$(get_public_url "$root")
		collect_credentials
		generate_env_file "$target_env"
		substep "environment configured"
	fi
}

#!/usr/bin/env bash

validate_required() {
	local var_name="$1"
	local var_value="$2"

	if [ -z "$var_value" ]; then
		echo "Error: $var_name is required" >&2
		exit 1
	fi
}

prompt_required() {
	local var_name="$1"
	local prompt_text="${2:-$var_name}"
	local value

	read -p "$prompt_text: " value
	validate_required "$var_name" "$value"
	echo "$value"
}

prompt_secret() {
	local var_name="$1"
	local prompt_text="${2:-$var_name}"
	local value

	read -s -p "$prompt_text: " value
	echo "" >&2
	validate_required "$var_name" "$value"
	echo "$value"
}

prompt_optional() {
	local prompt_text="$1"
	local value

	read -p "$prompt_text: " value
	echo "$value"
}

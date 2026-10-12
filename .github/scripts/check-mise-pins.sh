#!/usr/bin/env bash
# Print each pin behind its latest release as a Markdown item. Print nothing
# when every pin is current. `mise outdated` omits failed lookups and exits 0,
# so accept a pin only when it is listed there or `mise latest` returns the
# pinned version. Fail for every other pin.
set -euo pipefail

pins=$(mise ls --local --json |
  jq -r 'to_entries[] | [.key, .value[0].requested_version] | @tsv')
if [[ -z $pins ]]; then
  echo "mise ls --local found no tools in mise.toml" >&2
  exit 1
fi

outdated=$(mise outdated --bump --local --json)

unchecked=()
while IFS=$'\t' read -r tool pin; do
  if jq -e --arg tool "$tool" 'has($tool)' <<<"$outdated" >/dev/null; then
    jq -r --arg tool "$tool" \
      '.[$tool] | "- `\($tool)`: \(.requested) -> \(.bump)"' <<<"$outdated"
  elif ! latest=$(mise latest "$tool@latest") || [[ $latest != "$pin" ]]; then
    unchecked+=("$tool")
  fi
done <<<"$pins"

if ((${#unchecked[@]})); then
  echo "pins neither outdated nor confirmed current by mise: ${unchecked[*]}" >&2
  exit 1
fi

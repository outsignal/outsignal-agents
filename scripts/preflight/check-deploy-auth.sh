#!/usr/bin/env bash
#
# Deploy auth preflight.
#
# Verifies that the three deploy CLIs used in the standard release path are
# authenticated before a deploy starts:
#   npm run preflight:deploy-auth
#
# Output is pipe-delimited for easy reading and simple parsing:
#   target | authed | identity

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR" || exit 1

strip_ansi() {
  sed -E $'s/\x1B\\[[0-9;?]*[ -/]*[@-~]//g'
}

first_identity() {
  local output="$1"
  local clean email first_line

  clean="$(
    printf "%s\n" "$output" \
      | strip_ansi \
      | tr -d '\r' \
      | sed -E '/^Vercel CLI /d'
  )"
  email="$(printf "%s\n" "$clean" | grep -E -o '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | head -n 1 || true)"
  if [ -n "$email" ]; then
    printf "%s" "$email"
    return
  fi

  first_line="$(printf "%s\n" "$clean" | awk 'NF { print; exit }')"
  if [ -n "$first_line" ]; then
    printf "%s" "$first_line" | cut -c 1-120
  else
    printf "n/a"
  fi
}

run_command() {
  local output status
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  printf "%s\t%s" "$status" "$output"
}

print_row() {
  local target="$1"
  local authed="$2"
  local identity="$3"
  printf "%-11s | %-6s | %s\n" "$target" "$authed" "$identity"
}

SDK_VERSION="$(node -p "require('@trigger.dev/sdk/package.json').version" 2>/dev/null || true)"

printf "%-11s | %-6s | %s\n" "target" "authed" "identity"
printf "%-11s-+-%-6s-+-%s\n" "-----------" "------" "--------"

failed=0
refresh_commands=()

railway_result="$(run_command railway whoami)"
railway_status="${railway_result%%$'\t'*}"
railway_output="${railway_result#*$'\t'}"
if [ "$railway_status" = "0" ]; then
  print_row "railway" "yes" "$(first_identity "$railway_output")"
else
  print_row "railway" "no" "n/a"
  failed=1
  refresh_commands+=("Railway: railway login --browserless")
fi

if [ -z "$SDK_VERSION" ]; then
  print_row "trigger.dev" "no" "n/a (could not resolve @trigger.dev/sdk version)"
  failed=1
  refresh_commands+=("Trigger.dev: npx trigger.dev@<sdk-version> login")
else
  trigger_result="$(run_command npx "trigger.dev@$SDK_VERSION" whoami)"
  trigger_status="${trigger_result%%$'\t'*}"
  trigger_output="${trigger_result#*$'\t'}"
  if [ "$trigger_status" = "0" ]; then
    print_row "trigger.dev" "yes" "$(first_identity "$trigger_output")"
  else
    print_row "trigger.dev" "no" "n/a"
    failed=1
    refresh_commands+=("Trigger.dev: npx trigger.dev@$SDK_VERSION login")
  fi
fi

vercel_result="$(run_command npx vercel whoami)"
vercel_status="${vercel_result%%$'\t'*}"
vercel_output="${vercel_result#*$'\t'}"
if [ "$vercel_status" = "0" ]; then
  print_row "vercel" "yes" "$(first_identity "$vercel_output")"
else
  print_row "vercel" "no" "n/a"
  failed=1
  refresh_commands+=("Vercel: npx vercel login")
fi

if [ "$failed" -ne 0 ]; then
  printf "\nRefresh required:\n"
  for command in "${refresh_commands[@]}"; do
    printf "%s\n" "- $command"
  done
  exit 1
fi

printf "\nAll deploy CLIs are authenticated.\n"

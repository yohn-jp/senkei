#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s --write|--check\n' "$0" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
mode="$1"
[[ "$mode" == "--write" || "$mode" == "--check" ]] || usage

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
adapter_package="senkei-editor-adapter"
fixture_dir="$repo_root/packages/jinrei-editor/fixtures"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"

emit_fixture() {
  local example="$1"
  local output="$2"
  cargo run --quiet --locked --release --package "$adapter_package" --example "$example" > "$output"
}

emit_fixture emit_catalog "$tmp_dir/next-domain-catalog.json"
emit_fixture emit_profile_catalog "$tmp_dir/next-domain-catalog-with-profile.json"
emit_fixture emit_compile_fixture "$tmp_dir/next-compile-reply.json"
emit_fixture emit_rejected_compile_fixture "$tmp_dir/next-compile-rejected.json"

fixtures=(
  next-domain-catalog.json
  next-domain-catalog-with-profile.json
  next-compile-reply.json
  next-compile-rejected.json
)

if [[ "$mode" == "--write" ]]; then
  for fixture in "${fixtures[@]}"; do
    cp "$tmp_dir/$fixture" "$fixture_dir/$fixture"
  done
  printf 'Regenerated %d Jinrei Editor fixtures from the verified Rust producer.\n' "${#fixtures[@]}"
  exit 0
fi

stale=0
for fixture in "${fixtures[@]}"; do
  if ! cmp -s "$tmp_dir/$fixture" "$fixture_dir/$fixture"; then
    printf 'Stale fixture: %s\n' "$fixture_dir/$fixture" >&2
    diff -u "$fixture_dir/$fixture" "$tmp_dir/$fixture" || true
    stale=1
  fi
done

if [[ "$stale" -ne 0 ]]; then
  printf 'Run npm run fixtures:generate --workspace @senkei/jinrei-editor and commit the result.\n' >&2
  exit 1
fi

printf 'All Jinrei Editor fixtures match the verified Rust producer.\n'

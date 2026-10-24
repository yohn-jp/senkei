#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
report_path="${NEXT_BALANCE_REPORT:-${repo_root}/target/next-balance/latest.json}"

mkdir -p "$(dirname "${report_path}")"
rm -f "${report_path}"

NEXT_BALANCE_REPORT="${report_path}" \
  cargo test --manifest-path "${repo_root}/Cargo.toml" \
    -p enbu --test next_scenarios -- --nocapture

if [[ ! -s "${report_path}" ]]; then
  echo "next scenario test passed without writing its requested report: ${report_path}" >&2
  exit 1
fi

echo "Next scenario report: ${report_path}"

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
report_path="${NEXT_BALANCE_REPORT:-${repo_root}/target/next-balance/latest.json}"
fixture_dir="${NEXT_ADAPTER_FIXTURE_DIR:-${repo_root}/target/next-balance/adapter}"
wasm_path="${SENKEI_WASM_PATH:-${repo_root}/apps/web/public/wasm/senkei_wasm.wasm}"

mkdir -p "$(dirname "${report_path}")"
mkdir -p "${fixture_dir}"
rm -f "${report_path}"
rm -f "${fixture_dir}"/*.request.json

NEXT_BALANCE_REPORT="${report_path}" \
NEXT_ADAPTER_FIXTURE_DIR="${fixture_dir}" \
  cargo test --manifest-path "${repo_root}/Cargo.toml" \
    --locked --release -p enbu --test next_scenarios -- --nocapture

if [[ ! -s "${report_path}" ]]; then
  echo "next scenario test passed without writing its requested report: ${report_path}" >&2
  exit 1
fi

if [[ ! -s "${wasm_path}" ]]; then
  bash "${repo_root}/scripts/wasm/build.sh"
fi

node "${repo_root}/tests/conformance/compare-next-adapters.mjs" "${fixture_dir}"

echo "Next scenario report: ${report_path}"

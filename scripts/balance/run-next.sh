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
rm -f "${fixture_dir}/strategic-measurements.json"

# Write all measured outcomes before historical assertions, so a changed
# baseline cannot discard the evidence needed to explain the failure.
if NEXT_BALANCE_REPORT="${report_path}" \
NEXT_STRATEGIC_REPORT="${fixture_dir}/strategic-measurements.json" \
NEXT_ADAPTER_FIXTURE_DIR="${fixture_dir}" \
  cargo test --manifest-path "${repo_root}/Cargo.toml" \
    --locked --release -p enbu --test next_scenarios -- --nocapture; then
  :
else
  status=$?
  # Keep compact, citable measurements in the log as well as the artifact.
  if [[ -s "${fixture_dir}/strategic-measurements.json" ]]; then
    node --input-type=module - "${fixture_dir}/strategic-measurements.json" <<'JS'
import { readFileSync } from "node:fs";
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const item of report.cases) {
  console.log("STRATEGIC_MEASUREMENT " + JSON.stringify({
    case_id: item.case_id, outcome: item.outcome, final_tick: item.final_tick,
    termination_reason: item.termination_reason, termination_class: item.termination_class,
    final_state_digest: item.final_state_digest, cu_by_side: item.cu_by_side,
    bases: item.owner_structure_state.filter(entity => entity.kind === "base"),
  }));
}
JS
  fi
  # The existing always-uploaded adapter artifact retains exact inputs and
  # runtimes for offline reproduction. No failing check becomes a pass.
  git -C "${repo_root}" rev-parse HEAD > "${fixture_dir}/failure-source-revision.txt"
  git -C "${repo_root}" archive --format=tar.gz --output="${fixture_dir}/failure-source.tar.gz" HEAD
  if [[ -s "${wasm_path}" ]]; then
    cp "${wasm_path}" "${fixture_dir}/failure-senkei.wasm"
  fi
  if [[ -n "${SENKEI_NATIVE_DISPATCHER:-}" && -f "${SENKEI_NATIVE_DISPATCHER}" ]]; then
    cp "${SENKEI_NATIVE_DISPATCHER}" "${fixture_dir}/failure-senkei-native"
  fi
  exit "${status}"
fi

if [[ ! -s "${report_path}" ]]; then
  echo "next scenario test passed without writing its requested report: ${report_path}" >&2
  exit 1
fi

# A cached artifact may predate the current native code or rules digest.
if [[ -z "${SENKEI_WASM_PATH:-}" ]]; then
  bash "${repo_root}/scripts/wasm/build.sh"
elif [[ ! -s "${wasm_path}" ]]; then
  echo "Requested WebAssembly artifact is missing: ${wasm_path}" >&2
  exit 1
fi

node "${repo_root}/tests/conformance/compare-next-adapters.mjs" "${fixture_dir}"

echo "Next scenario report: ${report_path}"

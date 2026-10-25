#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
output_dir="${1:-${BATTLEFIELD_PREBUILT_SCENARIO_DIR:-}}"
if [[ -z "$output_dir" ]]; then
  echo "usage: $0 <scenario-artifact-directory>" >&2
  exit 2
fi
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
temporary_dir="$(mktemp -d "$output_dir/.scenario-fixtures.XXXXXX")"
cleanup() { rm -rf "$temporary_dir"; }
trap cleanup EXIT

run_snapshot_test() {
  local test_name="$1"
  local variable_name="$2"
  local output_path="$3"
  (
    cd "$repo_root"
    env "$variable_name=$output_path" cargo test --locked --release -p enbu --test next_scenarios "$test_name" -- --exact
  )
  if [[ ! -s "$output_path" ]]; then
    echo "scenario test '$test_name' did not write its expected snapshot: $output_path" >&2
    exit 1
  fi
}

run_snapshot_test \
  canonical_battlefield_real_jinrei_match_covers_tracks_fords_bridges_and_node_combat \
  BATTLEFIELD_SCENARIO_SNAPSHOT_PATH \
  "$temporary_dir/canonical.json"
run_snapshot_test \
  real_jinrei_enbu_capture_match_exports_visual_snapshot \
  BATTLEFIELD_CAPTURE_SCENARIO_SNAPSHOT_PATH \
  "$temporary_dir/capture.json"
run_snapshot_test \
  enbu_confirms_base_node_assaults_for_both_sides \
  BATTLEFIELD_BASE_ASSAULT_SCENARIO_SNAPSHOT_PATH \
  "$temporary_dir/base-assault.json"

source_revision="$(git -C "$repo_root" rev-parse HEAD)"
python3 - "$temporary_dir" "$source_revision" <<'PY'
import hashlib
import json
import pathlib
import sys
from datetime import datetime, timezone

directory = pathlib.Path(sys.argv[1])
source_revision = sys.argv[2]
files = {}
for key, filename in (
    ("canonical", "canonical.json"),
    ("capture", "capture.json"),
    ("baseAssault", "base-assault.json"),
):
    payload = (directory / filename).read_bytes()
    json.loads(payload)
    files[key] = {"filename": filename, "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload)}
manifest = {
    "schema": "senkei-battlefield-browser-scenario-fixtures/v1",
    "sourceRevision": source_revision,
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "files": files,
}
(directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY

for filename in canonical.json capture.json base-assault.json manifest.json; do
  mv -f "$temporary_dir/$filename" "$output_dir/$filename"
done
echo "Prepared canonical.json, capture.json, and base-assault.json in $output_dir (source $source_revision)."

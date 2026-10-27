#!/usr/bin/env bash
# Run from a clean checkout of the commit to which instrumentation.patch applies.
set -euo pipefail
cd "$(dirname "$0")/../.."
root=$PWD
artifact=${SENKEI_REAL_EXPERIMENT_ARTIFACT:-/tmp/senkei-wave2-real.json}
wasm=${SENKEI_BENCH_WASM_DIR:-/workspace/senkei-integration-wave2/apps/web/public/wasm}
deps=${SENKEI_BENCH_NODE_MODULES:-/workspace/senkei-integration-wave2/node_modules}
out=${SENKEI_PERFORMANCE_OUTPUT:-/tmp/senkei-wave3-performance-$(date -u +%Y%m%dT%H%M%SZ)}
port=${SENKEI_BROWSER_PORT:-4188}
mkdir -p "$out"
out=$(realpath "$out")
test -f "$artifact" && test -d "$wasm" && test -d "$deps"
test ! -e node_modules && test ! -e apps/web/public/wasm || { echo 'Use a checkout without node_modules or public/wasm; runner creates temporary links' >&2; exit 1; }
git apply --check scripts/performance/instrumentation.patch
sampler_pid=''
cleanup() {
  if [[ -n "$sampler_pid" ]]; then kill "$sampler_pid" 2>/dev/null || true; wait "$sampler_pid" 2>/dev/null || true; fi
  git apply -R scripts/performance/instrumentation.patch
  rm -f node_modules apps/web/public/wasm
}
git apply scripts/performance/instrumentation.patch
trap cleanup EXIT
ln -s "$deps" node_modules
ln -s "$wasm" apps/web/public/wasm
{
  date -u +%FT%TZ
  git rev-parse HEAD
  sha256sum "$artifact" "$wasm"/*
  wc -c "$artifact"
  /usr/bin/chromium --version
} > "$out/environment.txt"
./node_modules/.bin/vite build > "$out/build.log" 2>&1
# RSS is process-wide and host-wide, not scoped to this browser; samples are not peaks.
(while :; do date -u +%FT%T.%NZ; ps -eo pid,ppid,rss,args | awk '/[c]hromium/ { print }'; sleep 1; done) > "$out/rss-samples.log" &
sampler_pid=$!
set +e
SENKEI_REAL_EXPERIMENT_ARTIFACT="$artifact" SENKEI_CHROMIUM_EXECUTABLE="${SENKEI_CHROMIUM_EXECUTABLE:-/usr/bin/chromium}" SENKEI_BROWSER_PORT="$port" ./node_modules/.bin/playwright test --config tests/browser/playwright.config.ts experiment-import-safety.spec.ts --workers=1 --grep 'semantic incompatible' > "$out/browser.log" 2>&1
status=$?
set -e
printf '%s\n' "$status" > "$out/exit-code.txt"
echo "Evidence: $out (exit $status)"
exit "$status"

#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"
cd "$repo_root"

exec nix shell nixpkgs#chromium -c bash -c '
  export SENKEI_CHROMIUM_EXECUTABLE="$(command -v chromium)"
  npm run test:e2e --prefix tests/browser
'

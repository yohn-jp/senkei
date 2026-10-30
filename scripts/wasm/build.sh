#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"
target="wasm32-unknown-unknown"
crate="senkei-wasm"

cd "$repo_root"

if ! rustc --version >/dev/null 2>&1 || ! cargo --version >/dev/null 2>&1; then
  echo "Rust and Cargo are required to build Senkei WASM." >&2
  exit 1
fi

target_libdir="$(rustc --print target-libdir --target "$target" 2>/dev/null || true)"
if [[ -z "$target_libdir" || ! -d "$target_libdir" ]]; then
  if command -v rustup >/dev/null 2>&1; then
    rustup target add "$target"
    target_libdir="$(rustc --print target-libdir --target "$target")"
  else
    echo "Rust target $target is missing. Install it with 'rustup target add $target' or use a Rust toolchain that includes it." >&2
    exit 1
  fi
fi

if ! command -v wasm-ld >/dev/null 2>&1; then
  if command -v nix-shell >/dev/null 2>&1 && [[ "${SENKEI_WASM_NIX_LLD_REEXEC:-}" != "1" ]]; then
    quoted_args=()
    for arg in "${BASH_SOURCE[0]}" "$@"; do
      printf -v quoted_arg '%q' "$arg"
      quoted_args+=("$quoted_arg")
    done
    exec nix-shell -p lld --run "SENKEI_WASM_NIX_LLD_REEXEC=1 bash ${quoted_args[*]}"
  fi
  echo "The WebAssembly linker 'wasm-ld' is required. Install LLVM LLD (for Nix: 'nix-shell -p lld')." >&2
  exit 1
fi

export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_LINKER="$(command -v wasm-ld)"
# The production binary adopts the proven real-Enbu TCSRVG portfolio.
# Explicit 'reference' remains the unoptimized control for certification.
# Measured on the same revision: the G addition raised equal-case geometric\n# mean speedup from 1.012x (TCSRV) to 1.144x (TCSRVG), 7/7 exact\n# native full-response matches; Hybrid H/HS were slower and are not promoted.\n# Future promotions must come from full Native/WASM parity and total-time
# measurements on the same immutable source revision.
features="${SENKEI_WASM_FEATURES:-lab-optimizations,lab-opt-route,lab-opt-visibility,lab-opt-fog-cache}"
if [[ "$features" == reference ]]; then
  cargo build --locked --release --target "$target" -p "$crate" --lib
else
  cargo build --locked --release --target "$target" -p "$crate" --lib --features "$features"
fi

wasm_dir="$repo_root/apps/web/public/wasm"
mkdir -p "$wasm_dir"
cp "$repo_root/target/${target}/release/senkei_wasm.wasm" "$wasm_dir/senkei_wasm.wasm"
echo "Built $wasm_dir/senkei_wasm.wasm"

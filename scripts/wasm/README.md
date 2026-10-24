# WASM adapter build

Run `scripts/wasm/build.sh` from any directory. It builds the `senkei-wasm`
library for `wasm32-unknown-unknown` and copies the raw module to
`apps/web/public/wasm/senkei_wasm.wasm`. Vite serves it at `/wasm/`; generated
WASM files are ignored by Git.

The script uses the installed Rust target, adds it with `rustup` if needed, and
uses `nix-shell -p lld` when `wasm-ld` is missing. `wasm-pack` and
`wasm-bindgen` are not needed because the adapter exposes a small JSON C ABI.

The JavaScript host allocates a request buffer with
`senkei_alloc(length) -> pointer`, writes UTF-8 JSON to exported memory, then
calls `senkei_dispatch(pointer, length) -> u64`. The low 32 bits of the return
value are the response pointer; the high 32 bits are its byte length. The
response is an owned boxed byte slice. The host copies it and releases both
buffers with `senkei_dealloc(pointer, length)`. `senkei_dispatch` does not take
ownership of the request buffer.

Native golden comparisons use the same `dispatch_json` implementation through
the line-delimited runner:

```sh
cargo run --locked -p senkei-wasm --bin senkei-wasm-dispatch
```

Each input line is one core JSON envelope and each output line is its
correlated response envelope.

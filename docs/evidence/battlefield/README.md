# Battlefield replay evidence

## Baseline capture

`baseline-c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb/` is captured from the confirmed PR #3 baseline commit `c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb`. The browser used the real Next workbench path: compile the default Jinrei draft, launch the local battle, receive the `simulate` response from the Core Worker running `senkei_wasm.wasm`, convert the returned owner `PresentationReplay` for the battlefield, and render it through the Next Replay Player. The harness does not use a synthetic replay fixture or a second simulator.

The directory contains the exact simulation input, the captured owner and public PresentationReplay JSON, capture metadata, a browser recording, and stage screenshots at 1920×1080, 1440×900, 430×932, 390×844, and 320×844. Each screenshot filename records its semantic state and exact replay tick. `metadata.json` records the match ID, ruleset digest, replay digests, final state digest, WASM SHA-256, and the available event ticks. The WASM response was HTTP 200 from the local preview; the same digest was then also served from the browser's offline cache.

The default actual match ends in attacker victory by base destruction at tick 211. It contains movement visible in the confirmed positions at tick 1, an attack cue at tick 6, and a base-destroy cue at tick 211. This match has no tower destruction, active skill cue, Hero death, or Hero respawn; those states are reported as unavailable, not inferred from Minion deaths or base destruction. The baseline renderer has no separate Tactical camera mode: its initial reset pose and the Overview button produce the same whole-world view. The evidence records that limitation.

## Reproduce the capture

Run the focused browser test against a production preview built from the desired commit. Set `BATTLEFIELD_APP_SHA` to that checkout's full SHA and `BATTLEFIELD_OUTPUT_DIR` to an empty, private capture directory. The harness clears only that output directory before writing.

```sh
SENKEI_BROWSER_PORT=4184 \
SENKEI_CHROMIUM_EXECUTABLE=/nix/store/1sda328rshrqarp3jsz1rd1h3bjj3fy7-chromium-155.0.8059.84/bin/chromium \
BATTLEFIELD_APP_SHA=c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb \
BATTLEFIELD_OUTPUT_DIR="$PWD/docs/evidence/battlefield/baseline-c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb" \
./node_modules/.bin/playwright test --config=tests/browser/playwright.config.ts --project=chromium --grep 'captures fixed-tick real Enbu replay'
```

The Playwright browser test is [battlefield-verification.spec.ts](../../../tests/browser/specs/battlefield-verification.spec.ts). The baseline and post-change captures must keep the same simulation input SHA, match ID, source replay digest, exact ticks, and viewports. Screenshots are also inspected independently; a passing test or a written image is not an art acceptance result.

The harness stores per-image SHA-256 values and per-viewport layout metrics. Compare two captures with [compare-battlefield-captures.mjs](../../../scripts/visual/compare-battlefield-captures.mjs). For the extraction-only c9fe67c → fdf8d68 comparison, pass `--require-identical-images`; for intentional redesign captures, omit that flag and review the changed viewports/images against the seven acceptance criteria.

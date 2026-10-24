# Battlefield replay evidence

## Baseline capture

`baseline-c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb/` is captured from the confirmed PR #3 baseline commit `c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb`. The browser used the real Next workbench path: compile the default Jinrei draft, launch the local battle, receive the `simulate` response from the Core Worker running `senkei_wasm.wasm`, convert the returned owner `PresentationReplay` for the battlefield, and render it through the Next Replay Player. The harness does not use a synthetic replay fixture or a second simulator.

The directory contains a reproducible input bundle, captured owner and public PresentationReplay bundles, capture metadata, a browser recording, and stage screenshots at 1920×1080, 1440×900, 430×932, 390×844, and 320×844. The JSON bundles use deterministic gzip; `metadata.json` records their uncompressed JSON SHA-256 and byte sizes. Each screenshot filename records its semantic state and exact replay tick. `metadata.json` also records the match ID, ruleset digest, replay digests, final state digest, WASM SHA-256, layout metrics, camera poses, image SHA-256 values, and the available event ticks. The WASM response was HTTP 200 from the local preview; the same digest was then also served from the browser's offline cache.

The owner replay bundle is labeled `local-owner-only`; the public replay bundle is `public-presentation`. The simulation input bundle is the controlled local test input and is not a public replay. Restricted diagnostics are not written to disk or passed to the Renderer.

The default actual match ends in attacker victory by base destruction at tick 211. It contains movement visible in the confirmed positions at tick 1, an attack cue at tick 6, and a base-destroy cue at tick 211. This match has no tower destruction, active skill cue, Hero death, or Hero respawn; those states are reported as unavailable, not inferred from Minion deaths or base destruction. The baseline renderer has no separate Tactical camera mode: its initial reset pose and the Overview button produce the same whole-world view. The evidence records that limitation.

## Reproduce the capture

Run the focused browser test against a production preview built from the desired commit. Set `BATTLEFIELD_APP_SHA` to that checkout's full SHA and `BATTLEFIELD_OUTPUT_DIR` to an empty, private capture directory. The harness clears only that output directory before writing. Set `BATTLEFIELD_REPLAY_BUNDLE_DIR` to the baseline bundle directory for a matched after capture; the harness verifies its uncompressed input and replay JSON are byte-identical before reusing the existing canonical files.

```sh
SENKEI_BROWSER_PORT=4184 \
SENKEI_CHROMIUM_EXECUTABLE=/nix/store/1sda328rshrqarp3jsz1rd1h3bjj3fy7-chromium-155.0.8059.84/bin/chromium \
BATTLEFIELD_APP_SHA=c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb \
BATTLEFIELD_OUTPUT_DIR="$PWD/docs/evidence/battlefield/baseline-c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb" \
./node_modules/.bin/playwright test --config=tests/browser/playwright.config.ts --project=chromium --grep 'captures fixed-tick real Enbu replay'
```

The Playwright browser test is [battlefield-verification.spec.ts](../../../tests/browser/specs/battlefield-verification.spec.ts). The baseline and post-change captures must keep the same simulation input SHA, match ID, source replay digest, exact ticks, and viewports. Screenshots are also inspected independently; a passing test or a written image is not an art acceptance result.

The harness stores per-image SHA-256 values, camera poses, and per-viewport layout metrics. Compare two captures with [compare-battlefield-captures.mjs](../../../scripts/visual/compare-battlefield-captures.mjs). For the extraction-only c9fe67c → fdf8d68 comparison, replay/input/result digests, normalized event ticks, viewports, camera poses, and layout must match; 30 of 35 screenshots were byte-identical, and the five cue frames were visually reviewed because their 300 ms renderer interpolation makes exact pixel hashes timing-sensitive. For the redesign, image changes are expected and must be reviewed against the seven acceptance criteria.

## Final redesign capture

The current production evidence is [after-43d2c35-default](after-43d2c35-default/), built from `43d2c35b908d0a6d08eaf049f28cde43f5190b01`. Its actual-WASM default match covers Tactical, Overview, Follow, advance T1, clash T6, base destruction/end T211 and mobile Timeline/Details at all five required viewports. The [c9 comparison](comparison-default-c9-to-43d2c35.json) confirms identical input, match, owner/public replay digests, final-state digest, exact ticks and viewport set. [Browser recording](after-43d2c35-default/battlefield-capture.webm).

- Same-condition T0: [before, 1440×900](baseline-c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb/1440x900/tactical-t000.png) / [after, 1440×900](after-43d2c35-default/1440x900/tactical-t000.png).
- [Near-unit inspection and same-Tick Hero Follow](cluster-43d2c35/) verify actual identities, HP and native World coordinates without moving models or inferring Squad membership.
- [Analysis event focus and actual workbench journey](event-focus-43d2c35/) verify the event Tick and camera transition; this edited-draft journey is separate from the paired default match.
- [Controlled event evidence](controlled-scenarios.md), [cue comparison](comparison-controlled-cue-c9-to-43d2c35.json) and [farm comparison](comparison-controlled-farm-c9-to-43d2c35.json) cover states absent from the default match through real Worker/WASM results.
- [Independent seven-criterion review](../../implementation/BATTLEFIELD-REDESIGN-VERIFICATION.md) is PASS for this Battlefield Wave. User approval, physical-device/hardware GPU checks and the broader Issue #5 Goal remain NOT_CHECKED.

Earlier `after-da1c53ed-default`, `after-993ef56-default`, `after-2475d6e-default` and their controlled captures are integration checkpoints, not the final runtime evidence. Tests and image existence alone are not visual acceptance.

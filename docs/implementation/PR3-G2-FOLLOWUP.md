# PR #3: G2 follow-up and acceptance record

Authority: [Issue #5](https://github.com/yohn-jp/senkei/issues/5).
PR #3 remains OPEN and must not be merged on the strength of CI alone.

## Changes

- Dedicated Collection, Detail, Skill Tree and Squad Assembly views consume
  the bundled Hero Catalog and the same five-slot draft. All seven partitions,
  real base/growth values, authored skill paths, prerequisites and unlock
  levels are available. Planned skills are distinguished from actual match
  acquisition; active skills show the existing typed `activate` capability.
- A separate browser recovery copy keeps unsaved formation, skill and Jinrei
  edits across reload. Explicit Save setup remains a separate restore point.
  Incompatible recovery data is preserved until explicitly discarded.
- The Replay contract now optionally carries actual unblocked Senritsu map
  edges. The Next adapter projects those edges and the Renderer draws authored
  jungle routes. Existing fixtures remain compatible. The invented river and
  bridges were removed. Camera, forest placement and objective readability
  are reviewed against real WASM matches, not synthetic fixture success.
- Next uses the available desktop workspace width. During battle, internal
  navigation becomes horizontal and the map receives the main display area.
- The strategic report now records 56 cases. Eight representative scenarios
  run to base destruction or the real 600-tick cap: two opposite-side base
  victories (ticks 146 and 143), six timeouts. Solo/Quintet and jungle/lane
  stalemates remain visible; no balance claim is made.
- A real-Enbu reveal regression verifies sight after the sole nearby minion
  dies, then exact owner/public replay concealment at the expiry boundary.
  Private enemy fields stay absent and private Jinrei access is rejected.

## Graphics G1 seek failure

The original failing run is
[40097065336](https://github.com/yohn-jp/senkei/actions/runs/40097065336).
Its 390×844 trace shows Fixture replacement followed by two ArrowRight inputs
while the UI still reports Tick 0; the final assertion reads Tick 12 after
fourteen inputs. The replacement player and its UI listener were installed
in separate passive React effects. A seek before subscription could update
the player without updating the controlled slider, and a following render
could restore its stale value.

Fixture replacement and the UI subscription now use layout effects, closing
that input window before paint. The expected Tick values were not relaxed.
A new 390px regression repeatedly switches replays and immediately seeks in
both directions under fourfold CPU throttling. Slider, output and canvas must
all agree. The full ten-test Graphics suite passes locally. Both hosted
Graphics runs on the first follow-up push also passed:
[40098649446](https://github.com/yohn-jp/senkei/actions/runs/40098649446),
[40098652286](https://github.com/yohn-jp/senkei/actions/runs/40098652286).

## Independent acceptance gates

These statuses refer to the complete Issue #5 acceptance gate, not just the
changed code. A passing test does not override a missing acceptance condition.

| Gate | Status | Evidence and remaining boundary |
| --- | --- | --- |
| Contract / Correctness | PASS for automated checks | Rust workspace, native/WASM complete responses, replay adapter/decoder/player and production browser checks. Actual map edges replace decorative gameplay topology. |
| Visual / Art | FAIL | Approved twelve-Hero exhibition art/animation and matching LOD are unavailable. Detail explicitly says so; no frozen PR #4 asset was imported. A larger map or a captured screenshot does not establish art acceptance. |
| Interaction / UX | NOT_CHECKED for final acceptance | Dedicated screens and recorded real-browser flow are implemented. Final user evaluation, physical touch, mobile IME and hardware safe-area behavior are still unverified. |
| Balance / Security | FAIL for complete gate | Exact outcomes and public/private boundaries are tested, but six full-length strategic scenarios still time out. Fixed opening policies do not prove dominance-free balance. |

## Verification

Local verification uses Nix Chromium 155 with SwiftShader; it is browser
emulation, not hardware-GPU or physical-mobile evidence.

- `cargo build --workspace --locked` and `cargo test --workspace --locked` pass.
- Real WASM builds; seven initial complete-response goldens retain native/WASM
  parity. Next public simulation and three invalid-request pairs pass.
- Scenario-input generation and generated Replay types are unchanged by
  regeneration. Production TypeScript/Vite build and 34 Vitest checks pass.
- Graphics: ten browser tests pass, including the original viewport cases
  and the immediate replay-replacement keyboard seek regression.
- Final production journey results and screenshot/video inventory are listed
  in the [real-browser evidence record](../evidence/next/README.md).

The first follow-up push passed Rust, WASM, web build and Graphics checks but
failed Production browser smoke because that test still expected the old
inline Squad preview and skill-path selector. The test now visits the actual
Assembly and Skill Tree screens before continuing the real core journey.
The final PR checks, rather than an earlier successful run, determine hosted
CI status.

## Acceptance still required

The player must evaluate the real map, mobile interaction and full edit →
match → replay → analysis → revised rematch experience. Approved character
art and the remaining balance/physical-device evidence are outstanding.
There is no final G2 acceptance claim and no merge authorization.

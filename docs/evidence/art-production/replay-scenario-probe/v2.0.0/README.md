# Native Enbu scenario probe for F01/R01

This evidence records three deterministic, legal `senkei.next` v2.0.0 campaign matchups run through the saved native dispatcher from main commit `c03854f76a60707143342c9db4ca2f79e8b5ade3`. The dispatcher compiled the unchanged Jinrei sources from `scenarios/next/source-fixtures.json`; Enbu generated the match contexts. All cases used the context's default 600-tick limit. No Hero HP, rules, respawn duration, or context limit was edited. No browser, GPU, or build ran in this probe.

The player roster uses the existing `first-march` campaign Hero order and solo squad partition, placed at the current package's attacker base. Its ordinary Jinrei source is the unchanged `protect-the-core` fixture. Each opponent uses the exact Hero roster and squad grouping from its authored `campaign.ts` recipe, current package defender base, catalog's first sorted skill path, and its matching unchanged Jinrei source fixture. This keeps the battle inputs legal under the exact v2 package instead of reusing older v1 snapshots whose package digest and node IDs are stale.

## Results

| Campaign scenario | Result | F01/R01 event evidence | Replay result digest |
| --- | --- | --- | --- |
| `read-the-map` | Draw at tick 600 | F01 acquired `f01_a_passive` at 114, died at 176, respawned in `slot-1` at `A.BASE` at 201; defender R01 died at 77 | `12c94e7cbaaeaec51ab4cf24bece51e157be01fff2d7d42ea090f71747c919ff` |
| `share-the-pressure` | Draw at tick 600 | F01 acquired `f01_a_passive` at 79, died at 212, respawned in `slot-1` at `A.BASE` at 242; defender R01 acquired `r01_a_passive` at 224 | `4673f61d8c59225b1255aba405c0da30437d2d5ed0470ef18cdc114bd1dba91d` |
| `bridge-approach` | Draw at tick 600 | F01 died at 66 and respawned in `slot-1` at `A.BASE` at 86; defender R01 died at 33 | `5424c60db077057fe4250342af2b88054bab2e275f1effe3e7819eaa72025dc9` |

The inputs, exact fixture sources, public replay, attacker-owner replay, per-case hashes, final-state digests, and event observations are in `sources/`, `captures/`, and `manifest.json`. Owner replay files contain only the authorized owner replay and result; restricted diagnostics are excluded. Enemy-side slot IDs are omitted where the attacker perspective does not reveal them. Respawn ticks are derived from the owner replay's same-slot death followed by a new living entity ID at the side's base; these cases do not emit a separate `next.respawn` event.

This proves natural Hero skill acquisition, death, and respawn from the existing campaign lineups and tactics. These time-limit draws are event coverage, not win-rate or active-skill-use evidence.

## Core/Replay 0.4 recapture

On 2026-10-26, all three unchanged campaign recipes were rerun through Native dispatcher SHA-256 `392200c6ec75f93d15e185abc308d34933ba82f5ee6b90322f0745df0299c48e` from build source `62a3e19` (`crates` tree `3356b4e92785f7cd72dbde533d62348cd9408345`). The probe repository was `session/integration` at `7a0c0ff180420694a0a8d6de3587fef110582d71`; its `crates` tree matched the Native build source. The paired WASM was SHA-256 `c90f6902c97d0603567bf0e7997f5460fdf1916688365da75d6680f62d29f91e`. The refreshed `senkei.next` ruleset digest is `e4c8cd8fcd7aae03c8d59d3d71cfa9c8d6b7fcce8871cb62772cc1a6e413581a`; Replay writer schema is 1.1.0.

The rerun preserved each saved lineup, skill path, unchanged Jinrei source, attacker/defender base placement, and 600-tick limit. F01 died and respawned in the same slot at `A.BASE` in `read-the-map` (176→201), `share-the-pressure` (212→242), and `bridge-approach` (66→86). R01 death was observed at ticks 77, 33, and 33 respectively. F01 acquired its passive skill at tick 114 in `read-the-map` and tick 79 in `share-the-pressure`; these three campaign cases produced no active `next.skill` event. Final-state and replay digests match the prior Core run for all three cases, despite the ruleset digest change. Request, public replay, owner replay, event, and source hashes are recorded in [`captures/core-replay-0.4/manifest.json`](captures/core-replay-0.4/manifest.json).

### Recompiled active-skill scenario

A separate existing worker snapshot records a legal 10-Hero default matchup that naturally reaches both active skills. The probe extracts only its source AST and formation, recompiles both Jinrei programs against the current Core 0.4 ruleset, formats and recompiles the source to verify matching program digests, then creates a fresh default 600-tick context and passes current `preflight`. It does not send the saved bytecode, ruleset, context, or replay to current Core. The original `path_a` assignments, single `alpha` squad, rosters, and side bases are preserved.

In the current Native owner replay, attacker F01 died at tick 74 and respawned at `A.BASE` at 94; it acquired `f01_a_active` at 141 and used it at 146. Defender R01 acquired `r01_a_active` at 249 and used it at 351. R01 also died and respawned at ticks 130→165 (`B.BOT.BANK`), 182→208 (`B.BASE`), and 355→401 (`B.BASE`). F01 and R01 active-skill events also appear in the public replay. The result is a draw at the default 600-tick time limit. This verifies legal Core event generation and replay serialization; it does not verify browser playback, renderer behavior, Battlefield pixels, expected-size LOD/Tactical appearance, or pixel determinism.

The current dispatcher, ruleset, scenario/program hashes, result digests, selected event ticks, raw artifact hashes, limitations, and reproduction command are captured in the compact [Core 0.4 active-skill manifest](active-skill-core-replay-0.4.json). The [probe script](run_active_skill_probe.py) reuses the tracked original worker snapshot. Raw request/replay gzip files and the full generated manifest remain local ignored artifacts.

The saved `read-the-map` request was then dispatched a second time through the same binary. The complete result, public replay, and authorized attacker replay were exactly JSON-equal to the first run; hashes and scope are in [`determinism-core-replay-0.4.json`](determinism-core-replay-0.4.json). This verifies Native simulation determinism for that exact input, not renderer or screenshot determinism.

Raw request/replay gzip files are retained locally as ignored data for the next browser capture; they are regenerated from the tracked source fixtures and exact dispatcher rather than committed. The runner refuses to overwrite existing artifacts with different bytes; use a fresh output directory for any recapture. The verified Native binary was retained at `/home/sophia/src/senkei/target/local-codex/native/392200c6ec75f93d15e185abc308d34933ba82f5ee6b90322f0745df0299c48e`. To rerun, select that immutable binary or another build from the recorded Native source commit and use the repository that contains the source:

```sh
SENKEI_REPO_ROOT=/path/to/senkei \
SENKEI_NATIVE_SOURCE_HEAD=62a3e19 \
SENKEI_NATIVE_DISPATCHER=/path/to/senkei-wasm-dispatch \
python3 docs/evidence/art-production/replay-scenario-probe/v2.0.0/run_probe.py \
  --allow-different-dispatcher \
  --out-dir /tmp/senkei-art-core-replay-0.4-rerun
```

The script verifies that the Native build source and probe repository have the same `crates` tree, and records the probe repository HEAD plus paired WASM hash. Physical-GPU rendering and live Battlefield screenshots are separate acceptance evidence.

## Original Core capture

The baseline capture was produced from `c03854f`; its saved dispatcher was later removed while reclaiming storage, so that exact binary cannot be rerun. Its recorded hashes remain a historical comparison point. Reproduction for the current Core/Replay 0.4 is documented above. The runner does not build Core or use shared `node_modules`.

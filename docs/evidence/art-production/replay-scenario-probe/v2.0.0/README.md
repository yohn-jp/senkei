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

## Reproduction

Use the saved dispatcher at the path below. The script verifies its SHA256 and the expected package digest before running; it does not build or use shared `node_modules`.

```sh
SENKEI_NATIVE_DISPATCHER=/home/sophia/src/senkei/target/release/senkei-wasm-dispatch \
  python3 docs/evidence/art-production/replay-scenario-probe/v2.0.0/run_probe.py
```

The original capture was produced from main commit `c03854f`. The saved release artifact was later removed while reclaiming storage. For the planned post-integration Core/Replay 0.4 recapture, keep the baseline files intact and choose a fresh output directory:

```sh
SENKEI_NATIVE_DISPATCHER=/home/sophia/src/senkei/target/release/senkei-wasm-dispatch \
  python3 docs/evidence/art-production/replay-scenario-probe/v2.0.0/run_probe.py \
  --allow-different-dispatcher \
  --out-dir docs/evidence/art-production/replay-scenario-probe/v2.0.0/captures/core-replay-0.4
```

That mode accepts a rebuilt dispatcher and a refreshed `senkei.next` package digest while retaining the same three campaign recipes, source files, lineup, skill paths, base placement, and default context limit. The new output records its actual source commit, binary, WASM, ruleset, input, and replay hashes.

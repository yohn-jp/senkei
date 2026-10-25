# G2 implementation and acceptance ledger

Authority: Issue #5 and the canonical domain documents referenced by DESIGN-DECISIONS.md. G03 and cross-device synchronization remain deferred. This ledger records implementation evidence; it does not grant visual or physical-device acceptance.

| Workstream | Integrated commit | Implemented scope | Verification evidence | Outstanding |
| --- | --- | --- | --- | --- |
| W1 | 98cef36, 99d5929, d224fa2, 1be61d6 | Canonical World runtime layout/logical positions; lossless source projection; exact World resolution; package-bound Behavior semantics with missing/tampered artifact rejection | Owned Rust packages pass; integrated workspace check passes | Crossing interval execution, paired presentation transport, final native/WASM verification |
| W2 | 739ee42, 27acfe8, bb004f8 | Independent attacker/defender fog histories; exact context identity; producer filters owner Replay and diagnostics by requested side | Observation/identity integration tests 2/2; workspace check passes | Replay adapter/header/seek checks, canonical interval consumption, final parity |
| W3 | e34ecba | Real Next campaign NPC compile/Preflight/Enbu path and result-based progression | Integrated typecheck passes | Persist completed Experiments/baseline; owner-map consumer; final full tactical browser journey |
| W4 | d26782d, 7f21789, e570445, a05651b, 5320117, ac9df13 | Shared faceted materials/appearance manifest; screen-size LOD; mode/layer API; mandatory unexplored concealment across vision toggle | Renderer focused unit checks pass; integrated typecheck | UI controls, draw-call optimization, final visual/performance evidence |
| W5 | bfb31a5, c7a9e9b, 40eec44 | Mobile campaign selection, Hero task navigation, library keyboard tabs and recovery sheet | Browser 8/8 at 320/390/430/1440; Hero/Library unit tests 8/8 | Actual edit/replay continuity proof; final mobile journey; physical touch/IME |
| W6 | a90d4b0, 1a36e9a, 13eec3d | Six valid authored Next challenges; separate fixed regression/tactical matrix; measured clearable first challenge | Agent: release matrix 10/10, 48 fixed + 8 tactical cases; native/WASM 7/7; first challenge natural victory tick417, no rules/spawn relocation | Repeat final matrix with integrated package identity; no balance claim |
| W7 | 26433ca | Separate CI quality evidence; retire isolated F01 study page/generator/test/workflow/guide | Agent: 127 tests, generated types freshness, production build | Next-only App and legacy-data recovery replacement tests in progress |
| Integration | 16c680c, fddff46, f094776 | Complete World/replay DTOs; explicit owner side requests; Worker rejects mismatched perspective/private diagnostic leakage | Authorization unit tests 4/4; typecheck and workspace check pass | Final HEAD acceptance matrix and actual CI results |

Baseline: TypeScript typecheck and 136 Vitest tests passed before retirement. Debug workspace run passed 80 Enbu unit tests plus observation/package checks, then was stopped during long strategic scenarios to use release-mode acceptance instead; that partial run is not a workspace PASS.

Final acceptance remains pending. Physical GPU, real touch, IME and user art acceptance are NOT_CHECKED. Unresolved gameplay decisions remain DEC-TERRAIN-OCCLUSION-001, DEC-ATTACK-TIMING-001, DEC-MID-DIRECTION-001 and separately scoped history Capability rules; no new rules are implied by presentation memory.

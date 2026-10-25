# G2 implementation and acceptance ledger

Authority: Issue #5 and the canonical domain documents referenced by DESIGN-DECISIONS.md. G03 and cross-device synchronization remain deferred. This ledger records implementation evidence; it does not grant visual or physical-device acceptance.

| Workstream | Integrated commit | Implemented scope | Verification evidence | Outstanding |
| --- | --- | --- | --- | --- |
| W1 | ebbb99f, a0f8cda | Paired World identity in package/map/plan/context/replay; exact resolver; versioned projection API; presentation-independent package digest | Agent: senritsu + senkei-world tests | Canonical runtime projection adoption, Behavior binding, final native/WASM verification |
| W2 | Pending | Dual owner producer, permission/seek/identity checks in progress | Baseline existing fog tests | Integrate producer + Replay changes and exercise hidden bridge/re-observation |
| W3 | Pending | Tactical loop and valid Next PvE orchestration in progress | Baseline typecheck and editor tests | Final actual browser journey and immutable comparison |
| W4 | d26782d, 7f21789, e570445 | Presentation mode API; shared faceted materials; appearance manifest; screen-size LOD; safe shared material lifecycle | Renderer unit tests 7/7; typecheck | UI mode/layer controls, actual visual review, hardware performance |
| W5 | Pending | Mobile journey/accessibility and challenge selection in progress | Pending integration browser checks | Final desktop/mobile journey; physical touch/IME |
| W6 | Pending | Authored Next campaign and measurement separation in progress | Agent: campaign Vitest 2/2 | Integrate data + real measured report + progression journey |
| W7 | 26433ca | Separate CI quality evidence; retire isolated F01 study page/generator/test/workflow/guide | Agent: 127 tests, generated types freshness, production build | Retire remaining superseded UI after canonical replacement and prove coverage |
| Integration | 16c680c | Worker DTO paired identity and owner replay channel forwarding | Typecheck passed | Final final-HEAD acceptance matrix and actual CI results |

Baseline: TypeScript typecheck and 136 Vitest tests passed before retirement. Debug workspace run passed 80 Enbu unit tests plus observation/package checks, then was stopped during long strategic scenarios to use release-mode acceptance instead; that partial run is not a workspace PASS.

Final acceptance remains pending. Physical GPU, real touch, IME and user art acceptance are NOT_CHECKED. Unresolved gameplay decisions remain DEC-TERRAIN-OCCLUSION-001, DEC-ATTACK-TIMING-001, DEC-MID-DIRECTION-001 and separately scoped history Capability rules; no new rules are implied by presentation memory.

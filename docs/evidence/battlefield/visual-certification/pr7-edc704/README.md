# Battlefield visual certification checkpoint

This review captures the unmodified PR #7 application at producer commit `edc70466f4bcfdf76199d07bcd485b314f576f4b`. The app build metadata also reported that commit. The browser test changes in this branch are tracked separately from the producer source; no renderer or battlefield runtime code changed here.

## Result

| Area | Result | Evidence |
| --- | --- | --- |
| Functional | **PARTIAL PASS** | The real UI compiled Jinrei and ran the browser Worker/WASM Enbu path. The canonical 70 tick match and MID capture state completed. A controlled base assault snapshot exported in Rust, but browser rendering of its damage/destruction did not complete in the recorded run. |
| Visual | **FAIL** | The T23 overview improves on PR #7's centered damage card and the collapsed bridge is visible in Follow. The overview still presents a mostly flat green plane, ribbon roads and a flat water strip; camps/jungles and the MID observatory do not yet meet the authored 3D geography and architecture requirements. At 320×740, Hero labels and the Pixel 3D control overlap the battlefield. |
| Interaction | **PARTIAL PASS** | Seeking, Tactical/Overview/Follow, bridge state inspection, lane crossing, ford movement, mobile Details/Timeline and the Pixel/Smooth toggle were exercised in Chromium. The initial matrix covered 320, 390, 430, 1440 and 1920 widths. It stopped in the default battle at T50 on a stale F03 liveness assumption. The focused 1440 rerun of the live-Hero selection fix failed with a test-only ReferenceError; the stale block was removed on main, but browser verification after cleanup is **NOT_CHECKED**. Width 375 and the browser base-destruction sequence are **NOT_CHECKED**. |
| CI | **NOT_CHECKED** | The coordinator requested PR submission without waiting for CI. |
| Physical device | **NOT_CHECKED** | Physical GPU, touch input and IME were not tested. |

## Producer and replay scope

- Producer base and captured browser build: `edc70466f4bcfdf76199d07bcd485b314f576f4b`.
- Senritsu: `senkei.next` version `2.0.0`, digest `31ce86db9492354e339ed4172ca19b4a5f92b076ea73fe36e0d8be1ce97eb481`.
- Enbu engine: `1.2.0`; Jinrei language and bytecode: `1.0.0`; cost schedule: `2.0.0`.
- The Three.js renderer receives the authorized PresentationReplay projection. Entity projection IDs are frame-scoped; browser checks resolve bridges by site and Heroes/bases by their current authorized catalog identity.
- Real replay facts exercised include TOP normal/expanded/destroyed/rebuilt, MID bridge destruction, F01 lateral crossing, F02 ford transit, the MID capture owner/progress event, and the default match's T17 movement and T18 attack. The mobile MID capture screenshots use an Overview camera and do not certify a close visual read of the observatory.
- This run does not certify terrain occlusion (disabled), delayed attack preparation (nonzero preparation resolves at action start), or typed MID enemy travel direction (not present in the replay fields). Do not infer those behaviors from these captures.

## Visual comparison and follow-up

The desktop comparison uses the same 1440×900 Overview at T23. [PR #7 before image](https://github.com/yohn-jp/senkei/blob/6fa8296de8c3f85a50b064012f5a0bf3b891600e/docs/evidence/battlefield/canonical-browser/desktop-1440x900-bridge-destroyed.png) has a black damage card across the center of the map. The captured [T23 overview](1440x900-bridge-destroyed-overview-t023.png) no longer has that card and shows a larger battlefield; visual acceptance still fails on terrain depth, water/ford shape, camp and MID architecture, and label crowding at the narrow mobile width.

The browser run's first failure was in the test: its T50 lane occupancy fact allowed F03 with zero health, while the Follow interaction correctly requires a living Hero. The test now searches the authorized T50 frame for a living lateral Hero beside a center Minion and records that catalog ID. The focused rerun failed because the refactor retained an obsolete `edges.find()` block referencing `node` and `edgeTo` outside their loop scope. That block was removed on integrated main; no browser rerun after cleanup was performed. The attempted correction's earlier typecheck claim does not establish browser correctness.

See [verification.json](verification.json) for the machine-readable status and selected image hashes. The complete transient gallery stayed in `/dev/shm`; only these selected captures are committed to keep the evidence set bounded.

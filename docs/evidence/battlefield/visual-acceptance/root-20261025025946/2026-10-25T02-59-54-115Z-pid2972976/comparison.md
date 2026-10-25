# Battlefield visual acceptance captures

Source HEAD: `0fc9de31cce2c246c9748c9067eef3ee3e7e2322`. The Before column is the PR #7 baseline pinned by BATTLEFIELD-VISUAL.md.

| Scene | Before | After | Evidence |
| --- | --- | --- | --- |
| Desktop battlefield and destroyed crossing | [6fa8296 baseline](https://github.com/yohn-jp/senkei/blob/6fa8296de8c3f85a50b064012f5a0bf3b891600e/docs/evidence/battlefield/canonical-browser/desktop-1440x900-bridge-destroyed.png) | [real destroyed crossing](canonical-real-battle/1440x900/destroyed-bridge-overview-t023-overview.png) | 1440×900, T23, Overview |
| Mobile battlefield and first Hero clash | [6fa8296 baseline](https://github.com/yohn-jp/senkei/blob/6fa8296de8c3f85a50b064012f5a0bf3b891600e/docs/evidence/battlefield/canonical-default/mobile-390x844-t016.png) | [real Hero clash](default-enbu-victory/390x844/first-node-clash-t016-tactical.png) | 390×844, T16, Tactical |
| Track and river crossings | — | [lateral crossing](canonical-real-battle/1440x900/lane-crossing-t003-tactical.png), [ford transit](canonical-real-battle/1440x900/ford-transit-t024-tactical.png) | real Jinrei + Enbu + WASM |
| Bridge states | — | [expanded](canonical-real-battle/1440x900/top-bridge-expanded-t013-tactical.png), [destroyed](canonical-real-battle/1440x900/top-bridge-destroyed-t023-tactical.png), [rebuilt](canonical-real-battle/1440x900/top-bridge-rebuilt-t049-tactical.png) | replay-confirmed |
| Close-focus facility Follow | — | [TOP normal](canonical-real-battle/1440x900/top-bridge-normal-follow-t000-follow.png), [MID destroyed](canonical-real-battle/1440x900/mid-bridge-destroyed-follow-t011-follow.png), [TOP expanded](canonical-real-battle/1440x900/top-bridge-expanded-follow-t013-follow.png), [TOP destroyed](canonical-real-battle/1440x900/top-bridge-destroyed-follow-t023-follow.png), [TOP rebuilt](canonical-real-battle/1440x900/top-bridge-rebuilt-follow-t049-follow.png) | camera follows an authorized visible bridge entity |
| MID capture and victory | — | [capture progress](real-mid-capture/1440x900/capture-progress-t007-tactical.png), [T420 victory](default-enbu-victory/1440x900/base-destruction-end-t420-tactical.png) | actual simulation state |

Each screenshot's SHA-256, tick, viewport, requested camera mode, renderer camera pose/target, replay identity and scene facts are listed in `metadata.json`.

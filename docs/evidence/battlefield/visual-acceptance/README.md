# Battlefield visual evidence checkpoint

This directory preserves work-in-progress browser captures at the user's requested commit checkpoint. **It is not final visual acceptance evidence for the latest HEAD.** Images use real compiled Jinrei, browser Worker/WASM Enbu, and authorized PresentationReplay; failed or interrupted runs are retained as such.

| Run | Captured source | Automated result | Visual judgment |
| --- | --- | --- | --- |
| `root-20261025024811` | Early visual integration | Incomplete: public capture-event assertion was invalid | Not accepted |
| `root-20261025025946` | `0fc9de3` | Completed 106 captures | NOT PASS: Hero Follow insufficient; predates transit fixes |
| `root-fa60f9b-20261025-run1` | `fa60f9b` | Interrupted after ENOSPC cleanup failure and discovery of ford completion bug | Not accepted |
| `root-50105ef-20261025-run1` | `50105ef` | Failed: raw track/camera centerline expectations | Not accepted |
| `root-df4e50d-20261025-run1` | `df4e50d` | 128 captures; failed at base-destruction assertion using an obsolete initial projection ID | NOT PASS: lane paving hidden, paused poses indistinct, MID state pair incomplete |

The latest implementation fixes the road ribbon occlusion, Replay-derived paused poses, visible MID progress/contest signals, and offscreen cue hiding. These fixes have unit/type/build verification but **no post-fix five-width browser gallery or independent visual approval yet**. The base scenario genuinely reaches attacker victory at T327 with base HP0; its projected base ID changes from initial `visible-2` to terminal `visible-215` after a visibility gap. The test must resolve each frame's authorized ID, rather than treating projection IDs as permanent identities.

Some complete-run metadata/readmes describe their historical source revision. They do not promote that source or the current HEAD to final acceptance. Physical GPU, physical touch/IME and final art approval remain NOT_CHECKED.

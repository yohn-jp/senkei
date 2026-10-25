# UX Session 2 evidence

Actual production Chromium captures; no mock match or invented observations.
Successful operation reports are written only after a complete per-viewport journey.

| Width | Hero screens | Orders and saved work | Analysis / battle |
| --- | --- | --- | --- |
| 1440px | [S04](1440x900-collection.png) · [S05](1440x900-detail.png) · [S06](1440x900-skill-tree.png) · [S07](1440x900-squad-assembly.png) | [S09](1440-S09.png) · [S14](1440-S14.png) · [S15](1440-S15.png) · [S16](1440-S16.png) | [S13](desktop-1440-analysis.png) · [S12](desktop-1440-confirmed-replay.png) · [operations](1440-journey.json) |
| 1920px | [S04](1920x1080-collection.png) · [S05](1920x1080-detail.png) · [S06](1920x1080-skill-tree.png) · [S07](1920x1080-squad-assembly.png) | [S09](1920-S09.png) · [S14](1920-S14.png) · [S15](1920-S15.png) · [S16](1920-S16.png) | [S13](desktop-1920-analysis.png) · [S12](desktop-1920-confirmed-replay.png) · [operations](1920-journey.json) |
| 320px | [S04](320x740-collection.png) · [S05](320x740-detail.png) · [S06](320x740-skill-tree.png) · [S07](320x740-squad-assembly.png) | [S09](320-S09.png) · [S14](320-S14.png) · [S15](320-S15.png) · [S16](320-S16.png) | [S13](mobile-320-analysis.png) · [S12](mobile-320-confirmed-replay.png) · [operations](320-journey.json) |
| 390px | [S04](390x844-collection.png) · [S05](390x844-detail.png) · [S06](390x844-skill-tree.png) · [S07](390x844-squad-assembly.png) | [S09](390-S09.png) · [S14](390-S14.png) · [S15](390-S15.png) · [S16](390-S16.png) | [S13](mobile-390-analysis.png) · [S12](mobile-390-confirmed-replay.png) · [operations](390-journey.json) |
| 430px | [S04](430x932-collection.png) · [S05](430x932-detail.png) · [S06](430x932-skill-tree.png) · [S07](430x932-squad-assembly.png) | [S09](430-S09.png) · [S14](430-S14.png) · [S15](430-S15.png) · [S16](430-S16.png) | [S13](mobile-430-analysis.png) · [S12](mobile-430-confirmed-replay.png) · [operations](430-journey.json) |

[Quick real-run report](quick-viewport-run-report.json) records the actual five viewport results.
S00 load failure, syntax diagnostics, quota, raw-byte export and Worker retry are exercised by
`tests/browser/specs/ux-completion.spec.ts`; the exact/rematch result-digest and Draft separation
assertions are in `tests/browser/specs/battle-analysis.spec.ts`.

Coverage captures intentionally show Not Proven / NOT_CHECKED. These are producer limits,
not passing behavior proofs. See [the delivery record](../../UX-SESSION-2.md).

Local captures were produced during integration. Final pushed-HEAD build provenance and
full browser reports are recorded by CI artifacts; screenshot existence alone is not acceptance.

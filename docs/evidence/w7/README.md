# W7 graphics review

The screenshots use `moba-three-lane.json` (Replay 0.2) with pixel rendering
enabled at the overview, unless a filename says `smooth`, `zoom`, or
`tracking`. The browser was Nix Chromium 155 with SwiftShader WebGL, so these
captures confirm drawing and interaction in a browser but do not measure
hardware GPU performance.

## Captures

| Viewport | Overview | Attack | Skill | Tower loss | Result |
| --- | --- | --- | --- | --- | --- |
| 1440×900 | [overview](1440x900-overview.png) | [tick 4](1440x900-attack.png) | [tick 6](1440x900-skill.png) | [tick 24](1440x900-tower-collapse.png) | [tick 32](1440x900-result.png) |
| 1920×1080 | [overview](1920x1080-overview.png) | [tick 4](1920x1080-attack.png) | [tick 6](1920x1080-skill.png) | [tick 24](1920x1080-tower-collapse.png) | [tick 32](1920x1080-result.png) |
| 390×844 | [overview](390x844-overview.png) | [tick 4](390x844-attack.png) | [tick 6](390x844-skill.png) | [tick 24](390x844-tower-collapse.png) | [tick 32](390x844-result.png) |
| 430×932 | [overview](430x932-overview.png) | [tick 4](430x932-attack.png) | [tick 6](430x932-skill.png) | [tick 24](430x932-tower-collapse.png) | [tick 32](430x932-result.png) |

Additional desktop captures show confirmed vitals at tick 7, respawn at tick
15, neutral camp loss at tick 30, selection tracking at tick 2, zoom, and the
smooth render mode. The browser run reported no page errors and successfully
rendered all four viewports. At 1440×900, clicking Bannerhold selected its
public `F01` catalog entry; enabling tracking changed the camera state.

## Visual notes

- The overview keeps both corner bases, three diagonal lanes, six towers,
  jungle clearings, bridges, and the three metadata-defined camps in view.
- Lane labels separate at the blue-side approaches. Team identity remains
  visible through geometry and banners as well as cyan and vermilion color.
- The twelve fixture heroes use distinct weapon and armor silhouettes. Their
  differences are clearer in the zoom capture; pixel mode keeps the wider
  diorama legible at mobile size, while smooth mode shows the same geometry at
  canvas resolution.
- Skill, damage, vitals, spawn, and destruction cues use only Replay events.
  The tower and monster debris remain visible at the recorded loss ticks.
- The mobile screenshots keep the map, reset, zoom, pixel toggle, seek, and
  playback controls within the viewport.

`moba-three-lane.json` is an explicitly synthetic catalog showcase. It places
six heroes on each side to show all twelve available appearances together, so
its roster and sample result do not represent a valid Next match or balance
claim. Mobile captures use touch emulation, not physical mobile hardware.

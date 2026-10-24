# Real Next Senritsu evidence

These captures were produced by `tests/browser/specs/next-workbench.spec.ts`
against the production Vite build, the bundled Senritsu ruleset, the real WASM
worker, and `presentationToGraphics`. They are separate from the synthetic
12-model renderer fixture in [W7](../w7/README.md). The local Playwright suite
passed all 9 browser cases, including the five-viewport Atelier matrix, in Nix
Chromium 155 with SwiftShader.

## Battlefield and replay

| Capture | Scenario |
| --- | --- |
| [1440×900 Pixel battle](desktop-battle.png) | Final tick 227, Pixel mode, real base-destruction result |
| [1920×1080 Pixel battle](desktop-battle-1920.png) | Final tick 227, Pixel mode; full stage and all three lanes visible |
| [1440×900 Smooth comparison](real-replay-smooth-1440.png) | Final tick 227 in Smooth mode, paired with the [before capture](before/desktop-battle.png) at the same viewport, tick, and mode |
| [Tick 50 overview](real-replay-overview-1440.png) | Real match in Pixel mode with all lanes, bases, towers, forest routes, and camps in view |
| [Tick 50 follow](real-replay-follow-1440.png) | Visible Hero selected from the live entity list, Follow plus three zoom steps, then Overview reset verified |
| [Replay analysis](analysis-1440.png) | Event timeline and synchronized event seek back to the battlefield |
| [WebGL loss pause](webgl-context-lost-1440.png) | Browser context loss holds tick 50 and offers the renderer retry action |
| [Mobile 390×844](mobile-battle.png), [430×932](mobile-battle-430.png), [320×740](mobile-battle-320.png) | Real match map with mobile camera controls and replay transport in the viewport |

The [browser recording](next-workbench.webm) shows the real match journey:
Hero selection, skill planning, Jinrei editing and compilation, replay and
analysis, follow/zoom/overview, renderer recovery at the held tick, rematch,
offline recovery of unsaved changes, restore of the pinned setup, and offline
simulation.

The 1440×900 desktop and mobile screenshots from before the update are in
[before/](before/). The desktop comparison uses Smooth mode at final tick 227
for both captures; the new Pixel screenshots document the default mode
separately. The Smooth browser screenshot records the top page viewport, so
the battlefield is only partly in that frame; use the Pixel battle and tick-50
overview captures above for the complete current route composition. This is a
mode-and-tick matched reference, not a pixel-aligned composition comparison.

## Hero Atelier viewport matrix

Each viewport has Collection, Detail, Skill Tree, and Squad Assembly captures.
The catalog, chosen branch, and selected squad split are visible in the
corresponding images. Mobile captures also show the Save and recovery
disclosure opened and reachable.

| Viewport | Collection | Hero Detail | Skill Tree | Squad Assembly | Save disclosure |
| --- | --- | --- | --- | --- | --- |
| 1440×900 | [image](atelier/1440x900-collection.png) | [image](atelier/1440x900-detail.png) | [image](atelier/1440x900-skill-tree-plan.png) | [image](atelier/1440x900-squad-assembly.png) | — |
| 1920×1080 | [image](atelier/1920x1080-collection.png) | [image](atelier/1920x1080-detail.png) | [image](atelier/1920x1080-skill-tree-plan.png) | [image](atelier/1920x1080-squad-assembly.png) | — |
| 390×844 | [image](atelier/390x844-collection.png) | [image](atelier/390x844-detail.png) | [image](atelier/390x844-skill-tree-plan.png) | [image](atelier/390x844-squad-assembly.png) | [image](atelier/390x844-save-disclosure.png) |
| 430×932 | [image](atelier/430x932-collection.png) | [image](atelier/430x932-detail.png) | [image](atelier/430x932-skill-tree-plan.png) | [image](atelier/430x932-squad-assembly.png) | [image](atelier/430x932-save-disclosure.png) |
| 320×740 | [image](atelier/320x740-collection.png) | [image](atelier/320x740-detail.png) | [image](atelier/320x740-skill-tree-plan.png) | [image](atelier/320x740-squad-assembly.png) | [image](atelier/320x740-save-disclosure.png) |

## Scope and limits

Browser checks cover layout overflow, the desktop battlefield host width and
height, live replay advancement and pause, exact event seek, visible-Hero
follow, camera zoom/reset, exact-tick context-loss recovery, rematch, mobile
transport visibility, recovery after offline reload, and restoration of the
pinned setup. The test also checks that the versioned WASM binary is served by
the service worker.

This is browser-emulation evidence, not a hardware GPU or physical-phone
acceptance result. No approved Hero character model is bundled; the present
procedural silhouettes and catalog illustrations remain unapproved for visual
or art acceptance. The evidence does not claim that gate as passed. See the
[implementation report](../../implementation/PR3-G2-FOLLOWUP.md) for the
remaining review status.

The [56-case balance report](balance.json) records package digest, outcomes,
termination classes, and scenario data. It is separate from these browser
captures.

# C12 nested workspace tab focus reproduction

Product source: `54011ea` (main). Fresh Core WASM SHA-256: `8ec4c1b4dcb9b5acb6fa59322aa6e8398db72fdd4ed1632af6dcb122326f59ea`.

A production build ran on port 4204 with Chromium and software WebGL. No request interception, fixture UI or Enbu battle was used. These are browser viewport checks, not physical-device acceptance.

The new `workspace-tab-focus.spec.ts` ran Hero Atelier and Jinrei screen tabs at 320, 390, 430 and 1440 pixels. All eight cases reproduced the same failure:

| Operation | Selected panel | Focus after two animation frames |
| --- | --- | --- |
| Hero Collection → ArrowRight | Hero Detail / S05 | `h2` Battle workbench, instead of selected tab |
| Hero Detail → ArrowLeft | Hero Collection / S04 | `h2` Battle workbench, instead of selected tab |
| Jinrei Workbench → ArrowRight | Behavior Coverage / S09 | `h2` Battle workbench, instead of selected tab |
| Behavior Coverage → ArrowLeft | Jinrei Workbench / S08 | `h2` Battle workbench, instead of selected tab |

Each case had exactly two failed assertions: the two keyboard focus checks. Selection, ordinary screen entry and reentry heading controls passed. Hero's ordinary Inspect button still focused a heading; Home and Next navigation focused a visible current-screen heading. All cases loaded actual WASM with HTTP 200 and had no page errors. The recorded states are in [red-summary.json](red-summary.json).

Hero Atelier explicitly focuses the target tab in its keyboard handler. Jinrei's parent keyboard handler similarly focuses and activates the target tab. Both change the parent's `viewKey`, whose next animation frame focuses the first visible heading. The current guard only exempts Library tabs. This distinguishes the reproduced tab defect from intended heading focus after ordinary navigation.

Proposed minimal fix, pending NextWorkspace ownership handoff: exempt a focused element only when it is inside the workspace host, has `role="tab"` and `aria-selected="true"`, and has a visible layout box. Preserve normal heading focus otherwise. Keep the existing Library view-key behavior. No production files were changed during reproduction; Library's existing regression was not repeated.

Reproduce after a production build using the verified WASM artifact:

```sh
SENKEI_BROWSER_PORT=4204 SENKEI_CHROMIUM_EXECUTABLE=/usr/bin/chromium npx playwright test --config tests/browser/playwright.config.ts tests/browser/specs/workspace-tab-focus.spec.ts --workers 1
```

Detailed local run output: `/workspace/scratch/tab-focus-red.log`. Each failed test also saves a screenshot, trace, and `focus-states.json` attachment under `tests/browser/test-results/`.

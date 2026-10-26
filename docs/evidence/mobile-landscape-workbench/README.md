# Jinrei editor: short landscape evidence

## Change

At 844×390, the Next workspace previously kept a 190px app sidebar and a 140px inner sidebar. The available editor then received the global 900px editor rule's two columns, even though the main panel was only 426px wide. The Jinrei source textarea measured 163.78px.

The short-landscape rules move both navigation rails into horizontal rows and stack the Jinrei source ahead of its configuration fields. They are limited to landscape viewports 761–1000px wide and at most 500px tall. Existing 760px breakpoints are unchanged.

## Verification

The C12 browser flow edited Jinrei Text at 390×844, went Home, explicitly entered Next, and checked the returned Jinrei workspace, Jinrei Workbench screen, and Jinrei Text view before selecting any tabs. At 844×390 it appended to that same unsaved Draft, then restored portrait and checked 320×844, 430×932, 1440×900, and 1920×1080. The Draft remained unchanged after the landscape edit and `COMPILE REQUIRED` stayed visible. No horizontal overflow or page errors occurred.

| Viewport | Source width before | Source width after |
| --- | ---: | ---: |
| 844×390 | 163.78px | 758.25px |
| 390×844 | 306px | 306px |
| 320×844 | 236px | 236px |
| 430×932 | 346px | 346px |
| 1440×900 | 629.73px | 629.73px |
| 1920×1080 | 959.5px | 959.5px |

`npm run build` passed. The browser spec passed on Chromium 156 at port 4193; its local production preview loaded WASM SHA-256 `ae2f786e671bc99b34dea4e97120179380c7bac6aadc1e9068b071f1e1454c2a`.

## Navigation sizing follow-up

Commit `1b08ef1` retains a 44px minimum height for the outer navigation items in this short-landscape layout. The same C12 operation passed again with no loss in the 758.25px editor width. Its browser report measured the primary navigation row at 44px and each of its four items at 44px. These are observed dimensions for this viewport, not a new test threshold.

## Evidence

- `before-7007aa4/`: baseline fixed-view captures and layout report from the unmodified 7007aa4 CSS.
- `after-70a91f3/`: fixed-view captures and layout report tested against implementation commit 70a91f3.
- `after-1b08ef1/`: repeat fixed-view captures and report tested against the 44px navigation follow-up commit.
- `after-70a91f3/landscape-844-app-navigation.png` and `landscape-844-workbench-navigation.png`: the two navigation rows at their respective scroll positions.
- `after-70a91f3/landscape-844.png`: the editable source field at 844×390.
- `after-1b08ef1/report.json`: the primary navigation and item heights measured during the follow-up C12 run.

The browser resized its emulated viewport. Physical device rotation, touch input, and keyboard/IME behavior were not checked.

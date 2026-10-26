# Local Codex — 保存済み成果の再開入口

実行条件は[LOCAL-CODEX-GOAL.md](LOCAL-CODEX-GOAL.md)。本書は起動用の照合点であり、製品仕様や完了報告ではない。準備開始時のmainは `fdd6c9c3b4f1fcbc07d6bbe37dad05a11a49eee3`。実行時の最新mainから始め、下表の保存HEADと現行remoteを比較する。変更済みなら差分を確認し、古いコードへ戻さない。

## 1. 回収するref

| 保存対象 | Remote branch / 保存HEAD | 入口と注意 |
| --- | --- | --- |
| [PR #23](https://github.com/yohn-jp/senkei/pull/23) Coverage・緊急引継ぎ | `chore/wave1-coverage` / `90a116000f09d93cdf4d3a4fc4117db3217f4e68` | `docs/implementation/canonical-coverage/EMERGENCY-HANDOFF-2026-10-26.md`。47文書／2,682原文単位は完成要件数ではない |
| [PR #40](https://github.com/yohn-jp/senkei/pull/40) Campaign | `feat/wave5-campaign-live` / `9df16f0aedae917067ec06c427cb9333a4d645e5` | `docs/implementation/CAMPAIGN-PR40-REVIEW.md`。保存失敗後のCore再試行で進行消失。修復前にmainへ入れない |
| [PR #45](https://github.com/yohn-jp/senkei/pull/45) 修正対象へのfocus | `feat/repair-focus-producers` / `7c7801ec8a3990437ba616784b0707b8cf1eeeeb` | Hero/Jinreiのproducer。Readyの親結線は未了 |
| [PR #46](https://github.com/yohn-jp/senkei/pull/46) Import／Core失敗時Export | `fix/wave7-experiment-import` / `811c36482fb334f7148bc073858d51da889a61ae` | `docs/implementation/EXPERIMENT-IMPORT-ASSESSMENT.md`。独立レビューと統合後検証を実施 |
| [PR #47](https://github.com/yohn-jp/senkei/pull/47) Skill実取得UI | `feat/s06-skill-live` / `4f0cd8c2c7642b46f97824a07514701a4ea15c14` | #45の古い祖先を含む。`skillRunContext`の親結線は未了 |
| [PR #48](https://github.com/yohn-jp/senkei/pull/48) 3種類の再戦 | `feat/improved-rematch-ui` / `a57f4ee5cc0023f23c7e50cd507b4e6531eed2cc` | `docs/implementation/C08-UI-WIP-HANDOFF.md`。#46を含むWIP。実ブラウザ受入は中断 |
| [PR #44](https://github.com/yohn-jp/senkei/pull/44) 3D制作 | `art/3d-production` / `d5cfd807a5a00e492fd0cbb733b9300e0dc0ed5a` | `docs/3D-RESUME.md`、`docs/3D-PRODUCTION-CONTRACT.md`、`docs/3D-PRODUCTION-STATUS.md`、`tools/art/README.md`。Golden候補はF01/R01、未採用 |
| Mobile操作WIP | `fix/mobile-battle-controls` / `c780293e7119663fbb2f420f428199256dc8ba9e` | CSSと5幅の画像・probe。HEAD単位の実操作再確認が必要 |
| Recovery probe | `fix/wave8-recovery-retry` / `715aca51fce1342b438ce15c291fe71d513189b0` | `tests/browser/specs/recovery-core-quota-retry.spec.ts`。特定Draftの証拠をCampaign／全Runへ一般化しない |

上記の未マージ文書はmainにあると仮定しない。fetch後に、例えば次で読める。

```sh
git show origin/chore/wave1-coverage:docs/implementation/canonical-coverage/EMERGENCY-HANDOFF-2026-10-26.md
git show origin/art/3d-production:docs/3D-RESUME.md
```

過去の `integration/wave1`、`integration/autonomous-wave2`、`integration/autonomous-wave3`、`recovery/skill-consumer-workdir-merge` は保全refであり、まとめてmergeする対象ではない。既にmainへ入った変更と事故的なmerge backupを含むため、commitの到達関係と実diffで必要なものだけ回収する。削除や作り直しを先に行わない。

## 2. 最初の並列作業と統合順

**Product側**は #45と#46のレビュー・必要な修復を独立して進め、共有画面の書込み担当を一人決める。**Art側**は #44で不足している制作スコアをGoalの基準で補い、最新モデルを再撮影・再評価する。**Coverageの確認は並行**し、全原文の再棚卸しを制作の開始条件にしない。

Product共有画面担当は、#46の保存安全性を維持した基準上で #40、C04修正導線、#47親結線、#48の状態遷移を順に合成する。どのPRを先にmainへ入れるかは現在の差分と検証で決め、古いPR番号順に機械的mergeしない。レビューは親または変更者以外のサブエージェントがその場で実施する。

### 再調査のやり直しを避ける既知事項

- **#40：** 容量不足で保存できなかった実勝利の進行を、同じRulePackageのCore再試行が古い保存値で上書きする。保存済みREDは `docs/evidence/campaign-review/quota-retry-red.json`。読込世代guardだけでは新しいin-memory進行を保護しない。既存の不正raw保全を壊さず修復し、同じ操作列をGREENにする。
- **#45→#47：** 保存HEADでは、#45の `repair-focus.ts` は空文字判定が `target.slotId.length === 0`、#47側は旧 `!target.slotId.trim()`。Coreで合法なU+FEFFを不当に拒否しない最新修正と回帰テストを保持する。#47を単独で完成扱いにしない。
- **#46→#48：** #48は#46を既に含む。重複cherry-pickを避け、merge後にimportの検証前書込みやCore停止時export不可を復活させない。診断checkboxがfrozen再戦を解除する未解決点を修正し、Exact／Improved／Currentの意味を保持する。
- **C04／S06：** `NextWorkspace`から実際の修正対象・sourceと、不変Run／認可済み視点／Match／Tick／slotを渡す。component harnessのPASSだけでは未結線を解消しない。
- **#44：** `bfb0428`の顔・布・裾修正と`66ab880`の低LOD動作に対し、保存画像はそれ以前の証拠。旧画像で新モデルを合格判定しない。中・遠LODが共通Armor材質へ集約される箇所は、R01の布の見え方を比較する。Sophiaの探索・対応付けは不要。
- **残る全Goal：** Behaviorの定義済み静的競合検証、既存機構の本番接続、未検証UX／認可／保存／実機受入も台帳へ保持する。未定義のProduction方針・経済数値を捏造せず、装備・関係性の確定済み操作まで一括保留にしない。

## 3. ローカルで使う証拠と再検証

PR #23の `docs/implementation/canonical-coverage/session-checkpoint-20261026/artifact-manifest.json` が、実Enbu export、Native比較記録、WASM等の7圧縮ファイルの元サイズとSHA-256を持つ。必要なものだけ取り出し、展開後に照合する。archiveされたWASMは限定的な旧証拠再現用であり、変更後のNative/WASM一致や新HEADのbuild成功を証明しない。

再開時にmainと採用候補HEADのCIを確認し、queued／cancelled／古いHEADの成功をPASSにしない。主要browser検証は `tests/browser` のnpm-prefix cwd、専用component config、独立出力先を使う既存修正を保持する。新環境の絶対path、preview port、依存packageの解決先を確認する。

この準備で既存PRの実装をmergeしたり、全テスト／実ブラウザ／全圧縮ファイルの再検証を済ませたという主張はない。再開後は親が既存Coverageを一つの現行状態表へ更新し、所有権・依存・統合SHA・受入証拠・残件を管理する。本書の保存HEAD一覧は出所として残し、日々の状態を別の履歴文書へ増殖させない。

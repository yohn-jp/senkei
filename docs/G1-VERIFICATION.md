# Graphics G1 — 実装と検証

G1の対象は固定JSON Fixture → Decoder → Replay Player → Three.js / WebGL2戦場 → Desktop / Mobile操作UI。`npm run dev`の`/graphics/`、または本番配信の`/graphics/index.html`から利用する。既存のPvEワークスペースから「サンプル演武」で開ける。

開始時のmainは`0811f05`。作業中に追加されたmain `9a2df29`も取り込み、既存のPvEページ・Rust実装・Worker・WASM・保存機能を保持した。G1は別HTMLエントリーポイントを持ち、Enbu出力へのAdapterは追加していない。3Dページで戦闘Worker / WASMを要求しないことをブラウザで検査する。G2以降は対象外。

## 独立した受入判定

| ゲート | 結果 | 証拠 |
| --- | --- | --- |
| 実装 / Contract・Correctness | PASS | Schema正常・異常、意味検証、同Tick全順序、全Tickの直接シークと順次再生の一致、25単体テスト |
| 型検査 / production build | PASS | `npm run build`。既存ワークスペースとG1の両方を型検査・ビルド |
| 実ブラウザ操作 | PASS | Playwright / Chromiumの9テスト。操作、4サイズ、エラー復帰、全編再生動画、既存ページからの導線 |
| Visual / Art | PASS（G1範囲） | 固定条件のスクリーンショットを実際に開き、地形・影・3レーン・両陣営・3兵科・UIを評価 |

## 再実行

```sh
npm ci
npm run contract:types
git diff --exit-code -- packages/replay-contract/src/generated.ts
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:browser
```

`npm run test:browser`は本番プレビューを起動する。別サーバーが4173ポートにある場合は再利用するため、production検証時には停止してから実行する。NixホストでChromiumの共有ライブラリが自動解決されない場合は、ホストのChromium実行環境に対応する`LD_LIBRARY_PATH`を用意する。この検証ではインストール済みのNixライブラリを使用した。機械固有の絶対パスをリポジトリへ固定しない。

既存PvEの回帰確認は次のコマンドで別途実行する。3テスト（ローカル導線、実WASMの7ケース、オフラインPvE）がPASS。これはG1の起動要件ではない。

```sh
bash scripts/wasm/build.sh
npm ci --prefix tests/browser
npm run build
npm run test:e2e --prefix tests/browser
```

ViteはThree.jsを含むgraphics JSのサイズ警告を出す（約745 kB、gzip約180 kB）。本番ビルドは成功し、既存PvEとG1は別エントリーとして出力される。性能最適化・密集軍表示の判定はG2以降。

## 固定した画面条件と証拠

Fixtureは`tower-collapse`。Tick 0（初期）、13（交戦・被害）、23（塔破壊）、28（終局）および`malformed-replay`を取得する。各撮影は停止状態、Pixel描画ON、選択なし、標準カメラ、`prefers-reduced-motion: reduce`。シーク操作にはキーボードを使用し、タイムラインのフォーカス枠も写る。WebGL2はChromiumのSwiftShaderで実描画している。ハードウェアGPU性能を測定したという意味ではない。

標準カメラはDesktopで`(14,28,32)`、Mobileで`(34,34,9)`から原点を向く正投影。Mobileは縦横比に合わせて画角を広げる。戦場だけを縦横約1/2のRenderTargetへ描画してnearest拡大し、文字・ラベル・操作UIはDOMで元解像度を保つ。

| Viewport | 初期 / Tick 0 | 交戦 / Tick 13 | 塔破壊 / Tick 23 | 終局 / Tick 28 | 不正データ |
| --- | --- | --- | --- | --- | --- |
| 1440×900 | [画像](evidence/g1/1440x900-initial.png) | [画像](evidence/g1/1440x900-clash.png) | [画像](evidence/g1/1440x900-tower-collapse.png) | [画像](evidence/g1/1440x900-result.png) | [画像](evidence/g1/1440x900-invalid.png) |
| 1920×1080 | [画像](evidence/g1/1920x1080-initial.png) | [画像](evidence/g1/1920x1080-clash.png) | [画像](evidence/g1/1920x1080-tower-collapse.png) | [画像](evidence/g1/1920x1080-result.png) | [画像](evidence/g1/1920x1080-invalid.png) |
| 390×844 | [画像](evidence/g1/390x844-initial.png) | [画像](evidence/g1/390x844-clash.png) | [画像](evidence/g1/390x844-tower-collapse.png) | [画像](evidence/g1/390x844-result.png) | [画像](evidence/g1/390x844-invalid.png) |
| 430×932 | [画像](evidence/g1/430x932-initial.png) | [画像](evidence/g1/430x932-clash.png) | [画像](evidence/g1/430x932-tower-collapse.png) | [画像](evidence/g1/430x932-result.png) | [画像](evidence/g1/430x932-invalid.png) |

[WebGLコンテキスト喪失](evidence/g1/1440x900-webgl-lost.png)では再生が止まり、再試行でCanvasを再生成する。WebGL2非対応の経路もブラウザテストで検査する。[全編再生動画](evidence/g1/animated-replay.webm)は通常モーションの進軍・攻撃・被害・崩壊・確定終局を記録する（1440×900を960×600へ縮小録画）。

## 目視レビューと修正

| 位置 / 観測 | 影響 | 最小修正 / 再確認 |
| --- | --- | --- |
| Desktop戦場中央、初回のジオラマが小さかった | 戦場が主役にならず兵科が読みにくい | 正投影の画角を拡大。地形の断面・経路の段差・施設の影が見えることを再確認 |
| 初期レーン、兵士と塔が重なっていた | 3兵科の輪郭が隠れる | 固定Fixtureの初期隊列を塔の前へ移動。長槍、幅のある大盾、フードと弓を確認 |
| Mobile 430px、戦場端の余白が小さかった | 地形が端に寄りすぎる | Mobile画角を縦横比に合わせて補正。390px / 430pxの全景を再確認 |
| カメラ復帰後に回転慣性が残った | 標準画角へ戻らない | OrbitControlsの慣性を消してから姿勢を復元。ドラッグ→復帰を4サイズで検査 |
| エラー時の兵数欄に0を表示していた | 未読込と既知の0体を区別できない | 読込不正時は「—」を表示し、Desktopのエラー画面を再撮影 |
| 兵の盾が進軍と逆方向を向いていた | 陣営の前進方向が読み取りにくい | 蒼軍は+x、朱軍は−xを向くよう表示姿勢を修正し、初期・交戦画像を再確認 |
| カメラ復帰の文字記号が欠けた | 操作の意味が伝わりにくい | 自作SVGの照準アイコンへ交換。Desktop / Mobileで表示確認 |

Desktopは地形、橋、施設、影が最も大きい面積を占める。Mobileは側面パネルを出さず、縦向きカメラ、Fixture選択、下部再生盤に集中する。レーンラベルと陣営の旗・頭飾り・色、兵科の装備シルエットで区別できる。Mobile全景では小さい武器の細部が縮むため、拡大ボタン・ピンチで観察する。塔破壊後には瓦礫が残り、終局はFixtureのResultだけを表示する。攻撃CueからHPや勝敗を計算しない。

## 未検証・制約

- 実機のタッチ・ピンチ・IME、Safari / Firefox、ハードウェアGPUでの性能はNOT_CHECKED。MobileはChromiumのViewport / touchエミュレーション。マウスのドラッグ・ズーム、タップ選択、明示的なズーム / カメラ復帰は検査済み。
- 320pxと横向き844×390は横スクロールがなく、スクロールで主操作へ到達して再生・シークできることを確認。画面証拠の必須4サイズとは別の操作検証。
- 完成版アート、密集軍、全兵科のモーション、Enbu実出力との接続、編集画面の統合、公式PvPは対象外。Checkpointは未採用で、各TickをInitialViewから再構築する。
- 任意の文字列から秘密情報の意味を検出する契約ではない。Schemaは許可フィールド以外を拒否し、将来のProducerには許可リスト方式の公開投影が別途必要。
- ローカル結果とGitHub CI結果は別の証拠。CIの結果はPRのチェック欄で確認する。

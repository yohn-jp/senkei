# Senkei アーキテクチャ文書

## 正本の範囲

本ディレクトリは、合意された製品・実行モデルの設計正本を保存します。文書内の区分を混同しないでください。

- **確定**: 本プロジェクトの設計制約。変更する場合は文書の意思決定として見直す。
- **推奨**: 実装開始時の合理的な候補。実測・検証で変更可能。
- **合意案**: 文書PRで承認を求めている追加規範。PR作成だけで採用済み・実装済みにしない。
- **未決定**: 会話上まだ確定していないゲームバランス、API、語彙、文法など。勝手に仕様化しない。

## 文書一覧

| 文書 | 担当する設計領域 |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | ユーザー、体験、非目標、学習の導線 |
| [DESIGN-DECISIONS.md](DESIGN-DECISIONS.md) | **G01–Q03の合意事項と保留の台帳** |
| [EQUIPMENT.md](EQUIPMENT.md) | **装備資産・性能ランク・戦力と戦略の追加合意** |
| [HERO-RELATIONSHIPS.md](HERO-RELATIONSHIPS.md) | **非対称な信頼・関係グラフ・会話とSquad連携の追加合意** |
| [REWARDS-AND-LIBRA.md](REWARDS-AND-LIBRA.md) | **装備報酬・市場・Libraの決定事項と保留境界** |
| [FOG-OF-WAR.md](FOG-OF-WAR.md) | **視界・探索済み地形・最終観測鮮度** |
| [TACTICAL-LOOP.md](TACTICAL-LOOP.md) | **Replay→分析→Jinrei修正→比較のUX** |
| [ART-DIRECTION.md](ART-DIRECTION.md) | **Faceted Low-Poly・表示モード・LOD** |
| [QUALITY-AND-RETIREMENT.md](QUALITY-AND-RETIREMENT.md) | **品質ゲート・旧実装の原則削除と不採用知識** |
| [GAMEPLAY.md](GAMEPLAY.md) | 3レーン戦略・兵力・攻守・戦闘ループ |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Local-first、コンポーネント・境界・データ |
| [COMPONENTS.md](COMPONENTS.md) | **名称・責務の正本**: Senkei / Jinrei / Senritsu / Enbu |
| [JINREI.md](JINREI.md) | Jinrei言語コアとルール依存の区別 |
| [JINREI-GRAMMAR.md](JINREI-GRAMMAR.md) | **Jinrei文法v0.1の正本**：状態・行動、三値論理、集合、順序とCU |
| [SENRITSU.md](SENRITSU.md) | Senritsuのルールパッケージ、拡張と型付きCapability |
| [DOMAIN-CATALOG.md](DOMAIN-CATALOG.md) | **Senritsuの自己記述Catalog正本**：変数・定数・集合・Capability・Profile・CU |
| [WORLD.md](WORLD.md) | **次期Senritsuゲームデザイン**：MOBAマップ・Minion・視界・中立拠点 |
| [WORLD-DEFINITION.md](WORLD-DEFINITION.md) | **World Definitionの正本**：Topology/Metric/Terrain/Presentation、Compiler、Digest分離 |
| [BATTLEFIELD.md](BATTLEFIELD.md) | **戦場ルールの正本**：トポロジー・距離・橋・3トラック・交戦境界 |
| [BATTLEFIELD-VISUAL.md](BATTLEFIELD-VISUAL.md) | **実Battlefieldの視覚受入正本**：地理・造形・カメラ・Desktop/Mobile・実画面検証 |
| [UNITS.md](UNITS.md) | **次期Senritsuゲームデザイン**：5 Hero・12種Catalog・Squad・死亡復活 |
| [BEHAVIOR.md](BEHAVIOR.md) | **自律判断の正本**：Hero Default、Squad/Army継承、Jinrei条件付き上書き、Decision Trace |
| [COMBAT.md](COMBAT.md) | **次期Senritsuゲームデザイン**：通常戦闘・移動・XP・Skill Tree |
| [BALANCE.md](BALANCE.md) | **次期Senritsuバランスの正本**：合意倍率・未決数値・対戦検証 |
| [ENBU.md](ENBU.md) | Enbuの状態遷移、実行境界と結果 |
| [TACTICS.md](TACTICS.md) | ノーコードと生コード、型付きIR、戦術VM、CU |
| [EXECUTION.md](EXECUTION.md) | コンパイル方式、論理CU、物理最適化、戦闘エンジンの入出力・秘匿境界 |
| [GRAPHICS.md](GRAPHICS.md) | **グラフィックの正本**：Pixel 3D、3D制作、画風、レンダラー |
| [HERO-ATELIER.md](HERO-ATELIER.md) | **G2 Hero専用画面・Stylized 3D共通アート**：Collection／Detail／Skill Tree／Squad |
| [REPLAY.md](REPLAY.md) | **Enbu/Renderer表示契約**：Schema、Tick、投影・秘匿性 |
| [UI-DESIGN.md](UI-DESIGN.md) | Desktop/Mobile別のUI・操作・状態設計 |
| [PLAYER-JOURNEY.md](PLAYER-JOURNEY.md) | **ゲーム開始前UXの正本**：プレイヤー必須入力、初回・Custom・復元、開始可能性 |
| [PRE-BATTLE-FLOWS.md](PRE-BATTLE-FLOWS.md) | **全画面遷移図の正本**：S00〜S15、Quick/Custom/Campaign/Resume/開始/失敗/再戦、Desktop/Mobile |
| [PRE-BATTLE-SCREENS.md](PRE-BATTLE-SCREENS.md) | **画面別契約・低忠実度ワイヤフレーム**：表示/操作/戻り/検証/復旧、受入テスト |
| [UX-INTERACTION-CONTRACTS.md](UX-INTERACTION-CONTRACTS.md) | **合意案**：閲覧と変更、対戦・分析文脈、修正先、比較、保存、復帰の操作契約 |
| [PROGRESSION-UX.md](PROGRESSION-UX.md) | **将来拡張の合意案**：報酬・装備庫・市場・関係グラフ・会話の入口から復帰まで |
| [JINREI-EDITOR.md](JINREI-EDITOR.md) | **Jinrei編集UX正本**：Domain探索、Hero別Coverage、Default/Effective/Observed、Trace |
| [GRAPHICS-DELIVERY.md](GRAPHICS-DELIVERY.md) | 描画の段階実装、Fixture、検証・スコープ |
| [SIMULATION.md](SIMULATION.md) | 決定論、実行順序、再現、デバッグ・安全性 |
| [ONLINE.md](ONLINE.md) | 将来の非同期PvP、公式戦、ランキング、Cloudflare |
| [DELIVERY.md](DELIVERY.md) | 実装順・各段階の完了条件・未決定事項 |
| [implementation/WEB-API.md](implementation/WEB-API.md) | React shell・Web Worker・WASM間の型付き境界 |

## 優先順位

1. 明示的に合意した製品原則と現在の実装範囲。
2. ドメイン・言語・シミュレーションに関する正本。
3. Web UIやインフラの推奨技術。
4. 例示した兵科、数値、名前、アルゴリズム。

数値・コード例は、明示的に確定と書かない限り仕様値ではありません。4名称と責務は [COMPONENTS.md](COMPONENTS.md) を正本、表示契約は [REPLAY.md](REPLAY.md) を設計正本とします。Jinreiの表層構文・評価意味論は [JINREI-GRAMMAR.md](JINREI-GRAMMAR.md) に確定済み。CU単価と既存Senritsuのゲーム数値はルールパッケージで具体化します。最新のMOBA型Hero/Squad/Minion/ジャングル設計は [WORLD.md](WORLD.md)／[BATTLEFIELD.md](BATTLEFIELD.md)／[UNITS.md](UNITS.md)／[COMBAT.md](COMBAT.md)／[BALANCE.md](BALANCE.md) に区分して記録する。Worldの宣言的定義・Compilerは [WORLD-DEFINITION.md](WORLD-DEFINITION.md)、既定行動とJinrei上書きは [BEHAVIOR.md](BEHAVIOR.md)、型付き語彙は [DOMAIN-CATALOG.md](DOMAIN-CATALOG.md)、編集・Coverageの体験は [JINREI-EDITOR.md](JINREI-EDITOR.md) を専用正本とする。これらの新規契約を**現行senkei.initial、G1 Fixture、または未マージの実装に既に存在する機能とみなさない**。

装備とHero関係性の追加合意は [EQUIPMENT.md](EQUIPMENT.md)／[HERO-RELATIONSHIPS.md](HERO-RELATIONSHIPS.md)、装備報酬とLibraの合意境界は [REWARDS-AND-LIBRA.md](REWARDS-AND-LIBRA.md) を参照する。これらの設計採用は、既存G2の受入条件への自動追加やオンライン基盤の採用を意味しない。

## UI操作仕様と検証記録の分離

UX-INTERACTION-CONTRACTSは採用後に画面間の状態保持・操作結果を所有し、PRE-BATTLE-FLOWS／SCREENSと相互参照する。PROGRESSION-UXは追加機能を実装する段階の導線であり、現在のG2とは別の適用範囲を持つ。

[implementation/UX-FLOW-GAP-REVIEW.md](implementation/UX-FLOW-GAP-REVIEW.md) は特定SHAのコードと文書を照合した根拠記録であり、正本や実画面の受入証明ではない。実装未達、文書の空白、将来拡張、実機未検証を分けて読む。

## 変更の作法

契約を変更する実装は、該当する文書も更新します。実装と設計上の将来案を混在させず、将来のAPIやPvPを初期MVPの必須依存として導入しません。仕様文書には日付を埋め込まず、履歴はGitで追跡します。

現在の追加実装と未接続境界は [Wave 2 checkpoint](implementation/canonical-coverage/WAVE2-CHECKPOINT.md) を参照する。設計確定と実行検証のPASSを区別する。

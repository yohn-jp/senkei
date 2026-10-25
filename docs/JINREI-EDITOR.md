# JINREI-EDITOR — 戦術編集・Domain探索・Behavior Coverage・Decision TraceのUI正本

## 1. 目的・対象

**プレイヤーが「指定しなかったらどう動くか」「Jinreiで何が変わるか」「実戦でなぜその行動になったか」を、各HeroからArmyまで横断して理解するための専用Editor**を設計する。

- Jinreiの文法・三値論理・同時評価・CUは[JINREI-GRAMMAR.md](JINREI-GRAMMAR.md)が正本。Editor都合の新しい構文は導入しない。
- 利用可能な語彙・Profile・CapabilityはSenritsuの自己記述的[DOMAIN-CATALOG.md](DOMAIN-CATALOG.md)から取得する。
- Hero/Squad/Army/Minionの行動選択と上書きは[BEHAVIOR.md](BEHAVIOR.md)。実行結果・公開性は[ENBU.md](ENBU.md)／[REPLAY.md](REPLAY.md)に従う。
- 既存の[UI-DESIGN.md](UI-DESIGN.md)と[HERO-ATELIER.md](HERO-ATELIER.md)の編成・編集文脈を維持する。Desktopは情報を横断し、Mobileは専用の操作モデルとする。

## 2. 必須の4つの視点

| 面 | 仕事 | 表示の根拠 |
| --- | --- | --- |
| **Jinrei Source/No-code** | 同じv0.1構文・型付きCapabilityを編集／コンパイル | Compiler、Senritsu Catalog |
| **Domain Catalog Explorer** | 現行RulePackageで使える定数・変数・集合・Profile・Capability・CUを探す | SenritsuのValidated Domain Catalog |
| **Behavior Coverage Explorer** | Hero/Squad/Armyの状態ごとにExplicit/Inherited/Default等と実効行動・空白を把握 | Catalog + Compiler + Profile合成 + 静的解析 |
| **Decision Trace Inspector** | 実際のTickで候補・拒否・採用・結果がなぜ生じたかを辿る | 認可済みEnbu RestrictedDiagnostics |

Jinrei SourceとNo-codeは**同一の戦術の2表現**であり、暗黙の別バージョンや偽のコンパイル成功を持たない。編集中のドラフト・コンパイル済みIR・試合に使用された提出Snapshot・現在の編集値は必ず区別する。

## 3. Editorに必要なDomain Catalogの機能

- **型付き補完**：定数、現在の対象スコープで合法な変数、集合、Field、Capability、Enum、Profile presetの候補を提供する。
- **定義の詳細**：型・単位・対象Army/Squad/Hero/Lane Minion・Known/Unknown条件・権限・適用範囲・CU・引数・前提・拒否理由・説明を表示する。
- **検証の即時性**：構文、型、有限集合、未定義シンボル、引数、観測権限、同点全順序、Capabilityスコープ、戦術予算をCompilerと同じ契約で検証する。
- **現在値の出所**：実行時の値は同じRulePackageの、**自陣に認可されたEnbu Observation[t]**だけから表示する。Catalogに値が定義されていることと、現在Knownであることを分ける。
- **Unknownの3区別**：(a) そのTickで観測不能（Unknown）、(b) スキーマ上参照不可（Type/Permission error）、(c) 実戦サンプルが未提供（NOT_CHECKED）。ゼロ・false・空集合へ勝手に変換しない。
- **バージョン整合**：RulePackage・Catalog・World Logic・Jinrei CompilerのID/版/digestを表示／検証し、変更時は補完・カバレッジ・診断のキャッシュを無効化する。

変数候補一覧をEditor専用の手作業リストとして管理しない。Capabilityの構文やScopeをEditorが推測して非公開機能を有効化しない。

## 4. Coverage Explorerの情報モデル

**Heroごとを第一の閲覧単位**とし、所属SquadとArmyがそのHeroの動作に与える影響を並べて確認する。MinionはArmy/Laneの限定制御範囲を別表示し、個別Heroと同じ自由度を示さない。

最低限の列：**対象／行動判断の状態群／有効な候補／実効アクション／適用元／理由／制約・不確実性**。

| Status | 意味 | 表示・受入 |
| --- | --- | --- |
| **Explicit** | Jinreiが対象を指定した合法Intentが実効判断を決める | 発火したstate/action、上書きフィールド、対象 |
| **Inherited** | Army/Squad/共通Profileから有効選好を継承 | 継承元とHeroの固有差分 |
| **Default** | 明示指定がなくHero/Senritsu既定行動を選ぶ | 「未設定＝何が実行されるか」を具体表示 |
| **Blocked/Wait** | 合法な攻撃・移動がなくHOLD/WAIT等を選ぶ | 封鎖・射程・Cooldownなどの理由。単純に異常とはしない |
| **Ambiguous/Error** | 必須の同順位優先度や競合の規範が欠落 | 静的／RulePlan検証エラー。勝手にデフォルトで黙殺しない |
| **Unknown/Not Proven** | 非公開・解析対象外・未実行等で判断を証明できない | 100%表示を拒否し、確認できていない範囲を説明 |

**「カバレッジが100%」の意味を限定する。**

- すべてのHP値、敵位置、Tick、Squad編成、観測、Skill効果の直積を網羅したと**主張しない**。
- 有限な意思決定領域を、状態条件・値域・Known/Unknown・到達可能性によって**同値クラス**に分割する（例：HP閾値内外 × Enemy Known/Unknown × Attack Legal/Illegal × Track/Bridge状態）。
- 完全に証明可能なクラスについて、**少なくとも一つの合法な実効行動（無動作HOLD/WAITを含む）**とその合成・全順序を説明できるなら、その**解析範囲**に限ってカバレッジ成立。
- Unknownや未到達クラス、静的に導出不能な動的Skill条件、未検証の可能経路は「未証明」と明記し、分母から黙って除外して100%としない。
- アクション数が多いだけでは網羅にならない。特定条件が有効になったときDefaultへ落ちるのか、拒否されるのか、意図的にHOLDするのかを区別する。
- **「actionが一行もない」場合にもデフォルト動作を可視化**する。Jinreiソース中の全stateに明示actionがないことだけをエラーとしない。

## 5. Coverageの3つの比較面

| 表示 | 内容 | どう比較するか |
| --- | --- | --- |
| **Default** | Hero Catalog＋Squad/Army継承の既定Behavior | Jinreiを一切追加しない場合の行動 |
| **Effective** | 編集中のJinreiを同一条件へ適用した意思決定 | どのstate/actionが発火し、どのフィールドが変化したか |
| **Observed** | 実際のEnbu戦闘の採用Intentと結果 | 採否・ブロック・Cooldown・待機・移動・攻撃・Skillの理由 |

- Default対Effectiveでは**変更された判断クラスとHero/Squadだけを差分ハイライト**し、未変更の継承フィールドを明示する。
- Effectiveは「その条件ならこう評価される」という**静的または選択Snapshot上の推論**。実行していない場合にObservedと表示しない。
- Observedは試合ID、RulePackage/Jinrei digest、Tick、Actor ID、RestrictedDiagnosticsへの認可を確認した**実測のみ**。デバッグ用の架空の結果を実測のように提示しない。
- 可能なら該当Tick・EntityとReplay画面を同期させる。ただし公開Replayには相手の内部Decision Traceを埋め込まない。

## 6. Decision Traceの探索UI

閲覧単位は `Army → Squad → Hero → Tick`。元となるトレースは[BEHAVIOR.md](BEHAVIOR.md)に従う。

ひとつの判断で示すべき経路：

~~~text
RulePackage / Catalog / Profile
  → 許された観測値（Known / Unknown）
  → 真になったstateとaction候補（同一Tick）
  → Defaultと条件付きoverrideの合成
  → Capability/占有/射程等の合法性
  → 採用 / 競合で棄却 / 拒否 / HOLD
  → Enbuの確定結果とイベント
~~~

- **編集時のテキスト**と、**実戦で評価したコード・行動根拠**を混同しない。ソース位置とIR上の安定action IDを関連付ける。
- 拒否・上書き・Unknown・CU不足を、UIの成功通知へ変換しない。どこで不採用となったかを表示する。
- 対戦相手の非公開戦術・条件評価・内部位置・診断を、敵方のクライアントや公開Replayで閲覧できるようにしない。
- 診断収集が未有効・期限切れ・アクセス拒否なら、その理由を表示し、架空のTraceを補完しない。

## 7. Desktop / Mobileの体験

**Desktop**

- 中央のJinrei Source/No-codeを主領域とし、左にDomain Catalog（検索・型絞り）、右に選択中Hero/SquadのCoverage、下部または別タブにコンパイル診断／Decision Traceを配置する。必要なときは各面を独立拡大可能。
- Heroの切替、Army→Squad→Heroの階層、Profileとソース、Default/Effective/Observedの切替が一貫している。
- コンパイル／RulePackage変更／現在Tickの切替で、スクロール・カーソル・未保存ドラフトを無意味に失わない。

**Mobile**

- Desktop三面をそのまま縮小しない。`Editor`、`Catalog`、`Coverage`、`Trace`の**独立した画面／シート**を使い、選択Heroとドラフトを共有する。
- 補完候補はソフトウェアキーボードと共存し、長い日本語識別子・IME・戻る・Safe Area・タッチ操作に対応する。Coverageでは横長マトリクスを狭い端末に無理に押し込まない。
- 実行エラー・ロード中・未コンパイル・Catalog不一致・権限拒否・非対応GPU等を正しく表示し、復帰先を明示する。

## 8. UI受入条件と検証

1. **同一Catalog**からCompilerの型とEditorの補完候補が得られ、未知シンボル・Scope/Permission不一致を正しく拒否できる。
2. Jinreiを空にしたHeroでも既定動作・継承元・HOLD条件を表示できる。
3. HeroとSquadの選好が競合した場合、適用されたフィールド、棄却された候補、決定理由を確認できる。
4. Known/Unknown、未定義フィールド、未観測相手、未実行の同値クラスをそれぞれ区別する。カバレッジ100%の誤表示がない。
5. Default/Effective/Observedの差分と関連Tickが整合し、Traceは実際の認可済みEnbu入力からのみ取得する。
6. RulePackage更新・戦術変更・Squad合流／分離で各種表示を失効・再計算し、古い診断を現在のものとして表示しない。
7. Desktop 1440×900 / 1920×1080、Mobile 390×844 / 430×932 / 320pxで、編集・補完・Hero切替・Coverage絞込・Trace遷移・戻る・エラー復帰を実操作する。
8. **ビルド成功・静的UI画像だけで完成としない**。機能、権限・契約、実操作、視覚・アクセシビリティを別々に検証し、実機未検証はNOT_CHECKED。

## 9. 実装と仕様の境界

本書は今後も維持する**製品契約**。特定のReactコンポーネント名、Editorライブラリ、CSS構成、Trace保存方式を先に固定しない。新しいJinrei文法、敵の非公開状態への権限拡張、Minionの全面自由指揮をこのUIのために追加しない。

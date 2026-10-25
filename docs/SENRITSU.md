# Senritsu（戦律）— ルールセット契約

## 1. 役割（確定）

Senritsuは**ゲーム世界に何が存在し、何ができ、どんな規則で状態が変わり、何を達成すれば勝ちか**を記述する、独立したルールセット。最初のSenritsuはSenkeiの三レーン戦を定義するが、EnbuやJinreiを三レーン戦専用に固定しない。

Senritsuは言語ではなく**型付き・検証済みのルールパッケージ**であり、プレイヤーが書くJinreiとは別。Jinreiは戦律の範囲で判断と命令を作るだけで、ルールを書き換えない。

## 2. パッケージが定義する意味領域（設計方針）

| 領域 | Senritsuが提供するもの |
| --- | --- |
| World / topology | World DefinitionによるTopology・Metric・Terrain semantics、接続グラフ、時間・終局上限。描画用Presentationを独立管理 |
| Entity | 自軍・敵軍・中立を含むオブジェクトの分類・タグ・同一性 |
| Component schema | HP、位置、速度、装備、状態効果などの型・有効範囲 |
| Capability | 移動、攻撃、出撃、生産、指揮など、対象に許可される行動 |
| Behavior Profile | 共通／Hero／Squad／Armyの型付き既定選好、集約、Jinreiの条件付き上書き・競合契約 |
| Resource | 戦力予算、資源、クールダウン、所持数、戦術CUの利用規則 |
| Observation | 陣営別の観測可能な値・集合・イベント・マスク |
| Intent schema | Jinreiが発行できる命令候補、引数型、対象・範囲、前提条件 |
| Transition rules | Enbuの遷移プリミティブと組み合わせる移動・交戦・生産・効果適用 |
| Arbitration | 同時命令、競合、失敗、Tie-break等の順序 |
| Victory / termination | 本拠地破壊、時間切れ、引き分け・同時終局の裁定 |
| Presentation visibility | 公開可能な戦場状態・イベントの分類、非公開情報の境界 |
| CU schedule | 観測・演算・状態・命令の論理費用テーブルと版 |
| Public Domain Catalog | Editor/Compilerに共通の定数、観測変数、集合、Capability、Profile、Known/Unknown、CUメタデータ |

この分類は設計モデルであり、実装に特定のECSライブラリを要求しない。EntityとComponentは型付き・有限・バージョン付きのデータスキーマとして扱う。

## 3. 初期Senritsuの具体性

初期ルールはTOP/MID/BOTの3レーン、各種の兵科・部隊・施設・本拠地、配分可能な兵数、進軍と交戦、塔の破壊、拠点の終局判定、戦術CU予算を扱う。

- **確定した体験**: プレイヤーは兵科・数・配置・戦略を自由に設計し、自動戦闘させる。戦闘ロジックに乱数を導入しない。
- **未決定の具体仕様**: 兵科の正式リスト、数値、領域モデル、詳細な移動／交戦、施設の種類、出撃タイミング、CU上限と料金、Tick長、勝敗の裁定。
- 三レーンという数は初期Senritsuのデータであり、Jinreiのコア型`Lane`の列挙値へ焼き込まない。コンパイル時にSenritsuから許されるLane識別子を解決する。

新メカニクスの追加時には、「データの追加か、遷移意味論の追加か」を分類し、後者をルールファイルだけで無理に表現しない。

## 4. ルールパッケージの構築・検証

1. データ構造と版、必須Capabilityと前提エンジン機能の宣言を読み込む。
2. 型、参照、範囲、上限、イベント公開条件、費用表の完全性を検査する。
3. 遷移プリミティブの組み合わせを検証し、不正な依存循環や未定義の優先順位を拒否する。
4. Canonical serializationを作り、内容ダイジェストを算定する。
5. Enbuへ**不変の検証済みRulePlan**を渡し、Jinreiのコンパイラへ**公開された型付きDomain Schema / Capability Catalog**を渡す。
6. 導入済み版の戦闘は、そのRulePlanと費用表を固定して再現する。

SenritsuはコンテンツとしてOSSで配布可能。初期実装ではサンドボックス外でユーザーが提供する任意のネイティブコードやWASMプラグインをルールとしてロードしない。後日、ルール作成用DSLを導入する場合も、その言語はJinreiと責務を分け、停止性・決定論・権限・コストを独立して審査する。

## 5. Jinreiへの公開境界

戦律から言語へ出すものは、観測できる状態の型、参照の権限、自軍に発行できる命令型、有限の値域、CU料金、互換性メタデータ。

**出してはならないもの**は、敵の非公開戦術IR、内部トレース、未観測の戦場値、ゲームを直接更新する可変ポインタ、ホスト関数ハンドル。

例えば「敵の兵数」は、戦律が完全観測か偵察制かを決め、観測スキーマは `Known / Unknown` 等の区別を型として示す。Jinreiの条件式はこの区別を無視できない。

## 6. Enbuが担うこと／担わないこと

- EnbuはRulePlanに指定されたプリミティブの順序とルールに従い遷移を適用する。
- Senritsuは遷移の内容と許可された命令を定義するが、実行スケジューラやプロセス管理は持たない。
- **決定論のための処理フェーズ・安定ソート・データ表現に関する基礎ルール**はEnbuの契約。ゲーム固有の同値優先順位・コスト・勝敗規則はSenritsuの契約。
- 公開観測やイベントの候補はSenritsuに定義しても、最終的な公開出力への射影と権限境界はエンジン／サービスで検証する。

## 7. 互換性・テスト（実装時）

- 同じSenritsu ID・版・ダイジェストなら同じRulePlanと型・CU定義が得られる。
- 異なる規則へ古いJinrei戦術を暗黙に移植・実行しない。再型検査・再コンパイルが必要。
- 不明なCapabilityや不足する遷移プリミティブは明示的に非互換エラー。
- データだけで追加できる新兵科のケースと、エンジン拡張が必要な新物理規則のケースを区別する。
- 観測制限・命令合法性・CU・勝敗・公開イベントを組み合わせたコンフォーマンスケースを持つ。

## 8. 次期Senritsuゲームデザインの正本

`senkei.initial` は3レーン・歩兵／射手／騎兵／衛生兵等を含む**従来の小規模なローカルPvE用ルールパッケージ**である。別系列の `senkei.next` はHero、Squad、Minion、ジャングル等を実装しており、さらにBattlefield v2を統合する作業は個別の実装・検証状態で管理する。本節に記す**新しい宣言的World Compiler・Behavior Profile・自己記述Domain Catalogは設計契約であり、既に実装された機能とみなさない**。

次期ゲームルール設計の分担：
- [WORLD.md](WORLD.md)：地形、対角拠点と三レーン、Minion視界、ジャングル、施設。
- [WORLD-DEFINITION.md](WORLD-DEFINITION.md)：宣言的World Definition／Compiler、LogicとPresentationの分離、識別子・Digest。
- [BATTLEFIELD.md](BATTLEFIELD.md)：初期トポロジー、仮距離、河川・橋、トラック、射程とノード退出の規範。
- [UNITS.md](UNITS.md)：Hero Catalogと属性、5Hero/Squad、合流・分離、死亡・復活。
- [COMBAT.md](COMBAT.md)：通常攻撃、追撃／撤退、XP、レベル、Skill Tree、Tick解決。
- [BEHAVIOR.md](BEHAVIOR.md)：Hero既定選好、Army/Squad/Hero/限定Minionの作用範囲、上書き、Decision Trace。
- [DOMAIN-CATALOG.md](DOMAIN-CATALOG.md)：自己記述的Senritsu Domain CatalogとCompiler/Editorの型一致。
- [BALANCE.md](BALANCE.md)：確定した初期係数、残る未決定数値、バランス検証。

これらはSenritsuのドメインデータと規則を具体化する文書であり、Jinreiの文法とEnbuの汎用遷移エンジンを暗黙に変更するものではない。次期実装では独立したRuleset ID／版／内容digest、Domain Schema／Capability Catalog／検証済みRulePlan、コンフォーマンステストを必要とする。ゲーム特有の効果を初期SenritsuのHardcodeとして言語コアへ持ち込まない。

## 9. World CompilerとBehavior Catalog（追加確定契約）

- Worldは**宣言的Definition → Validator/Compiler → Canonical Simulation World＋Canonical Presentation World**で生成する。Topology、Metric、Terrain semanticsはシミュレーション側、描画座標・形状はPresentation側で保持し、別々のDigestを与える。入力のYAML/JSON等の表層ファイル形式は未固定。 [WORLD-DEFINITION.md](WORLD-DEFINITION.md) が正本。
- HeroごとのDefault Behavior、Squadでの有効Profile集約、Armyからの上位選好、限定的なMinion制御を**型付きのSenritsuルールデータ**として定義する。Jinreiは既存文法のCapabilityで条件付き上書きを発行する。[BEHAVIOR.md](BEHAVIOR.md)が正本。
- RulePackageは **Domain Catalogを自己記述的な公開インターフェースとして同梱**する。CompilerとJinrei Editorが同じ定数・観測変数・集合・Capability・Profile・型・権限・CU・版を利用する。Enbuは同じRulePlanで現在の認可済みObservationを提供する。[DOMAIN-CATALOG.md](DOMAIN-CATALOG.md)が正本。
- 新しいProfile/World/Editor契約によって、Jinreiのv0.1構文、CUの評価規範、同時評価・Unknownの意味、Enbuの権威的な更新責務を変更しない。
- 本項は追加ルールの**実装完了の宣言ではない**。既存senkei.nextのバージョン／RulePlanと混同せず、新しい互換性・Schema・コンフォーマンスとして実装する。

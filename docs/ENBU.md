# Enbu（演武）— 決定論的シミュレーションエンジン

## 1. 目的（確定）

Enbuは**二つの戦型と検証済みの戦律を入力し、外部プレイヤーの介入なしで戦闘結果と描画イベントを返す**決定論的計算エンジン。名前の「演武」は戦型が実行される行為を表すもので、戦争ルール自体を所有しない。

概念API（API名・フィールド名は実装時に確定）：

```text
simulate(
  attacker: ValidatedSenkeiSnapshot,
  defender: ValidatedSenkeiSnapshot,
  rule_plan: VerifiedSenritsu,
  context: ImmutableExecutionContext
) -> SimulationArtifact
```

`context`には互換性あるEnbu/Jinrei/ルール/CUのバージョンと、RulePlanが参照する完全なWorld identityを含む。非公開プログラム実体は公式戦の信頼境界内に置く。ID/digestと成果物の変換契約は [RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md) が正本。

## 2. 所有する状態と処理

- 一試合分の可変なワールド状態、Tick、ゲームイベント、トレースバッファを保持する。
- 戦律から導かれた初期状態、観測権限、フェーズ、遷移プリミティブ、終局規則を適用する。
- 両者が同じ確定済み状態を観測できるようにスナップショットを作る。
- Jinreiの**TacticalExecutionPort**に「自陣営の許された観測 + 戦術メモリ + 予算」を渡し、命令候補とメモリ変更候補・論理CUを受け取る。
- 命令の合法性・実行資源・競合・失敗・効果の適用を、戦律のRulePlanに従って決定論的に解決する。
- 勝敗・統計・CU・イベントを確定し、試合終了後に状態を破棄する。

EnbuはJinreiテキストの字句解析・パーサやノーコード編集面を持たない。Jinrei VMはプログラムを実行するが、戦闘世界の遷移はEnbuだけが確定する。

## 3. Tickの契約（詳細フェーズは戦律で定義）

```text
  World[t] ──snapshot──► Observations for both sides
                              │
                        Jinrei VM calls
                              │
                         Intent batches
                              │
                  Ruleset validation / arbitration
                              │
                       Transition effects
                              │
             World[t+1] + events + CU + termination
```

- 状態を観測する時点を双方で揃え、攻撃側を先に進めて観測差が生じないようにする。
- 同時命令・同時攻撃の優先度と安定ソート、数値の丸め・オーバーフローは仕様化する。
- 次期Battlefield固有のノード退出・占有・橋状態・通常攻撃と移動の排他、およびTickフェーズの初期案は [BATTLEFIELD.md](BATTLEFIELD.md) を参照する。これは既存の実装で当該機能が動作するという宣言ではない。
- 非合法な命令は定義済みの拒否理由を出し、秘密の内部状態は返さない。
- 戦術メモリ更新の原子性・命令受理イベントとの関係・CU不足のフォールバックは戦律と言語の規範的契約に従う。現時点で実装詳細は未決定。
- 兵士のHPや塔の耐久力などをJinreiから直接書き換えさせない。

## 4. 出力の分離（確定）

`SimulationArtifact`は概念的に次を含む。

| 出力 | 内容 | 信頼境界 |
| --- | --- | --- |
| `MatchResult` | 勝敗・終局・確定統計・ゲームCU | 公開可のフィールドを選択 |
| `PresentationReplay` | 戦場で観測を許す位置・行動・状態差分等 | クライアント向け |
| `RestrictedDiagnostics` | 戦術の条件評価・内部状態・命令・詳細CU・全トレース | 所有者・運営者の認可が必要 |
| `ReproductionContext` | 再現に必要な両戦型、完全なRulePackage/RulePlan、World logic artifactとpresentation参照、Behavior/Catalog extension、各プログラムの実体、入力・出力identity、全解釈バージョン | サーバー・権威実行系のみ |

公開用出力は公開許可されたイベントだけから生成し、デバッグ用トレースを丸ごと渡してクライアントで削る構成にしない。PresentationReplayは結果と厳密なRulePackage/World identityを参照し、Sceneが必要ならWorldの両digestを保持する。表示イベントとRendererとの契約は [REPLAY.md](REPLAY.md) に分離する。戦律が宣言する公開可能性をEnbuが強制し、オンラインサービスは要求principal/purposeに応じてRestrictedDiagnosticsの公開範囲を認可・限定する。identityと権限の横断規範は [RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md)。

レンダラーは結果を変更できず、受信した確定イベントを補間して描画するのみ。公式戦でリプレイするために敵の非公開Jinreiプログラムを配布しない。

## 5. 実行環境と性能

同じRust製コアをWASMブラウザ版／ネイティブ検証版として構築する。戦術VMのWASM化と、戦術コードを直接WASMへコンパイルすることは別。初期の実装ではJinrei専用バイトコードをVMが解釈する。

1試合は状態を持つが、**サービスとしての試合セッションは不要**。入力が確定すれば独立ジョブとして最後まで計算できる。将来の公開戦はネイティブ常駐ワーカープールを第一候補とし、WASMインスタンスやCloudflare Workersでの公式計算は測定して判断する。

レンダリングはエンジンの責務ではない。Web Workerで実行し、レンダラーはCanvas等の独立した実装を使える。

## 6. セキュリティ・決定論

- 外部時刻、OS乱数、ネットワーク、ストレージ、非決定論的順序に依存しない。
- 整数または定義済み固定小数点、安定したID・並び順、同時イベントの規範的解決を用いる。
- 限定された戦術VMポートだけを外へ公開し、プログラムが任意のホスト機能を呼べない。
- プレイヤーの論理CUとホスト保護のメモリ・CPU時間・入力サイズ・最大Tick等を別管理する。
- 物理最適化で意味論と論理CUを変えない。
- 公式戦では入力検証、ルール版・パッケージdigest、World logic identity、Behavior/Catalog key、プログラムdigest、コンポーネント互換性の固定、戦闘結果のサーバー権威性を保証する。

## 7. 受入条件（実装時）

- Enbuが初期Senritsuで3レーン戦を実行できる。
- 規則・軍備・戦術・初期状態が同じなら結果・CU・論理イベントが一致する。
- 既存の遷移プリミティブで表現できるSenritsuの定数・兵科変更が、エンジンの言語構文修正を必要としない。
- 未対応Capability、規則や戦術のバージョン不一致を拒否する。
- 公開描画データに非公開コードや内部トレースが混入しない。
- ブラウザWASM版とRustネイティブ版でゴールデンケースが一致する。

## 8. Declarative World・Behavior・Decision Traceとの接続

EnbuのRuntimeは**検証済みのCanonical Simulation Worldと、その同一World logic identityに束縛されたRulePlan**を消費する。入力Worldは[WORLD-DEFINITION.md](WORLD-DEFINITION.md)のCompilerで定義・検証し、BattleMapへ変換する場合はID・crossing range・edge/tower/route semanticsを失う変換を拒否する。地形MeshやEditorから直接経路・戦闘ルールを補完しない。

行動調停では[BEHAVIOR.md](BEHAVIOR.md)のHero Default、Army/Squad有効選好、Jinrei条件付きOverride、合法なIntentを同じTickの陣営別観測Snapshotから解決する。**Army/Squad/Hero/Minionの作用主体を明示**し、一主体の移動と通常攻撃を同時に成立させない。既存の同時評価、規範Tie-break、固定小数点、CUの独立性は維持する。

**Decision TraceはRestrictedDiagnostics**：各Tick／作用主体について、RulePackage/World/Program/Catalog/Behavior identity、適用Profile、発火候補、採用・拒否・ブロック理由、最終行動、確定結果への参照を権威的に記録する。診断の上限・principal/purpose認可・Lifetimeを定義し、公開PresentationReplayへ内部トレースを丸ごと書き出さない。TraceはJinrei側が当該時点で知らなかったWorld factを説明理由にしない。Editorへの現在値は[DOMAIN-CATALOG.md](DOMAIN-CATALOG.md)と一致する認可済みObservationから投影する。

本項は将来実装の契約であり、現在のEnbuの全分岐にDecision Traceが実装済みだと主張しない。

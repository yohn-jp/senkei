# DOMAIN-CATALOG — Senritsuの自己記述的な公開ドメイン契約

## 1. 目的

本書は、**Jinrei Compiler・Editor・Enbuが、同一のSenritsu RulePackageから取得する型付きDomain Catalog**の正本。変数一覧をEnbuの内部構造やEditor専用定数へハードコードしない。

- **Senritsu**が宣言する：使用可能な定数、観測変数・集合、Entity型、Capability、Behavior Profile／Preset、CU・互換性メタデータ。
- **Enbu**が提供する：一致するRulePlanと陣営別Observationから得た、**そのTickに観測を許された現在値**と、認可されたRestrictedDiagnostics。
- **Jinrei Compiler**が検証する：v0.1文法、型、シンボル、作用対象、有限集合、Known/Unknown、競合、CU、Capability署名。
- **Editor**が表現する：Catalogから生成した補完・候補・説明・診断。実測値を推測せず、観測不可の値はUnknownまたは参照不可とする。

[COMPONENTS.md](COMPONENTS.md)、[SENRITSU.md](SENRITSU.md)、[JINREI-GRAMMAR.md](JINREI-GRAMMAR.md)、[BEHAVIOR.md](BEHAVIOR.md)、[JINREI-EDITOR.md](JINREI-EDITOR.md) と合わせて適用する。成果物間のidentity・digest・互換性は [RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md) が横断正本。Jinreiの表層文法は変更しない。

## 2. 自己記述RulePackageの内容

CatalogはRulePackageの版付き・検証済みの**公開インターフェース**。単なる文字列配列でなく、有限な型／可視性／利用条件を含む。

| Catalog分野 | 必須情報 | 例示的用途 |
| --- | --- | --- |
| Symbol / Constant | 安定ID、表記名、型、値域、所属namespace、説明 | TOP、MID、BOT、Terrain、BridgeState |
| Observation field | Entity型、scope、型、Known/Unknown条件、許可される演算、単位 | 自軍HP、敵の可視HP、橋状態 |
| Collection | 要素型、所有者・可視性、有限上限、フィルタ／集約可否 | own_heroes、enemies_visible、own_squads |
| Behavior Profile | 対象scope、フィールド、継承規則、Preset、デフォルト、条件付きoverride | fastest、survival、engagement |
| Capability | stableId、作用主体、引数名と型、対象・前提、効果種別、期間、拒否理由 | move、retreat、bridge_work、Profile override |
| Cost / ordering | CU課金定義の識別子、論理評価単位、必要な同点全順序 | action競合、argminの一意キー |
| Compatibility / documentation | schemaVersion、RulePackage ID/版/digest、対応Jinrei/Enbu、説明・利用例 | 正しい候補表示と診断 |

例示した名前は説明用であり、現在のPackageに存在するという意味ではない。新しいJinrei文法や予約語を増やさず、SenritsuのDomain Schema / Capability Catalogとして登録する。

## 3. 静的Schemaと動的観測の分離

- Catalogは「そのルールで参照**可能な概念と型**」を宣言する。現在の敵のHPや隠れた目標座標など**実データは格納しない**。
- あるFieldがSchemaに存在しても、そのTickに値が見えるとは限らない。値は `Observed<T> = Known(T) | Unknown` に従い、参照権限そのものがない場合は**型／権限エラー**として区別する。
- 観測可能なEntity集合と現在見えている集合を同一視しない。未観測の敵を「現在いない」「HP=0」「false」としない。
- 各変数・Capabilityについて **Army／Squad／Hero／Lane-limited Minion** の適用スコープをSchemaで明示する。未許可のMinion単体命令は型検査／Capability検証で拒否する。
- Last Known履歴を扱うなら現在Knownへの自動昇格は禁止。前Tickの既知位置を現在位置とみなさず、MIDの**移動方向**は十分な許可済み観測がある場合だけ公開する。
- 「十分な許可済み観測」の標本数・時間関係・方向の粒度・失効条件はまだ決まっていない (`DEC-MID-DIRECTION-001`)。Compiler/Catalogは未確定の派生式を前提にdirection fieldを有効扱いせず、採択前は証明できない値をUnknownとして扱う。
- Hoverやコード補完の説明はCatalogの情報から生成し、表示側が別の独自の変数表を所有しない。

## 4. SymbolとCapabilityの型（概念Schema）

~~~text
DomainCatalog
  identity: RulePackage ID + SemVer + Digest + Catalog Schema + execution/compiler compatibility versions
  compatibilityKey: identity + catalogDigest + optional metadataExtensionDigest
  symbols:     Finite<DomainSymbol>
  collections: Finite<CollectionDefinition>
  capabilities: Finite<CapabilityDefinition>
  behaviors:   BehaviorProfileSchema + NamedPresets
  cuSchedule:   Costed Logical IR reference
  ordering:     Tie-break / conflict-resolution reference
~~~

各 `DomainSymbol` に必要な情報：

~~~text
id; displayName; namespace; category; valueType;
scope; entityType; knownness; readPermission;
allowedOperators; unit?; finiteDomain?;
description; examples?; since?; deprecated?
~~~

各 `CapabilityDefinition` に必要な情報：

~~~text
id; actorScope; argumentTypes; targetTypes; domainPreconditions;
effectKind; lifetime?; rejectionCodes;
logicalCostReference; tieBreakContract; version
~~~

特定のTypeScript/Rustのインターフェース名やファイル形式は未確定。**必須なのは意味と静的検証可能性**であり、Catalogに実行系の可変ポインタ、任意スクリプト、ホスト関数を含めない。

### ProfileをCatalogで公開する

- 共通のSenritsu Default、Hero Catalog固有Profile、Army/Squad/Heroの適用可能なフィールド、集約規則、合法なプリセットをCatalogから得られること。
- **Default Profileと明示的Jinrei上書きとの差分**は、同じ項目ID／型で追跡できること。
- `fastest`、`safest`、`avoid_combat` 等の可視プリセットと、内部の版付き重み評価を対応付ける。実際の値域・Tie-breakはSenritsu固有のCatalogが宣言する。
- Conditional overrideのTick単位の有効性と、明示的な永続変更Capabilityを区別する。何も指定していないフィールドに勝手な初期値を挿入しない。

## 5. Compiler / Editor / Runtimeで同じ契約を使う

~~~text
Validated Senritsu RulePackage
  ├─ Public Domain Catalog ──→ Jinrei Compiler / Typechecker
  │                         └─→ Editor completion / Hover / validation / Coverage
  └─ Verified RulePlan ──────→ Enbu Observation / Intent legality / arbitration

Enbu authorized Observation[t] ──────→ Editorの現在値・Unknownプレビュー
Enbu RestrictedDiagnostics[t] ──────→ 所有者向けDecision Trace
~~~

- Editorが選択したRulePackage（ID・版・digest）とCompiler/Enbuが使用するRulePackageの**完全一致**を前提にする。Catalog互換性キーはRulePackage identityにCatalog schema／catalog digest／optional metadata-extension digest、minimum engine/model/primitive-set、Jinrei language/AST/IR/bytecode versionを合わせる。互換性範囲の比較と、artifact identityの完全一致を混同しない。
- Rulesetの変更でCatalogが変われば、補完・型検査・Behavior Coverageを失効させ、必要に応じて再コンパイル・差分表示を行う。古い値のまま成功と表示しない。
- CatalogのDigestもRulePackageの識別範囲で再現可能とする。Canonical Serialization、安定ソート、有限な集合・型域を使う。任意の別metadata extensionは、どのRulePackage ID／version／digestに属するかを検証し、拡張digestをCatalogのcompatibility keyに含める。Behavior profile/default/aggregationがmatch結果に影響するなら、そのextension digestはProgram、submitted snapshot、Enbu validation、trace、reproduction identityまで連続して束縛する。保管場所の選択は `DEC-BEHAVIOR-BINDING-001` を参照。
- 実行時の新しいObservationや未公開フィールドをEditorの特権で勝手に「可視化」しない。現在値は陣営別の認可スナップショットの公開範囲内だけ。
- 既存のJinrei `state/action/when/do`、三値、同時評価、CU／競合の正本と照合し、Editorが別のルールを持たない。Army/Squad/Hero/Minionの作用範囲・Defaults・cross-capability total orderは [BEHAVIOR.md](BEHAVIOR.md)、identity全体は [RUNTIME-INTEGRATION-CONTRACTS.md](RUNTIME-INTEGRATION-CONTRACTS.md) に従う。

## 6. 独立させるべき4つの検証

1. **Catalog Validity**：全ID・型・スコープ・Enum・Capability・Profile参照・CU・順序が完全で、循環／権限漏れ／未定義値が拒否される。
2. **Editor/Compiler一致**：同じRulePackageで、補完可能な合法式はCompilerも受理し、存在しないシンボル・スコープ・引数をEditorも警告できる。
3. **Observationの秘匿**：Known／Unknown、permission denied、owner/public、MIDの方向観測、敵Jinrei診断の不開示を実Enbuスナップショットで検証する。
4. **Compatibility**：Catalog/RulePackageの版変更で必要な型検査が再実行され、古いEditorキャッシュが有効のふりをしない。

**現在の実装済み状態の主張ではない。** 本書は今後のSenritsu RulePackage・Compiler・Editorの共有契約である。

## 本番Behaviorの評価境界

Navigation / Engagement / Targeting / Pursuit / Survival / ObjectiveはSenritsu所有の有限・型付きProfileとする。合法な観測・対象・候補、宣言的な有限値の式・重み、安定したTie-breakを版付き定義で検証する。最終WAITの適用条件も検証済みRulePlanに固定する。未定義のフィールド値、重み、閾値、Capability対応を推測して実行しない。複数fieldへ作用するIntentは行動単位で原子的に確定する。

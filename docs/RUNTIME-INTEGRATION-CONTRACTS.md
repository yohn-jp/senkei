# RUNTIME-INTEGRATION-CONTRACTS — World・RulePackage・Behavior・Editor・Replay接続

## 1. 位置づけと正本

本書は、宣言World、Senritsu、Jinrei、Enbu、Editor／Worker／WASM、Replay間の**identity・互換性・情報受け渡し**を定める横断契約である。ここに書く要件は今後の規範であり、各境界がすでに実装済みだとは主張しない。

| 責務 | 意味の正本 |
| --- | --- |
| World authoring、simulation／presentation投影、World identity | [WORLD-DEFINITION.md](WORLD-DEFINITION.md) |
| 初期Battlefield topology、合法移動、track、bridge、空間的な戦闘制約 | [BATTLEFIELD.md](BATTLEFIELD.md) |
| 初期地形、視界、中立領域、ゲームデザイン | [WORLD.md](WORLD.md) |
| RulePackage、RulePlan、Capability、Observation、競合宣言 | [SENRITSU.md](SENRITSU.md)、[DOMAIN-CATALOG.md](DOMAIN-CATALOG.md) |
| Jinrei文法、同時評価、三値論理、論理CU | [JINREI-GRAMMAR.md](JINREI-GRAMMAR.md) |
| 作用主体、Profile継承、Preference、Default | [BEHAVIOR.md](BEHAVIOR.md) |
| 戦闘遷移、攻撃準備・impact・recovery | [COMBAT.md](COMBAT.md) |
| 権威ある試合遷移と出力分離 | [ENBU.md](ENBU.md) |
| Editorの閲覧面、Coverageの主張、Trace表示 | [JINREI-EDITOR.md](JINREI-EDITOR.md) |
| 公開Replay投影とRendererの入力 | [REPLAY.md](REPLAY.md) |

同じ規則が要約として複数文書に載る場合、表中の責務所有者が規範的である。本書は各責務を結ぶidentityと互換性を所有するが、ゲーム規則や個別wire schemaを置き換えない。

## 2. Artifactの流れとidentity

~~~text
World Definition
  → World Compiler
  → Verified World { WorldIdentity, CanonicalSimulationWorld, CanonicalPresentationWorld }
        ├─ simulation投影 → WorldIdentityに結び付くSenritsu RulePackage → 検証済みRulePlan → Enbu
        └─ presentation投影 ──────────────────────────────────────┐
                                                                  ↓
Enbu MatchResult + 認可済みPresentationReplay → presentation adapter → Renderer
Enbu RestrictedDiagnostics ── 別個の認可済み経路 ──→ Editor Trace
~~~

流れの各境界は、異なる内容から生成されたArtifactを拒否できる版付きidentityを保持する。表示名、map ID、semverだけ、ファイル名、object addressはidentityの代わりにならない。

### 2.1 World identity

Compile済みWorldのpaired identityは、最低限次を含む。

- 安定した `world_id`、World schema version、compiler compatibility bounds、任意のvalidation-profile ID/version。
- 正規化されたTopology・Metric・Terrain semantics投影を表す `worldLogicDigest`。
- 正規化されたPresentation投影を表す `worldPresentationDigest`。

二つのdigestは正規化済み内容を別々のhash domainで識別する。Presentationだけの変更ではPresentation digestだけが変わり、simulation結果・CU・論理イベント・Logic digestは変わらない。Simulationに影響する変更ではLogic digestが変わる。digestはWorld IDやschema／compatibility情報を代用せず、参照先Artifactの実体が保存されていることも保証しない。

### 2.2 BattleMap、RulePackage、RulePlan

Worldから作る `BattleMap` その他のmap値は、Canonical Simulation Worldのprojectionである。その安定参照は元の `world_id`、World schema/profile compatibility、完全一致する `worldLogicDigest` と、独立した契約がある場合はprojection schema／semantics versionを識別する。同じBattleMapに異なるWorld世代のnode、distance、terrain、coordinateを黙って混在させない。Presentation coordinateとstyleは `worldPresentationDigest` を介して対にし、navigation・range・vision・damage・CUの入力へ使わない。

試合で使うRulePackage／検証済みRulePlanは、参照するnode、edge、metric、terrain semanticsと**同じWorld logic identity**に結び付く。RulePackage自身の `ruleset_id`、version、正規化されたcontent digestは、規則と試合に影響するpackage内容を識別する。RulePlanも検証済みRulePackage identityとWorld referenceを保ち、欠落・未知・不一致を検証時に拒否する。display nameやmajor versionだけでWorld互換性を主張しない。

Canonical Worldからruntime `BattleMap`へ変換するときは、source IDと必要なlogical factをすべて保つか、明示的なincompatibilityを返す。Topology、river-crossing subrange、bridge-site identity、lane-route list、tower placement、edge identityを黙って削除／改名しない。Renderer geometryから欠けたgameplay metadataを復元しない。追加のmapping／supplemental dataが必要なら、版付きで明示し、source World identityとtarget map schemaに束縛する。

基準branchの現行形状はlosslessに互換ではない。35 node／42 edgeのendpointとlengthは一致するが、edge IDは42本中0本が一致し、World／site IDも異なる。runtime mapのbridge／fordはedge全体のflagであり、World側のriver-crossing progress rangeを表さない。またWorld側にはruntimeのlane-route listと12個のtower placementがない。これらを互換と扱うには推測ではなく検証済みmappingが必要である。

**必須不変条件はidentityとdigestの束縛**である。RulePackageにCanonical World投影を埋め込むか、別途保存するcontent-addressed artifactを参照するかは **DECISION_REQUIRED** (`DEC-WORLD-BINDING-001`)。損失のないCanonical World → runtime BattleMap mappingと、追加のlane／tower意味をどう表すかは **DECISION_REQUIRED** (`DEC-WORLD-MAP-CONVERSION-001`)。どちらを選んでもsource IDを保ち、完全identityで照合し、非対応・lossy変換を拒否し、再現に必要なartifactを残す。

### 2.3 Match、Replay、互換性

権威あるmatch identityは、両Senkei snapshot（configuration、initial tactical memory）、各programのruleset referenceとbytecode／content digest、完全なRulePackage／RulePlan identity、World logic identity、使用したWorld Compiler実版とvalidation-profile version、interpretationまたは結果に影響するmodel・Enbu・primitive set・Jinrei language／AST／IR／bytecode・CU schedule・replay schemaの各versionを束縛する。Replay／表示の再構築では追加で `worldPresentationDigest` とpresentation adapterが受け入れるReplay schemaを束縛する。Match IDとresult digestは出力をmatchへつなぐが、入力identityの代わりにはならない。

`MatchResult`と公開`PresentationReplay`は、それぞれのpublic contractが認可するfieldだけを含む。Replayは解釈に必要な完全なRulePackage／World referenceを記録し、承認されたstatic sceneが必要ならWorldの両digestも保持する。Readerは非対応schemaとreference不一致を拒否し、互換mapを推測しない。Presentation-only変更で再描画が必要になっても、記録されたmatch resultは変えない。

参照だけ残して対応する不変RulePackage、World、program、snapshot実体を破棄した場合、deterministic reproductionはできない。信頼済みreproduction recordはcontent-addressed inputとcomponent versionを保持するか、同一の不変実体へ解決できる。これはpublic replayと別であり、相手のcode、private setup、hidden state、restricted traceを公開しない。

### 2.4 Invalidation規則

| 変更内容 | 無効化・再検証するもの | 不変であるもの |
| --- | --- | --- |
| World presentation投影だけ | Presentation digest、scene／Replay表示cache、visual acceptance | Logic digest、RulePackage互換性、simulation結果、論理CU／event |
| World topology／metric／terrain semantics | Logic digest、World検証、依存するRulePackage互換性とdigest、必要に応じCatalog／program互換性、match input | 旧Logic identityでの再利用なし |
| 試合に影響するRulePackage／Behavior内容 | Package digest、検証済みRulePlan、Catalog／extension key、Jinrei compile／submitted snapshot、match reproduction identity | 完全照合なしに旧program／matchを互換として表示しない |
| Catalogの説明文だけ | Catalog digestとそのCatalog利用者のcache | その変更が非意味的だと証明された場合に限りRulePackage identityとmatch結果 |
| 試合に影響するCatalog extension | Extension digest、それを使うcompile／runtime／reproduction reference | 同じpackage IDの別digest extensionへの置換なし |
| Replay schema／presentation adapter契約 | Reader／writer互換性、Replay表示cache | 記録済みの権威ある結果とCU |

試合に影響するBehavior内容は不変で版管理され、match reproduction identityに含まれる。RulePackage digestへ含めるか、別のpinned extension digestで束縛するかは **DECISION_REQUIRED** (`DEC-BEHAVIOR-BINDING-001`)。別digestを使う場合はcompile、match validation、execution、trace、reproductionの全境界で束縛し、UI-only metadataとして扱わない。

## 3. Behaviorの主体、Intent、Default、全順序

Behaviorの正本は [BEHAVIOR.md](BEHAVIOR.md)。Senritsuは型付きscope、Capability、profile field、package単位の競合解決を宣言する。次の区別はCompiler、Worker、WASM、Enbu全体で維持する。

| 主体 | 契約 |
| --- | --- |
| Army | 陣営共通のPreference／目的は適用対象とscopeを宣言する。すべてのHero／Squadへ個別commandとして暗黙複製しない。 |
| Squad | 宣言された場合、共有の移動目的、経路Preference、track／formation判断を一つ持つ。member Heroは暗黙に離れない。 |
| Hero | Squadの共有移動とSenritsu legalityに従い、宣言済みの個別戦闘、target、生存、skill fieldだけを選べる。Soloは1体のHeroからなるSquad。 |
| Minion | レーン進軍とCENTER補給のDefaultを維持する。Jinrei制御を許す場合は宣言されたArmy／Lane scopeに限り、Heroと同じ自由な個別制御を含意しない。 |

**Intent**は明示的な型付きJinrei candidate。**Preference**は宣言されたBehavior fieldだけを部分変更する型付き選好であり、Worldを書き換えたり同じactorへ重複commandを発行しない。**Default**は未指定fieldに対するSenritsu／Hero／Army／Squad Profileの解決結果。Senritsuが明示HOLD／WAITをIntentまたはPreferenceとして宣言した場合は、指定された通常の優先関係に参加する。別にRulePlanがHOLD／WAITを最終no-op fallbackとして宣言できるが、これは合法な状態変更actionが残らない場合にだけ適用し、暗黙のattack、retreat、movement orderにしない。falseまたはUnknownのconditionalはIntent／overrideを発火しない。Unknownはfalse、未設定、zero、推測されたillegal actionと同じではない。

Subject／fieldごとの優先関係は、Senritsuの強制legality／制約、合法な明示Jinrei Intent（明示HOLD／WAITを含む）、trueとなったTick内のconditional Preference、適用対象を宣言されたArmy／Squad Preference、Hero／Senritsu Defaultの順。解決の結果、合法な状態変更actionが残らない場合だけRulePlanのHOLD／WAIT fallbackを適用する。この関係はJinrei source行を逐次実行する意味ではなく、retreat／pursuit／fastest route等の普遍的なDefaultも追加しない。

RulePackageは共有Subject／fieldに影響する同一Tick競合について、同一Capability内だけでなく異なるCapabilityやcandidate source間も含む**完全で安定した全順序**を宣言する。subject／candidateの安定keyと同点解決も宣言する。競合解決の未宣言・矛盾時はSenritsu validationでpackageを拒否する。Enbu／Behavior resolverはcontainer列挙順、thread schedule、actor訪問順から優先度を作らない。競合は同じpre-transition snapshotからRulePlanで調停する。同一主体に、互換性のない自発的movementと通常attackを同Tickで成立させない。field aggregationの具体式はpackage dataとし、engine共通の選択式に固定しない。

## 4. Domain Catalog、Compiler、Editor、Worker、WASM、Enbu

Compiler、no-code Editor、Catalog explorer、Behavior resolver、Web Worker、WASM core、Enbuは同一の検証済みruleset契約を使う。consumerのcache／compile referenceは完全なpackage identityとCatalog compatibility keyを含む。keyにはCatalog schema version、catalog digest、optional extension digest、minimum engine／model／primitive-set version、Jinrei language／AST／IR／bytecode versionを含める。使用時はidentityを完全一致で比較し、互換性version rangeは別途宣言された契約で判定する。

Catalogは有限な静的schema／policy metadataであり、match Observationを含まない。実行時の値はそのTickのEnbu認可済みside-specific Observationから得る。Catalogにfieldがあっても現在のObservationで見えない値は `Unknown`。field未宣言または参照権限がなければtype／permission error。名前やUI表示だけから機能、可視性、effectを推測しない。

Editorが表示するのは選択された完全identityに一致するCompiler／Catalogの結果だけ。編集中draft、compiled program、submitted snapshot、現行editor内容を別versionとして扱う。package、World logic、Behavior extension、compatibilityの変更で依存するcompile／coverage結果を無効化し、再検証する。Worker protocolとWASM/API versionはwire互換性を確認するためのもので、RulePackage／World／Catalog identity確認の代わりにならない。Enbuがmatch state、legality、遷移結果、Replay、restricted diagnostic recordの権威者であり、Editorはactionをcommitせずhidden World factも導出しない。

各境界のrequest／responseはproducer identityを保つ。Catalog取得は完全なpackage identityとCatalog keyを示す。Compile結果はsource revisionと、型検査／CU算出に使ったpackage・Catalog・World logic identityを示す。Submitted Senkei snapshotは生成program digestと一致するruleset referenceを持つ。Workerはwire protocol非対応をWASMへ渡す前に拒否する。WASMはpackage／program／component versionを照合する。EnbuはsideとTickを持つObservationを出し、Result／Replayと任意のRestrictedDiagnosticsを分離した経路で返す。必須identityを確認できないconsumerはidentityの一部が欠けた成功応答を返さず、incompatibleとして失敗する。Browser／WASMの計算結果はdeterministicなlocal calculationであり、official match resultの権威にはならない。

## 5. Coverage、証明、Unknown、診断

Coverageは宣言された解析Domainに対する範囲限定の証明であり、全連続game stateを網羅した主張ではない。EditorはそのDomainを、判断に影響する有限値／数値区間、Known／Unknown、主体／scope、legality、Profile layer、Capability競合、安定tie keyに基づく**state-equivalence class**へ分割する。各class内の全状態について、選択中の完全package／program identityのもとで条件を説明し実効結果（宣言されたno-opを含む）を確定できる場合だけProofとする。

状態は以下を区別して表示する。

- **Unknown**：現在の認可済みruntime Observationから値を確定できない。
- **Not Proven**：静的解析、到達性、非対応Domain、未到達状態等のためclassの結果を証明できない。
- **Not Checked**：要求されたdynamic sample／validationを実行していない。
- **Restricted/Unavailable**：Decision Traceが存在する可能性はあるが、認可されていないかcollectionが失効したため閲覧できない。
- **Proven**：宣言した完全state-equivalence classとidentity範囲で結果が成立する。

Unknown／Not Proven／Not Checked／Restrictedをfalse、empty、敵不在、成功したDefaultへ変換しない。証拠が不足するclassは未証明として残し、100%の分母から黙って除かない。100%は、有限の解析範囲、Domain境界、package／World／program identity、proofの制約を示し、その範囲に含まれる全classが証明されたときだけ表示できる。単一の実測traceは、別に一般化を証明しない限りclass全体の証明ではない。

Decision Traceは通常Observationとpublic Replayから分離された `RestrictedDiagnostics`。Enbuが記録できるのは認可済みObservation context、candidate source、適用条件、legality、競合／tie結果、実効選択、確定結果へのlinkのみ。追跡対象の陣営が知らなかったfactや、相手のprivate Jinrei／configuration／memory／rejected candidateを漏らさない。取得時にrequest principalとpurposeを認可し、期限切れ／無認可のdiagnosticをpublic replayから再構成しない。診断が存在すること自体は閲覧権限を与えない。

## 6. DECISION_REQUIRED register

以下は未決定事項である。選択肢は影響を示すもので、ゲーム規則を決定しない。各判断が責務所有者の仕様と版付きRulePackage／World profile／Observation contractに反映されるまで、実装は選択肢を推測しない。

| ID／owner | 未決定の契約 | 選択肢と影響 |
| --- | --- | --- |
| **DEC-WORLD-BINDING-001** · World／Senritsu | World logic artifactをRulePackage／RulePlanでどう保持するか。 | **A. Canonical projectionを埋込む：** 検証と保管が自己完結するが、packageが大きくなりWorld/compiler schema変更でpackage bytesも変わる。**B. content-addressed reference：** 再利用できpackageは小さいが、不変Artifactの可用性、resolver規則、参照先不在時の明示的失敗が必要。いずれも完全World identityとdigestを束縛し、map IDだけの参照は禁止。 |
| **DEC-WORLD-MAP-CONVERSION-001** · World／Senritsu／Enbu | Canonical topology／metric／crossingからruntime BattleMapへの損失なし変換と追加lane／tower意味をどう宣言するか。 | **A. BattleMap projection schemaを拡張／versioning：** 完結したmap artifactと明示的なprogress range／identityを持てるが、consumerとcompatibilityを変更する。**B. supplemental conversion manifestを束縛：** map payloadを小さく保てるが、追加の版付きmapping artifactとvalidationが必要。既存のID不一致、edge全体のflag、lane list、towerはどちらでも明示的に扱い、非対応変換を拒否する。 |
| **DEC-BEHAVIOR-BINDING-001** · Senritsu／Behavior | matchに影響するProfile／Default／aggregationをどこに置き、どのdigestで束縛するか。 | **A. RulePackageに含める：** package digest一つで管理でき、Program／match identityが単純になるが、metadata変更もpackage version／digestに反映する。**B. Catalog extensionを分離：** UI metadataを別利用しやすいが、意味を持つextensionのdigestをcompile、match、trace、reproductionまで運ぶ必要がある。非意味的extensionはmatch挙動を変えない。 |
| **DEC-TERRAIN-OCCLUSION-001** · World／Senritsu | 論理的なterrain occlusionの概念は合意済み。authoring shape、query geometry、視界半径／高台効果との組み合わせは未決定。Renderer geometry／Raycastは権威を持たない。 | **A. graph edgeまたはnamed regionに対する有限なvisibility blocker／relation：** 単純で検証しやすいが、境界表現が粗い。**B. 有限な論理空間mask／regionと決定論的query：** より細かく表現できるが、World schema、authoring、compatibilityの範囲が広がる。どちらも境界挙動を定め、描画形状から独立し、未合意の視界／attack規則を追加しない。 |
| **DEC-ATTACK-TIMING-001** · Combat／Senritsu／Enbu | 合意済みのwindup → impact → recoveryについて、離散Tick境界、target／range／livenessの再検証、同時impact順、cancel／interruptを決める。 | **A. impact時にattack legalityを再検証：** impact条件を満たさなくなったtargetへ予定effectを与えない。cancelと時間意味論を明示する必要がある。**B. windup時に成立条件をcommit：** preparation開始時にtargetを選び、後のimpactを明示的lock／snapshot規則で解決する。target移動による結果が異なり、commit済effectの意味が必要。いずれもduration／phase移行／同Tick処理を版付きRulePlanに定め、animation frameから導出しない。 |
| **DEC-MID-DIRECTION-001** · World／Senritsu／Observation | MID施設が敵の実際の移動方向を報告するための観測証拠、時間条件、direction語彙／粒度、reset／expiry規則。目的地や将来intentは公開しない。 | **A. 順序付けられたTickで同一stable entityを複数回観測：** 保守的で監査可能だが、必要な観測が揃うまでUnknown。**B. 隣接named graph location間の確定遷移：** 離散的で再現可能だがedge内の移動方向は表せない。**C. 連続して観測したpositionの有限量子化vector：** 空間の詳細を持つが、versioned quantization／boundary規則が必要で、より細かい位置情報を公開し得る。採択と認可の前に推定方向を公開せず、証拠不足はUnknownにする。 |

## 7. 検証境界と基準branch監査

producer／consumer契約を満たすにはend-to-endでidentityを照合し、不変inputから再現できる必要がある。Native／WASM同等性は同じpackage、World logic、Behavior binding、program、snapshot、component versionに対して確認する。Presentationはpaired Presentation digestに対して別に検証する。schema validationだけではgameplay互換性、coverage、diagnostic認可、視覚受入を証明しない。

次表は共通pinned baseのDTO監査であり、target contractや変換実装の主張ではない。

| 現行producer／public type | 現行identity／version | targetとの境界差 |
| --- | --- | --- |
| `senkei-world::VerifiedWorld`／`WorldIdentity` | Compiler 1.0.0。`world_id`、schema、compiler compatibility bounds、optional validation profile、SHA-256 `worldLogicDigest`、別SHA-256 `worldPresentationDigest`、Canonical Simulation／Presentation投影を持つ。 | identityは現行`NextRules`、Enbu `MatchContext`、Rust core Replay DTOへ運ばれない。digest内容のみではpaired identityにならない。 |
| `senkei_model::NextRules`／`BattleMap` (`senritsu::next_world`由来) | Next mechanics 2.0.0。mapはID、x/y／region／allegiance付きnode、optional id/site/fordとedge全体のblocked／length／regionを持つedge、lane list、bases、towersを持つ。 | World identity／digestがない。基準Worldとendpoint／lengthは35 node／42 edgeで一致するがedge IDは0/42本だけ一致し、World／site IDは異なる。runtimeのedge全体bridge／ford flagはWorld crossing progress rangeを表さない。World側にはruntime lane-route listと12 tower placementもない。検証済みmapping／metadataなしの直接変換はlosslessでない。 |
| `senkei_model::RulePackage`／検証済み`RulePlan` | Package ID／version／digest。canonical package digestは`ruleset.digest`を除いたcanonical serialize値のSHA-256。現行Next packageはinline `NextRules`。 | World identity referenceがなく、package validationだけではcompiled WorldとBattleMapが同一Artifactだと確認できない。 |
| `senritsu::DomainCatalog`／`CatalogCompatibilityKey` | Catalog schema 1.0.0。Packageとengine/language/IR identity、catalog digest、optionalに別hashしたBehavior metadata extension digestを持つ。extensionはruleset ID／version／digestへ束縛され、extension reference／内容はcatalog digestに含まれる。 | matchに影響するBehavior metadataの束縛方法は未決定。cache keyだけではEnbu match／reproduction recordが当該extensionを実際に使った証明にならない。 |
| `senkei-behavior::BehaviorResolver` | Behavior runtime 1.0.0。constructorでCatalogCompatibilityKeyをexact checkし、authored Behavior extensionを要求。汎用profile composition／candidate arbitrationは宣言済みmetadata、capability、arbitration、caller提供legalityを使う。 | Worldを調べたり、combat／pathfinding factを推測したり、effectをcommitしない。現行next packageにproduction Behavior profileはなく、合意済みDefault／subject／arbitrationがEnbu統合済みとの根拠にはならない。 |
| `MatchContext`、`SimulationArtifact`、`ReproductionContext` | Shared model 1.0.0、Enbu 1.2.0、Rust replay schema 1.0.0。MatchContextはruleset referenceとcomponent versionを持つ。ReproductionContextはattacker／defender snapshot、RulePackage digest、MatchContextを持ち、既定ではprivate／non-serializable。 | World/compiler/profile/Catalog identityがなく、full reproductionにはpackage／World実体を別途保持または解決する必要がある。 |
| Rust core `PresentationReplay`、JS `packages/replay-contract` | Core replayはschema／match／result digest／frames。JS replay 0.3 headerはSenritsu ID+digestとEnbu versionを持ち、Next adapterにはRulePackage／MatchResultも別途渡される。 | Rust replayはRulePackage／World identityを持たない。JS replayにはruleset versionとWorld ID／schema／profile／logic／presentation digestがない。どちらもpaired World-to-replay identityを完全には示さない。 |
| Web Worker／core-WASM client | Worker protocol 1とcore API 1.0.0は独立したwire contract。 | Protocol versionだけでは各message境界に必要なCatalog key、World identity、RulePackage／Program digestを代替しない。 |

したがって現行version／DTO名は互換性監査の入力であり、欠けたreferenceを免除しない。必須ID mapping／digestのないgenerated map、paired dependencyのないReplay、execution／reproductionまで束縛されないmatch-affecting Behavior extensionはend-to-end contractを満たさない。

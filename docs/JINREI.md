# Jinrei（陣令）— 戦術言語と戦律の接続契約

## 1. 役割（確定）

Jinreiは**プレイヤーが戦型を作るための静的型付きの専用戦術言語**。名称は「陣令（じんれい）」に確定した。Senritsuのルールそのものを記述・実行する言語ではない。

- ノーコードとテキストの編集面は同じ意味的な戦術を表現する。
- ソース／GUIからTyped Semantic IR、Costed Logical IR、検証済み専用バイトコードへコンパイルする。
- Rust製Jinrei VMが戦闘時に観測データと戦術メモリを処理して**Intent**を返す。
- 専用バイトコードのVMをWASMブラウザ向け／ネイティブ向けに配布する。
- 論理CUはCosted IRで定義。ホストが同じ仕事を物理的に畳み込んでも課金の意味を変更しない。

## 2. 言語コア／戦律依存の区別

| Jinreiコアに固定する能力 | Senritsuから導入する意味 |
| --- | --- |
| 条件、演算、選択、型検査、関数、状態、有限反復 | UnitClass、Laneなどの具体的な値 |
| 集合、ベクトル、行列、マスク、オプション型の表現機能 | ゲームの領域・兵科・対象の型付き軸・上限 |
| Observation / State / CommandのEffect種別 | どの陣営がどのComponentを観測可能か |
| 型付きのIntent生成メカニズム | Deploy、Move、Retreat等のCapability型と前提条件 |
| Costed IRと計測機構 | Senritsuの版付き料金表・部隊命令のコスト |
| コンパイル時の権限検査 | Preparation / Battleで許される作用範囲 |

汎用の`Lane`型や`EntityRef`型を定義しても、TOP/MID/BOTの値や兵科名、射程、HPが持つ意味はSenritsuに属する。動的な`Any`や任意の属性文字列で型安全性を回避しない。

## 3. ドメイン限定で拡張可能にする原則

1. Senritsuが供給する型付きDomain Schemaを使用してコンパイルする。
2. 戦術が参照するEntity/Component/Observationは、許可された観測を通してのみ取得する。
3. 一時値と永続戦術メモリを分け、消滅したEntityの参照は型安全なOption等で検査する。
4. Capabilityは抽象的な「ゲーム操作を何でも実行できる関数」ではなく、Senritsuに登録された有限の命令シグネチャと権限である。
5. 非公開敵戦術、OS・ネットワーク・ファイル・外部時計等のアクセスは禁止する。
6. ループ／再帰を無条件には許さず、静的上限または実行燃料で停止性を保証する。

## 4. 表層文法・意味論（確定）

[JINREI-GRAMMAR.md](JINREI-GRAMMAR.md) を **v0.1の規範文法・評価意味論の正本**とする。Hero／Squad／Armyの行動選好の継承と条件付き上書きは [BEHAVIOR.md](BEHAVIOR.md)、利用可能な語彙は [DOMAIN-CATALOG.md](DOMAIN-CATALOG.md)、編集・可視化の体験は [JINREI-EDITOR.md](JINREI-EDITOR.md) に従う。stateは観測由来の名前付き三値述語、actionは必須のwhen/doからなる。波括弧とカンマ、インデント非依存、state直下AND、and/or/not、Known/Unknown、強Kleene三値論理、集合演算、同時評価と明示的なordered評価を採用する。具体的なDomain Schema・Capability・CU単価はSenritsuの版付き契約で定める。

## 5. Action scopeとBehavior Profile（追加合意）

Jinreiは**一つの宣言型プログラム**とし、Army/Squad/Hero/限定Minionの型付き作用対象を持つ。Army方針、Squadの移動・交戦、Heroの個別Skill／Targeting、Minionのレーン単位指示を、**Senritsuが宣言するCapabilityと対象型**により区別する。個別MinionにHero同等の自由な制御を標準追加しない。

Hero CatalogのDefault BehaviorとSquadの継承は**設定データの差分合成**であって言語クラス継承ではない。Jinreiに `extends`／`override`／`super`／代入などの新構文を増やさない。既存の `state`／`action`／`when`／`do` による型付きIntentから、該当Tickの選好上書きを行う。明示した永続効果だけはSenritsuのCapabilityで持続を宣言する。

同時評価・Unknown・CU・行動競合を変えず、コンパイル対象とEditorの語彙は同じSenritsu Domain Catalogに由来する。Editorは [JINREI-EDITOR.md](JINREI-EDITOR.md) を正本とする。

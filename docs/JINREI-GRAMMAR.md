# Jinrei（陣令）規範文法 v0.1

本書は陣令の**構文・型・評価意味論の正本**である。名称・責務は[COMPONENTS.md](COMPONENTS.md)、コンパイルと論理CUは[EXECUTION.md](EXECUTION.md)、ドメインの型・可視性・命令は[SENRITSU.md](SENRITSU.md)に従う。以下のレーン・塔・行動名は初期Senritsuの例であり、言語にハードコードしない。

## 1. 基本モデル

- `senkei`は戦型、`state`は自陣に公開された観測情報から導出する**名前付きの副作用のない条件**、`action`は状態によって有効化されるIntent候補を定義する。
- `state`は戦術のフェーズや可変変数への代入ではない。`when`はactionの発火条件であってstateを宣言しない。`do`はSenritsuに登録された型付きCapability呼出しであり、ワールドを書き換えない。
- 全stateとactionは両陣営で確定した同一Tickの**陣営別観測スナップショット**に対して論理的に同時評価される。物理的な並列実行は要求しない。
- 初期言語は宣言型。命令型ループ、任意再帰、暗黙のソース順優先度、ホストコード実行は禁止。反復・分岐は状態の論理結合、集合量化／集約、whenで記述する。

## 2. 正規の記述例

```text
senkei map_control {
    state top_secured {
        tower.top.owner == ally,
        tower.top.under_attack == false,
    },

    state bot_opportunity {
        top_secured,
        tower.bot.owner != ally,
        or {
            enemy.position is unknown,
            any target in enemies.visible {
                or {
                    target.position == top,
                    target.attacking == tower.top,
                },
            },
        },
    },

    state bot_threatened {
        count target in enemies.visible {
            target.position == bot,
        } >= 2,
    },

    action defend_bot {
        when bot_threatened,
        do defend(tower.bot),
    },

    action capture_bot {
        when bot_opportunity,
        do move(tower.bot),
    },
}
```

構文として正規の例であるが、フィールド名、Capability名・引数・型・観測許可はSenritsuのDomain Schemaに従う。スキーマにない名前の使用は型検査エラー。

## 3. 字句・区切り

- UTF-8ソース。v0.1の識別子は`[A-Za-z_][A-Za-z0-9_]*`、大文字小文字を区別する。フィールドアクセスは`a.b.c`。
- `{}`は宣言、論理ブロック、集合演算の範囲。`()`はCapability呼出しの引数。`,`は**すべての複数要素の区切り**。末尾カンマは許可、途中のカンマ省略は禁止。改行・インデントは構文に影響しない。行コメントは`//`。
- `=`による状態定義も代入もない。等価は`==`、不等価は`!=`。大小比較`< <= > >=`は型が対応する場合に限る。
- リテラル：`true`、`false`、整数、小数、ダブルクォート文字列。数値精度は型とSenritsuの規定による。ゲーム固有の`ally`、`top`等はドメインの列挙値。
- 予約語：`senkei state action when do and or not ordered any all count filter sum min max argmin argmax in by then is known unknown true false`。予約語は宣言名として使わない。

### コア文法（EBNF、字句解析後）

```ebnf
program       = "senkei", identifier, "{", declarations, "}" ;
declarations  = declaration, { ",", declaration }, [ "," ] ;
declaration   = state_decl | action_decl ;
state_decl    = "state", identifier, "{", predicates, "}" ;
action_decl   = "action", identifier, "{",
                "when", predicate, ",",
                "do", capability_call, [ "," ], "}" ;
predicates    = predicate, { ",", predicate }, [ "," ] ;
predicate     = state_name | comparison | knownness | quantified
              | "and", "{", predicates, "}"
              | "or", "{", predicates, "}"
              | "not", "{", predicate, [ "," ], "}"
              | "ordered", "and", "{", predicates, "}"
              | "ordered", "or", "{", predicates, "}" ;
comparison    = value, ("=="|"!="|"<"|"<="|">"|">="), value ;
knownness     = value, "is", ("known"|"unknown") ;
quantified    = ("any"|"all"), identifier, "in", collection, "{", predicates, "}" ;
value         = literal | path | aggregate | collection_expr ;
aggregate     = "count", identifier, "in", collection, "{", predicates, "}"
              | ("sum"|"min"|"max"), identifier, "in", collection, "by", value
              | ("argmin"|"argmax"), identifier, "in", collection,
                "by", value, "then", path ;
collection_expr = "filter", identifier, "in", collection, "{", predicates, "}" ;
collection    = path | collection_expr ;
capability_call = path, "(", [ value, { ",", value }, [ "," ] ], ")" ;
path          = identifier, { ".", identifier } ;
```

`state_name`はコンパイル時に解決するTruth型のstate参照。`value`の識別子パスには束縛変数・Domainシンボルを含む。数式・型付きベクトル／行列演算は同じ型付き式モデルとして拡張可能だが、構文v0.1の必須部分は上記の有限なコアとする。

- `state name { p1, p2 }`の直下は**暗黙AND**。単一条件も同じブロックで定義する。
- `and { ... }`／`or { ... }`はネスト可能で、`not { p }`はちょうど1つの述語を受け取る。空条件リストは禁止。`true`／`false`は明示する。
- state名/action名は各戦型内で一意。stateは前方参照可能だが循環参照は禁止。
- actionは**ちょうど1つの`when`と1つの`do`が必須**。常時候補なら`when true`と書く。`when`にはstate参照または単一の任意の合法述語を指定できる。`do`は1つの型付きCapability呼出し。
- 宣言や式の記述順から優先順位・先手権・ルール上の効果順序を推論してはならない。

## 4. 既知性と三値論理

- 観測値は`Observed<T> = Known(T) | Unknown`。観測不能と、既知の空集合／存在しない実体／falseを区別する。状態の型は`Truth = true | false | unknown`。
- `x == y`、`x != y`および大小比較はどちらかが未知なら`unknown`を返す。`unknown != top`をtrueとして扱わない。`unknown`リテラルとの通常の`==`比較は不可。
- `x is unknown`は未知のときtrue、`x is known`は既知のときtrue。どちらも**必ずtrue/false**を返し、観測値にもTruth型のstate結果にも適用できる。三値論理の評価とは別の既知性検査である。
- 強Kleene三値論理：ANDはfalseがあればfalse、すべてtrueならtrue、その他unknown。ORはtrueがあればtrue、すべてfalseならfalse、その他unknown。NOTはtrueとfalseを反転しunknownはunknown。
- `when`がtrueのときだけIntent候補を生成する。false/unknownは候補を生成しないが、unknownをfalseへ変換したことにはせず、診断では区別する。
- 直接観測できない敵情報はUnknownを返すか、アクセス権限が存在しなければ型／権限エラーとする。非対称情報の公開範囲をJinreiで勝手に拡張しない。

```text
state enemy_missing {
    enemy.position is unknown,
},

state target_uncertain {
    enemy_at_top is unknown,
},
```

## 5. 同時性、順序とCU

- state定義とactionは**同じ確定スナップショット**に基づく。通常のstate直下AND、`and`、`or`、`any`、`all`は**論理的に全要素を評価**する。並べ替えても結果・論理CUを変えてはならない。物理上の評価・並列化・キャッシュ方法は実装が選ぶ。
- 順序による短絡CU削減を行う場合は`ordered and { p1, p2, ... }`／`ordered or { ... }`を**明示**する。左から評価し、前者はfalse、後者はtrueが確定すれば以降の論理演算を要求しない。unknownだけでは確定しない。Truthは通常の強Kleene論理と一致する。
- 結果として順序が必要な対象選択・命令競合・依存した評価については全順序／タイブレークの定義を必須とし、欠落時は静的検証またはRulePlan検証で**エラー**とする。ソース順・HashMap順等を勝手に使用しない。
- 未参照stateはCUを消費しない。同じスナップショット・同じ名前付きstateは**論理的に1回の評価と参照費用**として課金する。実装のキャッシュは任意だがCUを変更できない。新しいスナップショットで値の同一性を証明できない限り古い物理キャッシュを再利用しない。
- CUは版付きCosted Logical IRで定義した論理演算と対象要素数に基づく。CPU・WASM・JIT・最適化の違いでCUを変えない。物理最適化により公開論理トレースも変更しない。

```text
state economical_bot_attack {
    ordered and {
        tower.top.owner == ally,
        tower.bot.owner != ally,
        any target in enemies.visible {
            target.position == top,
        },
    },
},
```

`ordered`はワールド更新順ではなく、**純粋な述語の評価計画**だけを表す。未指定の場合に実装が短絡CUを勝手に減らすことは禁止。

## 6. 有限集合演算（標準）

| 構文 | 戻り値 | 意味 |
| --- | --- | --- |
| `any x in C { p }` | Truth | 存在量化 |
| `all x in C { p }` | Truth | 全称量化 |
| `count x in C { p }` | Observed<Integer> | 成立要素数 |
| `filter x in C { p }` | Observed<Collection<T>> | 条件に合う集合 |
| `sum x in C by expression` | Observed<Number> | 集約和 |
| `min/max x in C by expression` | Observed<Option<Number>> | 最小／最大**値** |
| `argmin/argmax x in C by expression then unique_key` | Observed<Option<T>> | 最小／最大**要素**（一意キーでタイブレーク） |

- CはSenritsuから公開された**有限・型付き集合**。各束縛変数は式内のみ有効。集合がUnknownなら演算もunknown。
- 既知の空集合：`any=false`、`all=true`、`count=0`、`filter=empty`、`sum=0`、`min/max/argmin/argmax=none`。空集合はUnknownではない。
- 述語にunknownがあるとき`any/all`は強Kleeneの規則、`count/filter`は結果が確定しなければUnknown。数値集約／選択も対象値が不明で結果を確定できないならUnknown。
- `argmin/argmax`の`then`には型スキーマ上で**既知・安定・一意**と検証できるキーを要求する。暗黙のfirst/lastや不明確な同点解消は禁止。
- 反復は有限。各要素の評価回数・ディスパッチ等に基づきCUを課金し、ベクトル／行列化によって要素数に比例する仕事を無料化しない。

## 7. 行動と実行境界

```text
action defend_top {
    when top_threatened,
    do defend(tower.top),
},
action advance {
    when true,
    do move(tower.bot),
},
```

- `do`の戻りは副作用ではなくIntent候補。SenritsuのCapability署名、事前条件、CUと観測権限に基づいてコンパイル／実行時に検証し、Enbuのみが世界を更新する。
- 複数actionが同時に成立した場合もソース順ではなくSenritsuの明示的な優先度・競合解決・同順位ルールを適用する。未定義な競合は黙って選ばずエラー。
- 既存のSenkei初期戦術メモリとJinrei VMの戦術メモリ入力／次状態出力の契約は維持する。`state`は戦術メモリへの代入ではない。変更は型付きで明示的なEffect/Capabilityのみ許され、v0.1の必須表層構文には任意代入や暗黙のメモリ更新を含めない。

## 8. 適合性

Parserはカンマ不足、`=`、不正な`not`、空条件、欠落／重複`when/do`、括弧不一致を拒否する。型検査は未知シンボル、型違反、state循環参照、観測権限違反、未知Capability、有限上限違反、必要な全順序欠落を拒否する。

最低限の証明：
1. state/actionの宣言順・通常AND/ORの子要素順を入れ替えてもTruth・Intent・CUが一致。
2. `ordered and/or`だけが指定した順序で短絡し、Truthは不変・CUは計算契約どおり変化。
3. `false AND unknown = false`、`true OR unknown = true`、`NOT unknown = unknown`（この行はメタ表記）。
4. `enemy.position is unknown`はtrueでも`enemy.position != top`はunknown。stateへの`is unknown`も二値を返す。
5. Known(empty)とUnknown、集合の三値伝播、空集合／一意な選択／同点処理。
6. 非公開情報や未定義の順序・Capabilityの拒否。
7. 同じ観測・版のGUI/テキスト、Rustネイティブ/WASMで論理結果・CU・Intentが一致。

## 9. 初期ルールが所有する詳細

兵科、TOP/MID/BOTの具体値、HP、施設、移動／戦闘Capabilityの意味、観測できる各フィールド、CU単価、Tick予算、競合調停表、型付き戦術メモリの具体キーとゲームバランスは**Senritsu／Enbuの別契約**であり、Jinreiに固定しない。実装時は初期Senritsuの検証済み・版付きパッケージとして具体化する。新たなゲーム数値を過去の合意事項として扱わない。

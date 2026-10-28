# 数理・論理・時間・空間アルゴリズム候補カタログ

> 全件**未採用・未測定の候補**。数学的に同値を証明できる条件と、実世界で速いかは別。文献に見られる名称を使用していても本ルールでの適用可能性は未検証。各IDは[実験台帳](EXPERIMENT-LEDGER.md)に紐付ける。詳細数式は[MATHEMATICS.md](MATHEMATICS.md)。

## A. 静的・コンパイル時の縮約

| ID | 技法 | 省く計算・適用条件 | 失効/落とし穴 |
| --- | --- | --- | --- |
| A01 | Constant propagation / folding | 固定RulePlan・装備・Jinrei定数を式へ代入 | World/Rule/Program版の変更 |
| A02 | Partial evaluation / specialization | 両Jinrei + Domain Schemaで固定した分岐を事前解決 | ゲーム状態/秘密観測まで定数扱いしない |
| A03 | Dead-value elimination | 終局/診断/Replayにも一切到達しない中間値を消去 | 出力・CU・診断の隠れた依存を残す |
| A04 | Common subexpression elimination | 同一Snapshot・同一観測権限内の重複物理計算を共有 | 論理CUを消さない、Knownness/同Tick同一性が必要 |
| A05 | Invariant hoisting | 区間中不変と証明した選択/経路/比較を再利用 | Guardが変われば即失効 |
| A06 | Algebraic rewriting | `(x+a)+b`等の同値変形 | 整数overflow/丸め/飽和に関して不正な結合法則に注意 |
| A07 | Expression DAG / hash-cons | 式の共有で展開爆発を抑える | 純粋関数性・評価境界が必要 |
| A08 | Abstract interpretation | 区間、Known/Unknown、符号、単調性を保守的に推論 | 不正確な近似から最適化を確定させない |
| A09 | Predicate decision DAG | 同一条件、共通ガード、重複観測の物理評価を共有 | `ordered`の論理評価順・CUは残す |
| A10 | Query-plan rewrite | Jinreiの集合/量化/選択を安全な実行計画へ | 論理要素評価数/全順序/三値を保つ |
| A11 | Rule primitive effect summaries | Senritsu primitiveのRead/Write/Guard/Phase宣言 | 宣言漏れを検証、opaqueはfallback |
| A12 | Multi-version specialization | 状態パターン別に専用計画を保持 | コンパイル・キャッシュメモリが支配的になる |

## B. 時間方向の数学的縮約

| ID | 技法 | 典型ケース | 安全性条件 |
| --- | --- | --- | --- |
| T01 | Affine closed form | `x[t+1]=x[t]+v`、一定進捗 | 区間中の速度と丸め順を固定 |
| T02 | Matrix exponentiation | 結合した線形状態`X[t+1]=AX[t]+b` | 整数/飽和など同じ代数構造で演算可能 |
| T03 | Triangular/nilpotent recurrence | XP/成熟/蓄積に近い段階積分 | 依存係数と更新時刻を固定 |
| T04 | Polynomial/quasi-polynomial recognition | 差分一定・周期丸めを含む反復 | 有効範囲と整数演算を証明 |
| T05 | Piecewise transition composition | 移動→交戦→停止、技能期限 | 正確な最初のガード成立Tick |
| T06 | Threshold crossing solver | HP閾値、射程・速度切替 | 厳密な不等号、単調性 |
| T07 | Pairwise contact solver | 位置の線形/区分移動、射程/視界 | 実際の論理距離/座標系で解く |
| T08 | Periodic schedule arithmetic | 出撃Wave、攻撃間隔、周期回復 | 開始Tick、上限、位相を固定 |
| T09 | Bulk timer expiry | CD、Respawn、Revealなど | 当該Tick内の評価フェーズ |
| T10 | Repeated combat aggregation | 定ダメージ・定間隔攻撃 | 初被弾、Shield、同時死亡、kill XPを境界として分割 |
| T11 | Cycle detection / fast-forward | 有限状態の反復、安定した行動サイクル | 全関連状態・時刻位相・CU/Trace効果が一致 |
| T12 | Binary lifting / jump tables | 同じ遷移関数の`2^k`合成 | モード変化や外部依存が途中で変わらない |
| T13 | Symbolic guard solving | 複合Jinrei条件の成立時刻導出 | Unknownの可否、集合変化、丸めを反映 |
| T14 | Interval arithmetic proof | 次の`k`Tickでガード不成立を証明 | 保守的に評価、不確実なら分割 |
| T15 | Monotone event search | HP減少、制圧進捗の条件成立時刻 | 単調性が途切れる効果/命令時は撤回 |
| T16 | Difference constraints / min-plus | 到達時刻、段階的期限・最短経路 | 時間依存重み/予約状態を考慮 |
| T17 | Repeated transformation composition | 同じSkill/Effect系列の畳込み | 非可換更新や同Tick競合を順序付き合成 |
| T18 | Generating functions / recurrence solving | 規則的な複数時系列の集計 | 式サイズと計算時間が元より小さいこと |
| T19 | Parametric segment memoization | 同条件で繰返す区間の結果を再利用 | World/Rule/視界/CUを含むキャッシュキー |
| T20 | Batched logical CU reconstruction | 物理Tickを飛ばしつつ論理操作費用を復元 | 分岐・集合サイズ・予算停止が区間で一定/解析可能 |

## C. 空間・集合・相互作用の縮約

| ID | 技法 | 対象 | 注意 |
| --- | --- | --- | --- |
| S01 | Active Set / dirty actors | 能動的な主体だけ評価 | 非主体の施設/終局/周期も扱う |
| S02 | Dependency invalidation graph | 状態変更から必要な判定のみ再評価 | 書込み検知・フェーズ・観測権限 |
| S03 | SCC decomposition | 相互依存の強連結成分ごとに解く | SCC内部は固定点/同時刻スナップショットが必要 |
| S04 | Spatial grid / hash | 近接候補の絞込み | 負荷分布・巨大射程・境界セル |
| S05 | Sweep line / interval index | 射程・視界進入の時刻候補 | 軌道が既知の区間だけ |
| S06 | BVH/R-tree / dynamic AABB | 不規則な範囲と動的配置 | 更新コスト、論理距離の正確な判定 |
| S07 | Graph adjacency / region partition | レーン・橋・ジャングル・接続領域 | 経路変更・橋破壊で失効 |
| S08 | Cached route / incremental path | 目標変更が少ない経路計算 | 予約・通行・観測された橋の状態 |
| S09 | Batched pairwise reachability | 多数の同型ユニットの相互作用 | 個体ID・所有・特殊状態・個別ターゲットを保存 |
| S10 | Incremental aggregates | 視界内人数、攻撃候補、XP対象者数 | Known/Unknownと順序、Membership変化 |
| S11 | Incremental visibility | 可視集合とFogの境界変化 | 遮蔽/Reveal/権限/履歴を正しく処理 |
| S12 | Bitset/bitmap predicate projection | 大量の同質的集合条件 | 論理評価全要素のCUをそのまま計上 |
| S13 | Influence cone / causal slice | 変更の及ばない部分グラフの再計算排除 | 将来の波及と共有資源を含める |
| S14 | Symmetry / equivalent-actor reduction | 同一条件のMinion群 | 順位・ID・不均等被弾で同値類が崩れる |
| S15 | Lazy materialization | 要求されたTickだけ完全状態/Replay表示化 | 全Tick出力要求時は出力量の下限が残る |
| S16 | Multi-resolution observation | 精度を変えず大域→局所絞込み | 近似判定は候補生成まで、最終判定は厳密 |

## D. 実行スケジューリング（数学的方式と直交）

| ID | 技法 | 有効条件 | 悪化条件 |
| --- | --- | --- | --- |
| Q01 | Global Tick sweep | 状態変化が密、出力毎Tick | 無関係な主体多数 |
| Q02 | Unit-major sweep | 個体ローカルで独立演算が多い | 同時相互作用の同期不足 |
| Q03 | Active Set Tick | Tickは維持しdirty/active主体のみ | 全員が常時active |
| Q04 | Discrete-event queue | 変化時刻が疎 | 膨大な予測/取消/更新 |
| Q05 | Calendar / timing wheel | タイマー密度/時刻範囲が適合 | 変化の非一様性・衝突 |
| Q06 | Dependency-driven evaluation | 更新が少ない・局所依存 | ほぼ全状態が毎回連鎖 |
| Q07 | Adaptive temporal batching | 関数が有効な区間で時間ジャンプ | ガード境界が毎Tick発生 |
| Q08 | Dense phase fallback | イベント密なTickのみGlobal Tick | 切替コストが大きい |
| Q09 | Local region scheduler | 特定レーン/橋周辺だけ同期 | 陣営全域のBuffや共有観測 |
| Q10 | Offline whole-match optimization | 全入力が戦闘開始前に固定 | 式爆発、解法が逐次実行より高価 |
| Q11 | Optimistic prediction with rollback | 低頻度の予測失効・復旧が安い | 失効が頻繁、Trace再構成が重い |
| Q12 | Conservative prediction | 確実に成立する区間だけジャンプ | 成立可能区間が短すぎる |

## E. 失敗から守る「候補を捨てない」設計

- **イベント**は「物理的に処理する必要がある境界」を意味しない。再現すべき論理イベントを式で集約できる場合がある。
- **連続時間の解**はあくまで候補。射程/速度/座標は整数Tick、Worldの距離規則、移動フェーズと丸めへ戻す。
- **決定論的**でも任意の遷移が短い閉形式を持つとは限らない。複雑な非線形や一般のプログラム的遷移はopaqueとして扱えることが必要。
- **最良計算量**は入力依存。Tick、Unit、相互作用、出力件数、式のサイズに別々の漸近表記を用いる。
- **GPU/SIMD**は第2段階の候補であり、数学的に不要になった演算を再投入してはいけない。
- 遷移計算だけでなく、コンパイル、メモリ確保、予測失効、リプレイ生成、CU再構築まで含めて損益比較する。

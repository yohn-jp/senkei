# Fog of War — 探索済み地形と情報鮮度の契約

## 適用範囲

G02の選択は**探索済み地形を保持するFog**。ゲームの論理視界・陣営別Observationは[WORLD](WORLD.md)、Worldの不変地理・地形遮蔽は[WORLD-DEFINITION](WORLD-DEFINITION.md)、許可された表示だけを受け取る境界は[REPLAY](REPLAY.md)および[RUNTIME-INTEGRATION-CONTRACTS](RUNTIME-INTEGRATION-CONTRACTS.md)に従う。本書は視界半径、遮蔽計算の詳細アルゴリズム、履歴をJinreiに公開するCapabilityを新たに決定しない。

## 陣営・Tickごとの3状態

| 状態 | 意味 | 描画 |
| --- | --- | --- |
| **Visible** | 現在の認可済みObservationで見えている | 現在観測可能な地形・ユニット・可変状態 |
| **Explored** | 過去に見たが現在は見えない | **不変の地形を保持**。可変物は「最後に見た時点」の情報のみ |
| **Unexplored** | 観測歴も初期公開地理もない | 未公開の地形・対象を隠す |

Exploredは**現在Knownではない**。Unknownはfalse／不存在／0ではない。事前に双方へ公開されるWorldの静的位置（例：拠点所在地）を表示することは可能だが、所在地の既知性はHP・所有権・生存状態が現在Knownであることを意味しない。静的位置の初期公開範囲はWorld／RulePackageに従う。

## 対象別の表示契約

| 対象 | Visible | Explored／視界外 | Unexplored |
| --- | --- | --- | --- |
| 不変の地形・河川・道路 | 表示 | 探索済み形状を保持 | 非公開なら隠す |
| 橋サイト・固定施設の位置 | 表示 | 探索済みまたは最初から公開された位置を保持 | 非公開なら隠す |
| **橋の建設・拡張・破壊状態** | 認可済み最新状態 | **最終観測値であることを表示**。現在はUnknown | 非公開 |
| 塔・拠点のHP、所有、損傷、キャンプ状態 | 認可済み現在値 | 未観測の変化を更新しない。最終観測を出すなら時点付き | 非公開 |
| **敵Hero／Minion／Monster等** | 観測許可されたユニットのみ表示 | **非表示。最後の位置に敵のゴーストも残さない** | 非表示 |
| 自軍ユニット | 自軍の情報権限に従う | 自軍の情報権限に従う | 自軍の情報権限に従う |

戦場だけでなくミニマップ、選択、ツールチップ、Timeline、分析、Exportにも同じ意味を適用する。視界外の現在値をUIへ配布して単に隠すことは禁止。

## 橋の再観測の例

Tick 18に通常橋を観測、Tick 25に視界を失い、視界外のTick 40で橋が破壊、Tick 61に再観測すると仮定する。

1. Tick 18：橋の現在状態はKnown（通常）。
2. Tick 25–60：位置と「Tick 18には通常橋だった」という**観測履歴**を表示してよい。**現状はUnknown**。Tick 40の破壊・HP・敵操作を開示しない。
3. Tick 61：新しい許可済みObservationによって現在状態を破壊済みに更新。
4. 最終観測を「今も通れる橋」と断定しない。Jinreiが過去観測を利用できるかは**別の型付きCapabilityの採用判断**であり、UIの記憶を現在Knownに変換しない。

このTick例は仕様値ではない。Last Known表示を残す場合の保存期間・失効・再計画の詳細は個別契約を要する。

## ProducerとConsumerの責務

- **World／Senritsu**：視界提供者、不変の地理、論理遮蔽、観測可能な型を定義。
- **Enbu**：同じTickの陣営別Observationを確定し、Public／Owner／Restrictedに分け、見えていない実状態を開示しない。
- **PresentationReplay**：許可されたScene、出現／消失、施設変化だけを投影。未観測の破壊イベントを流してUIで隠す方式は禁止。
- **Replay Player**：認可済み履歴からExploredと最終観測を再構成。直接シークと順再生の同Tick View Stateは同じでなければならない。
- **Renderer**：視界の3状態を描くのみ。GPU Raycastや見た目の重なりから論理視界・敵位置を再計算しない。
- **Jinrei**：現在Known／Unknownは認可済みObservationに依存。Last Knownは別契約なしには現在値として参照できない。

可視性を失った敵を画面外へ補間・追跡し続けない。Tactical／Cinematic切替で認可が変わらない。全知視点を別に作る場合は別の権限付きProjectionが必要。

## 受入ケース

1. 初期公開の静的位置、Unexplored、Visible、Exploredを区別。
2. 探索済み地形は視界が失われても残り、未探索地形は漏れない。
3. 敵が視界外になると戦場・Minimap・詳細・選択から消える。
4. 未観測の橋破壊では現在値は変わらず、過去の観測と現在Unknownが区別され、再観測で最新状態になる。
5. 非公開の塔HP、キャンプ、敵内部TraceがReplay／Exportから漏れない。
6. 同Tickへの順再生、ランダムシーク、巻戻しで探索記憶と表示が完全一致。
7. Owner／Public／RestrictedのProjectionが権限どおりであり、表示モードで昇格しない。
8. Jinreiの三値Known／Unknownと表示用Exploredを混同しない。
9. Fog描画・LOD・FPSはEnbu結果と論理CUを変えない。

**未決**：DEC-TERRAIN-OCCLUSION-001、DEC-MID-DIRECTION-001、初期地図公開範囲、観測履歴の保持・Jinrei公開条件。未実装ケースはNOT_CHECKED。

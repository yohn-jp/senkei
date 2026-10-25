# G2アート方向 — Faceted Low-Polyと可読性

## 方針

V01–V03はHero、Minion、Monster、地形、橋、施設に共通の**Faceted Low-Poly Stylized 3D**を採用方向とする。[GRAPHICS](GRAPHICS.md)、[HERO-ATELIER](HERO-ATELIER.md)、[BATTLEFIELD-VISUAL](BATTLEFIELD-VISUAL.md)が個別の正本。これだけでSophiaや12 Heroのモデルが完成したとは扱わず、個別造形契約の確定済み面構成・形状・デフォルメを優先する。面数・頭身等を推測で数値化しない。

## V01 — TacticalとCinematic

- **Tactical**：敵味方、Hero／Minion、交戦、地形、橋、レーン、視界、対象選択の可読性を最優先。
- **Cinematic**：Hero・地形・建築の造形と演出を主役にする。
- 視界・レーン・交戦等の情報レイヤーは必要に応じ表示を切り替える。
- 表示は**同一の認可済みReplayと同一Renderer**のカメラ・材質・表示設定。別のゲーム世界や戦闘計算を作らない。
- [FOG](FOG-OF-WAR.md)は全モード共通。Cinematicで未観測の敵や橋の現在状態を暴露しない。

## V02 — 共通Generator＋固有Hero

共通のファセット配置、面の方向、輪郭、材質、装備のレイヤーをGenerator／部品／材質ライブラリで管理する。Hero固有の武器・装備・体型・姿勢を残し、単なる色違いにしない。Hero Detailと戦場LODは同じAppearance identityと生成元を参照。Minion／MonsterはHeroと識別でき、施設・地形も同じ材質文法で統一。Pixel／Smoothは任意の描画パスであり、Pixel処理で仮造形を隠さない。Generator版、assetKey、材質、LOD、アニメーション、出典／ライセンスを再生成可能に保持する。

## V03 — LODとパフォーマンス

LODは距離だけでなく**画面占有サイズ**とOverview／Followカメラを考慮。Instancing、共有Geometry／Material、不要な更新停止を検討。FPS／LOD／Pixelパスの変更でEnbu結果・論理CU・観測情報が変わることは禁止。Viewport／ズーム別の可読性は目視評価し、実機GPU・メモリ・タッチは実測する。SwiftShaderのPASSを実機PASSとしない。

## 受入

Heroの近・遠景が同じ個体として識別可能、地形・橋・戦線・施設がTacticalで認識可能、Tactical／Cinematic間で権限と確定イベントが一致。**Functional／Visual／Interaction／Performance**を別判定し、未実施はNOT_CHECKED。

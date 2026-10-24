# Senkei Hero assets

F01はBlender StudioのSnow v4.2を人体入力として改変し、Senkei用の装備を加えるStylized 3D指揮官（レビュー対応中）。青の織物、銀の面取り装甲、金の三段シェブロン、大盾と剣、銀髪と頬の傷をidentityとする。仮称・仮設定はゲームCatalogの正本ではない。

- `sources/heroes/common.py`: 成形ロフト、ポリゴン装甲、曲線装飾、UV、PBRの共有部品。
- `sources/heroes/f01.py`: F01固有の装備・材質・織物画像・SPEC。
- `sources/heroes/snow_base.py`: Snowの人体・髪・目・衣服のメッシュ／ウェイトを抽出し、Senkeiへ適合。
- `sources/vendor/snow-v4.2/`: 改変していない原配布blend、CC-BY-4.0全文、取得元とハッシュ、許諾証拠。
- `generated/f01/f01.blend`: Detailメッシュ、共通ボーン、5 Action/NLAを含む編集可能なBlenderソース。
- `generated/f01/*.glb`: 同じ定義から出力するDetail/Battle。カメラ・照明・台座は含めない。
- `manifests/f01.json`: 表示専用appearanceKey、出典、生成元ハッシュ、LODのサイズ・三角形数・SHA-256、動作規約。

生成・検証・表示手順と画像評価は [F01レビュー対応レポート](../docs/F01-REVIEW.md) を参照。

## License / provenance

人体・顔・髪・眉・目・衣服の元メッシュ／ウェイトは **Snow Rig (CC) Blender Foundation | studio.blender.org**、[CC BY 4.0](sources/vendor/snow-v4.2/LICENSE-CC-BY-4.0.txt)。配布元: https://studio.blender.org/characters/snow/v4/ 。形状の抽出、subdivision、手の握り、共通リグへのrebind、銀髪・肌・目・衣服の材質を改変する。配布元のPython・制御リグ・外部テクスチャは実行／組込しない。元データの [provenance](sources/vendor/snow-v4.2/provenance.json) と [許諾記載](sources/vendor/snow-v4.2/license-evidence.json) を保持する。

Senkeiが記述したPythonコード、追加装備、独自の材質・織物画像・アニメーションはリポジトリの [Apache-2.0](../LICENSE)。生成GLB／blendとレンダリングはSnowの改変形状を含むため、**Apache-2.0のみとして再配布しない**。Snowのクレジット・CC BY 4.0・出典・変更の明記を維持する。

旧モデル（commit `04c7a84`）は人体も手続き生成した不採用試作。今回の改訂形状とライセンスを混同しない。Blenderは制作ツール、Three.jsは既存MIT依存。ブラウザ照明はThree.jsのRoomEnvironmentを使用する。

# Senkei Hero assets

F01はSenkei専用に制作したオリジナルのStylized 3D指揮官。青の織物、銀の面取り装甲、金の三段シェブロン、大盾と剣、銀髪と頬の傷をidentityとする。仮称・仮設定はゲームCatalogの正本ではない。

- `sources/heroes/common.py`: 成形ロフト、ポリゴン装甲、曲線装飾、UV、PBRの共有部品。
- `sources/heroes/f01.py`: F01固有の形状・材質・装備・織物画像・SPEC。
- `generated/f01/f01.blend`: Detailメッシュ、16ボーン、5 Action/NLAを含む編集可能なBlenderソース。
- `generated/f01/*.glb`: 同じ定義から出力するDetail/Battle。カメラ・照明・台座は含めない。
- `manifests/f01.json`: 表示専用appearanceKey、出典、生成元ハッシュ、LODのサイズ・三角形数・SHA-256、動作規約。

生成・検証・表示手順と画像評価は [F01制作レポート](../docs/F01-PRODUCTION.md) を参照。

## License / provenance

本ディレクトリのPython定義、形状、リグ、アニメーション、手続き生成した128×128織物画像、生成GLB／blend、および `docs/evidence/f01/` の制作レンダリングは本リポジトリの [Apache-2.0](../LICENSE) に従う。外部のモデル、ゲームキャラクター、画像、写真、モーション、HDRIを取り込んでいない。参考は `docs/HERO-ATELIER.md` のStylized 3D方向性と `docs/UNITS.md` のF01属性。

Blenderは制作ツール（出力のライセンスとは別）、Three.jsは既存依存（MIT）。ブラウザのスタジオ反射はThree.js付属 `RoomEnvironment` の手続き生成照明を使用する。MCP・アセット取得サービス・画像生成サービスは使用していない。

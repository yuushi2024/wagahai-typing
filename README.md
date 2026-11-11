# wagahai-typing

夏目漱石「吾輩は猫である」を丸ごと打てるタイピングゲームを作るためのプロジェクトです。

現時点では **タイピングゲーム本体は未実装** で、青空文庫の原文から
タイピング用の構造化データ（原文＋ひらがな読み）を生成し、検証・配置するところまでを行います。

- 作品: 吾輩は猫である（夏目漱石）
- 出典: 青空文庫 作品ID 789 <https://www.aozora.gr.jp/cards/000148/card789.html>
- 底本: 「夏目漱石全集1」ちくま文庫、筑摩書房
- 著作権: パブリックドメイン（著作権保護期間満了）

## 生成されるデータ

```
data/
├── raw/
│   └── wagahaiwa_nekodearu.txt   # 青空文庫テキスト(UTF-8) 原文そのまま
├── chapters/
│   ├── chapter01.json            # 章ごとのデータ（1〜11章）
│   ├── ...
│   └── chapter11.json
└── wagahai.json                  # 全章をまとめたデータ（メタ情報＋全段落）
```

規模（自動生成時点）:

| 項目 | 値 |
| --- | --- |
| 章数 | 11 |
| 段落数 | 2245 |
| 本文文字数 | 約 318,000 字 |

## データ仕様

### `data/wagahai.json`

```jsonc
{
  "meta": {
    "title": "吾輩は猫である",
    "author": "夏目漱石",
    "work_id": 789,
    "source": "青空文庫 (https://www.aozora.gr.jp/cards/000148/card789.html)",
    "chapter_count": 11,
    "paragraph_count": 2245,
    "license": "青空文庫 / パブリックドメイン（著作権保護期間満了）"
  },
  "chapters": [
    {
      "chapter": 1,
      "title": "1",
      "paragraph_count": 33,
      "paragraphs": [
        {
          "id": 1,
          "chapter": 1,
          "paragraph": 1,
          "text": "吾輩は猫である。名前はまだ無い。",
          "ruby": "わがはいはねこである。なまえはまだない。"
        }
      ]
    }
  ]
}
```

### `data/chapters/chapterNN.json`

1 章分のオブジェクト（`chapter` / `title` / `paragraph_count` / `paragraphs`）です。
`wagahai.json` の `chapters` の対応する要素と完全に同一です。

### 段落オブジェクト

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | int | 作品全体を通した通し番号（1 始まり、本文順） |
| `chapter` | int | 章番号（1〜11） |
| `paragraph` | int | 章内の段落番号（1 始まり） |
| `text` | string | ルビ・注記を除去した原文（タイプ対象の表記） |
| `ruby` | string | `text` 全体に対応するひらがな読み |

`ruby` は段落全体の読みで、`text` とは 1 文字ずつは対応しません
（漢字 1 文字が複数のかなになるため）。タイピング判定では `ruby`（かな）を
入力対象として用いる想定です。英数字・記号は読みでもそのまま保持されます。

例:

```
text: その上今までの所とは違って無暗に明るい。
ruby: そのうえいままでのところとはちがってむやみにあかるい。
```

## データ生成の仕組み

`scripts/generate_data.py` が以下を行います。

1. 青空文庫のルビ付き Shift_JIS テキスト（作品 ID 789）を取得し、UTF-8 で保存
   （`data/raw/wagahaiwa_nekodearu.txt`）
2. 冒頭の書誌情報・記号の説明と、末尾の底本情報・校正者情報・更新日などを除去
3. 章見出し（`［＃…］一［＃「一」は中見出し］`）で 1〜11 章に分割
4. ルビ解析
   - 青空文庫のルビ（`｜漢字《るび》` / `漢字《るび》`）を最優先で適用
   - ルビのない漢字は [pykakasi](https://github.com/miurahr/pykakasi) でひらがな読みを補完
   - ルビは片仮名ならひらがなへ正規化
   - `［＃…］` 注記、`※［＃…］` 入力者注、`〔〕` アクセント括弧を除去
   - 入力者注の面区点番号（例: `第3水準1-87-64`）は JIS X 0213 として Unicode 文字に復元
5. 章ごとの JSON と全章まとめ JSON を出力

## 使い方

```bash
# 依存関係
pip install -r requirements.txt

# データ生成（data/raw のテキストを使用）
python scripts/generate_data.py

# 青空文庫からテキストを取得し直してから生成
python scripts/generate_data.py --download

# テスト（JSON のパース・欠損・整合性チェック）
python -m unittest discover -s tests -v
```

`data/raw` の生テキストが存在しない場合、`generate_data.py` は自動的に青空文庫から取得します。

## ディレクトリ構成

```
.
├── README.md
├── requirements.txt
├── scripts/
│   └── generate_data.py     # データ生成スクリプト
├── tests/
│   └── test_generate_data.py
└── data/
    ├── raw/                 # 青空文庫テキスト(UTF-8)
    ├── chapters/            # 章ごとの JSON
    └── wagahai.json         # 全章まとめ JSON
```

## 今後の予定

- タイピングゲーム本体（フロントエンド）の実装
- 読み（`ruby`）を用いたかな入力判定・ミス判定
- 章・段落の選択や進捗保存などのゲーム機能

#!/usr/bin/env python3
"""吾輩は猫である タイピングゲーム用データ生成スクリプト.

青空文庫の作品ID 789（夏目漱石「吾輩は猫である」）のルビ付きテキストを取得し、
ヘッダー/フッターの除去・ルビ解析・読み補完を行って、章ごとの JSON を出力する。

使い方:
    python scripts/generate_data.py                # data/raw のテキストを使用
    python scripts/generate_data.py --download     # 青空文庫から再取得してから生成
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import zipfile
from io import BytesIO
from pathlib import Path

try:
    from pykakasi import kakasi
except ImportError:  # pragma: no cover - 依存関係の案内
    sys.stderr.write("pykakasi が必要です。 pip install -r requirements.txt\n")
    raise

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
RAW_TEXT = RAW_DIR / "wagahaiwa_nekodearu.txt"
CHAPTER_DIR = ROOT / "data" / "chapters"
COMBINED_JSON = ROOT / "data" / "wagahai.json"

# 青空文庫 作品ID 789「吾輩は猫である」ルビ付きファイル
AOZORA_ZIP_URL = "https://www.aozora.gr.jp/cards/000148/files/789_ruby_5639.zip"
AOZORA_MEMBER = "wagahaiwa_nekodearu.txt"

KANJI_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\u3005\u3006]")
# 章見出し（例: ［＃８字下げ］一［＃「一」は中見出し］）
HEADING_RE = re.compile(r"［＃[^］]*］([一二三四五六七八九十]+)［＃「[^」]*」は中見出し］")
# 入力者注（※［＃...］）と注記（［＃...］）
GAIJI_RE = re.compile(r"※［＃([^］]*)］")
NOTE_RE = re.compile(r"［＃[^］]*］")
# 面区点番号（例: 第3水準1-87-64 / 2-88-74 / 1-6-84）
CODE_RE = re.compile(r"(\d)-(\d{1,2})-(\d{1,2})")

KANJI_NUM = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10, "十一": 11,
}


def _kakasi():
    return kakasi()


def download_raw_text(dest: Path = RAW_TEXT) -> Path:
    """青空文庫から Shift_JIS テキストを取得し UTF-8 で保存する。"""
    import urllib.request

    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(AOZORA_ZIP_URL, timeout=60) as resp:
        payload = resp.read()
    with zipfile.ZipFile(BytesIO(payload)) as zf:
        raw = zf.read(AOZORA_MEMBER)
    text = raw.decode("shift_jis")
    dest.write_text(text, encoding="utf-8")
    return dest


def strip_header_footer(text: str) -> str:
    """冒頭の書誌情報・注意書きと末尾の底本情報などを除去し本文のみ返す。"""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    # 冒頭: 2 本目の区切り線（-----）の直後から本文が始まる
    delimiter_idx = [i for i, ln in enumerate(lines) if re.fullmatch(r"-{10,}", ln.strip())]
    start = delimiter_idx[1] + 1 if len(delimiter_idx) >= 2 else 0

    # 末尾: 「底本：」以降はメタデータ
    end = len(lines)
    for i in range(start, len(lines)):
        if lines[i].startswith("底本"):
            end = i
            break

    return "\n".join(lines[start:end]).strip("\n")


def decode_gaiji(spec: str) -> str:
    """入力者注の面区点番号を JIS X 0213 として Unicode 文字に変換する。"""
    matches = CODE_RE.findall(spec)
    if not matches:
        return ""
    plane, row, cell = (int(x) for x in matches[-1])
    try:
        if plane == 1:
            return bytes([0xA0 + row, 0xA0 + cell]).decode("euc_jis_2004")
        return bytes([0x8F, 0xA0 + row, 0xA0 + cell]).decode("euc_jis_2004")
    except (UnicodeDecodeError, ValueError):
        return ""


def clean_annotations(line: str) -> str:
    """［＃...］注記・※入力者注・アクセント括弧を除去する。"""
    line = GAIJI_RE.sub(lambda m: decode_gaiji(m.group(1)), line)
    line = NOTE_RE.sub("", line)
    line = line.replace("※", "")
    line = line.replace("〔", "").replace("〕", "")
    return line


def kata_to_hira(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if 0x30A1 <= code <= 0x30F6:
            out.append(chr(code - 0x60))
        else:
            out.append(ch)
    return "".join(out)


def is_kanji(ch: str) -> bool:
    return bool(KANJI_RE.match(ch))


def parse_ruby(cleaned: str, kks) -> tuple[str, str]:
    """本文 1 段落を (原文, ひらがな読み) に変換する。

    青空文庫のルビ（｜漢字《るび》 / 漢字《るび》）を最優先で適用し、
    ルビのない部分は pykakasi で読みを補完する。
    """
    units: list[tuple[str, str | None]] = []  # (surface, ruby or None)
    plain = ""
    bar: str | None = None
    i = 0
    n = len(cleaned)
    while i < n:
        ch = cleaned[i]
        if ch == "｜":
            if plain:
                units.append((plain, None))
                plain = ""
            bar = ""
            i += 1
        elif ch == "《":
            close = cleaned.find("》", i + 1)
            if close == -1:
                if bar is not None:
                    bar += ch
                else:
                    plain += ch
                i += 1
                continue
            ruby = cleaned[i + 1:close]
            if bar is not None:
                units.append((bar, ruby))
                bar = None
            else:
                split = len(plain)
                while split > 0 and is_kanji(plain[split - 1]):
                    split -= 1
                if plain[:split]:
                    units.append((plain[:split], None))
                units.append((plain[split:], ruby))
                plain = ""
            i = close + 1
        else:
            if bar is not None:
                bar += ch
            else:
                plain += ch
            i += 1

    if bar is not None:
        plain = bar + plain
    if plain:
        units.append((plain, None))

    surface = "".join(u[0] for u in units)

    reading_parts: list[str] = []
    for text, ruby in units:
        if not text:
            continue
        if ruby is not None:
            reading_parts.append(kata_to_hira(ruby))
        else:
            reading_parts.append(kata_to_hira("".join(x["hira"] for x in kks.convert(text))))

    reading = unicodedata.normalize("NFC", "".join(reading_parts))
    # pykakasi は「漢字＋っ」を「くっっ」のように促音重複させることがあるため補正
    reading = re.sub(r"っ{2,}", "っ", reading)
    return surface, reading


def split_chapters(body: str) -> list[tuple[int, list[str]]]:
    """本文を行単位で走査し (章番号, 章の本文行リスト) を返す。"""
    chapters: list[tuple[int, list[str]]] = []
    current_no: int | None = None
    current_lines: list[str] = []
    for line in body.split("\n"):
        m = HEADING_RE.search(line)
        if m:
            if current_no is not None:
                chapters.append((current_no, current_lines))
            current_no = KANJI_NUM.get(m.group(1), len(chapters) + 1)
            current_lines = []
            continue
        if current_no is None:
            continue
        current_lines.append(line)
    if current_no is not None:
        chapters.append((current_no, current_lines))
    return chapters


def build_dataset(text: str) -> dict:
    kks = _kakasi()
    body = strip_header_footer(text)
    chapters_raw = split_chapters(body)

    chapters_out = []
    combined = []
    entry_id = 0
    for chapter_no, lines in chapters_raw:
        paragraphs = []
        for line in lines:
            cleaned = clean_annotations(line).strip("\u3000").strip()
            if not cleaned:
                continue
            surface, reading = parse_ruby(cleaned, kks)
            if not surface:
                continue
            entry_id += 1
            entry = {
                "id": entry_id,
                "chapter": chapter_no,
                "paragraph": len(paragraphs) + 1,
                "text": surface,
                "ruby": reading,
            }
            paragraphs.append(entry)
            combined.append(entry)
        chapters_out.append({
            "chapter": chapter_no,
            "title": str(chapter_no),
            "paragraph_count": len(paragraphs),
            "paragraphs": paragraphs,
        })

    return {
        "meta": {
            "title": "吾輩は猫である",
            "author": "夏目漱石",
            "work_id": 789,
            "source": "青空文庫 (https://www.aozora.gr.jp/cards/000148/card789.html)",
            "chapter_count": len(chapters_out),
            "paragraph_count": len(combined),
            "license": "青空文庫 / パブリックドメイン（著作権保護期間満了）",
        },
        "chapters": chapters_out,
    }


def write_outputs(dataset: dict) -> None:
    CHAPTER_DIR.mkdir(parents=True, exist_ok=True)
    for ch in dataset["chapters"]:
        path = CHAPTER_DIR / f"chapter{ch['chapter']:02d}.json"
        path.write_text(json.dumps(ch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    COMBINED_JSON.write_text(
        json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="青空文庫からテキストを再取得する")
    parser.add_argument("--raw", type=Path, default=RAW_TEXT, help="使用する生テキスト(UTF-8)")
    args = parser.parse_args()

    if args.download or not args.raw.exists():
        print(f"downloading raw text -> {args.raw}")
        download_raw_text(args.raw)

    text = args.raw.read_text(encoding="utf-8")
    dataset = build_dataset(text)
    write_outputs(dataset)

    meta = dataset["meta"]
    print(f"chapters: {meta['chapter_count']}")
    print(f"paragraphs: {meta['paragraph_count']}")
    print(f"output: {CHAPTER_DIR}/*.json, {COMBINED_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

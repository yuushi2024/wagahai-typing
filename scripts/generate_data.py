#!/usr/bin/env python3
"""吾輩は猫である タイピングゲーム用データ生成スクリプト.

青空文庫の作品ID 789（夏目漱石「吾輩は猫である」）のルビ付きテキストを取得し、
ヘッダー/フッターの除去・ルビ解析・高精度形態素解析（UniDic/fugashi）による読み補完を行って、
章ごとの JSON を出力する。

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

# /workspace/.python_packages も import パスに追加
_PKGS = Path("/workspace/.python_packages")
if _PKGS.exists() and str(_PKGS) not in sys.path:
    sys.path.insert(0, str(_PKGS))

try:
    import fugashi
    _HAS_FUGASHI = True
except ImportError:
    _HAS_FUGASHI = False

try:
    from pykakasi import kakasi
except ImportError:  # pragma: no cover
    sys.stderr.write("pykakasi または fugashi が必要です。\n")
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

# 明治文学・漱石特有の慣用読み補正
CUSTOM_READINGS = {
    "人間中": "にんげんじゅう",
    "一樹の蔭": "いちじゅのかげ",
    "勤勉家": "きんべんか",
    "三馬": "さんま",
    "第一毛": "だいいちけ",
    "見始": "みはじめ",
    "這入": "はい",
    "御台所": "おだいどころ",
}


def _kakasi():
    return kakasi()


def _fugashi_tagger():
    if _HAS_FUGASHI:
        try:
            return fugashi.Tagger()
        except Exception:
            return None
    return None


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


def _text_to_hiragana_unidic(text: str, tagger, kks) -> str:
    """UniDic を用いて高精度にひらがな読みへ変換し、未解決の漢字は pykakasi で補完する。"""
    # 既知の慣用句を先行置換
    for word, reading in CUSTOM_READINGS.items():
        text = text.replace(word, reading)

    words = list(tagger(text))
    res = []
    for i, w in enumerate(words):
        surf = w.surface
        # 「〜中」の接尾辞判定（人間中、世界中、日本中、一日中、部屋中など）
        if surf == "中" and i > 0 and words[i - 1].surface in ("人間", "世界", "日本", "一日", "家", "部屋", "国", "町", "体"):
            res.append("じゅう")
            continue
        kana = w.feature.kana
        if not kana or kana == "*" or KANJI_RE.search(kana or ""):
            # 未知の漢字は pykakasi で安全に補完
            fallback = "".join(x["hira"] for x in kks.convert(surf))
            res.append(kata_to_hira(fallback))
        else:
            res.append(kata_to_hira(kana))
    return "".join(res)


def parse_ruby(cleaned: str, kks, tagger=None) -> tuple[str, str]:
    """本文 1 段落を (原文, ひらがな読み) に変換する。

    青空文庫のルビ（｜漢字《るび》 / 漢字《るび》）を最優先で適用し、
    ルビのない部分は UniDic(fugashi) または pykakasi で読みを高精度補完する。
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
            if tagger is not None:
                reading_parts.append(_text_to_hiragana_unidic(text, tagger, kks))
            else:
                reading_parts.append(kata_to_hira("".join(x["hira"] for x in kks.convert(text))))

    reading = unicodedata.normalize("NFC", "".join(reading_parts))
    # 促音の連続重複を補正
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
    tagger = _fugashi_tagger()
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
            surface, reading = parse_ruby(cleaned, kks, tagger)
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

    index_data = {
        "title": "吾輩は猫である",
        "author": "夏目漱石",
        "chapter_count": len(chapters_out),
        "paragraph_count": len(combined),
        "chapters": [
            {
                "chapter": c["chapter"],
                "title": c["title"],
                "paragraph_count": c["paragraph_count"],
            }
            for c in chapters_out
        ],
    }

    return {
        "index": index_data,
        "chapters": chapters_out,
        "combined": combined,
    }


def write_dataset(dataset: dict, out_dir: Path = CHAPTER_DIR, combined_path: Path = COMBINED_JSON) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = out_dir / "index.json"
    index_path.write_text(json.dumps(dataset["index"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for ch in dataset["chapters"]:
        p = out_dir / f"chapter{ch['chapter']:02d}.json"
        p.write_text(json.dumps(ch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    combined_path.parent.mkdir(parents=True, exist_ok=True)
    combined_data = {
        "meta": dataset["index"],
        "chapters": dataset["chapters"],
    }
    combined_path.write_text(
        json.dumps(combined_data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="青空文庫から最新 ZIP を再ダウンロードする")
    args = parser.parse_args()

    if args.download or not RAW_TEXT.exists():
        download_raw_text(RAW_TEXT)

    text = RAW_TEXT.read_text(encoding="utf-8")
    dataset = build_dataset(text)
    write_dataset(dataset)
    print(f"生成完了: 全 {dataset['index']['chapter_count']} 章 / {dataset['index']['paragraph_count']} 段落")
    return 0


if __name__ == "__main__":
    sys.exit(main())

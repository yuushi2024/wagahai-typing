#!/usr/bin/env python3
"""generate_data.py と出力 JSON の検証テスト.

実行:
    python -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import generate_data as gd  # noqa: E402

CHAPTER_DIR = ROOT / "data" / "chapters"
COMBINED_JSON = ROOT / "data" / "wagahai.json"
RAW_TEXT = ROOT / "data" / "raw" / "wagahaiwa_nekodearu.txt"

KANJI_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
NOTE_SYMBOLS = ["［", "］", "＃", "※", "｜", "《", "》", "〔", "〕"]


class HeaderFooterTest(unittest.TestCase):
    def test_strips_header_and_footer(self):
        body = gd.strip_header_footer(RAW_TEXT.read_text(encoding="utf-8"))
        self.assertTrue(body.startswith("［＃８字下げ］一"))
        self.assertNotIn("【テキスト中に現れる記号について】", body)
        self.assertNotIn("底本：", body)
        self.assertNotIn("青空文庫作成ファイル", body)
        self.assertNotIn("入力：柴田卓治", body)


class AnnotationTest(unittest.TestCase):
    def test_removes_notes(self):
        line = "鼻の下［＃「鼻の下」に傍点］がある"
        self.assertEqual(gd.clean_annotations(line), "鼻の下がある")

    def test_removes_indent_notes(self):
        line = "［＃ここから２字下げ］本文［＃ここで字下げ終わり］"
        self.assertEqual(gd.clean_annotations(line), "本文")

    def test_removes_accent_brackets(self):
        line = "〔Quid aliud est〕である"
        self.assertEqual(gd.clean_annotations(line), "Quid aliud estである")

    def test_decodes_gaiji(self):
        line = "まだ※［＃「言＋墟のつくり」、第4水準2-88-74］《いつ》わられた"
        # 2-88-74 は「言＋虚」= 譃 (U+8B43)
        self.assertEqual(gd.clean_annotations(line), "まだ譃《いつ》わられた")

    def test_decodes_small_kana_gaiji(self):
        self.assertEqual(gd.decode_gaiji("小書き片仮名ヒ、1-6-84"), "ㇶ")

    def test_unknown_gaiji_returns_empty(self):
        self.assertEqual(gd.decode_gaiji("説明のみで番号なし"), "")


class RubyParseTest(unittest.TestCase):
    def setUp(self):
        self.kks = gd._kakasi()

    def test_plain_kanji_uses_kakasi(self):
        surface, reading = gd.parse_ruby("吾輩は猫である。", self.kks)
        self.assertEqual(surface, "吾輩は猫である。")
        self.assertEqual(reading, "わがはいはねこである。")

    def test_kanji_ruby_is_preferred(self):
        surface, reading = gd.parse_ruby("吾輩《わがはい》は猫である", self.kks)
        self.assertEqual(surface, "吾輩は猫である")
        self.assertEqual(reading, "わがはいはねこである")

    def test_bar_ruby_covers_multiple_kanji(self):
        surface, reading = gd.parse_ruby("一番｜獰悪《どうあく》な種族", self.kks)
        self.assertEqual(surface, "一番獰悪な種族")
        self.assertEqual(reading, "いちばんどうあくなしゅぞく")

    def test_katakana_ruby_is_converted_to_hiragana(self):
        surface, reading = gd.parse_ruby("羅甸語《ラテンご》", self.kks)
        self.assertEqual(surface, "羅甸語")
        self.assertEqual(reading, "らてんご")

    def test_surface_has_no_ruby_markers(self):
        cleaned = gd.clean_annotations("｜御《ご》※［＃注記］猫")
        surface, _ = gd.parse_ruby(cleaned, self.kks)
        for sym in NOTE_SYMBOLS:
            self.assertNotIn(sym, surface)
        self.assertEqual(surface, "御猫")


class ChapterSplitTest(unittest.TestCase):
    def test_splits_eleven_chapters(self):
        body = gd.strip_header_footer(RAW_TEXT.read_text(encoding="utf-8"))
        chapters = gd.split_chapters(body)
        self.assertEqual([no for no, _ in chapters], list(range(1, 12)))


class OutputJsonTest(unittest.TestCase):
    """生成済み JSON のパース・欠損・整合性チェック。"""

    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(COMBINED_JSON.read_text(encoding="utf-8"))

    def test_chapter_files_exist(self):
        for no in range(1, 12):
            self.assertTrue((CHAPTER_DIR / f"chapter{no:02d}.json").exists())

    def test_chapter_count(self):
        self.assertEqual(self.data["meta"]["chapter_count"], 11)
        self.assertEqual(len(self.data["chapters"]), 11)

    def test_chapter_numbers_sequential(self):
        self.assertEqual([c["chapter"] for c in self.data["chapters"]], list(range(1, 12)))

    def test_every_paragraph_has_required_fields(self):
        required = {"id", "chapter", "paragraph", "text", "ruby"}
        seen = 0
        for chapter in self.data["chapters"]:
            for i, p in enumerate(chapter["paragraphs"], start=1):
                self.assertEqual(set(p.keys()), required)
                self.assertIsInstance(p["id"], int)
                self.assertEqual(p["chapter"], chapter["chapter"])
                self.assertEqual(p["paragraph"], i)
                self.assertTrue(p["text"].strip())
                self.assertTrue(p["ruby"].strip())
                seen += 1
        self.assertEqual(seen, self.data["meta"]["paragraph_count"])

    def test_ids_are_unique_and_sequential(self):
        ids = [p["id"] for c in self.data["chapters"] for p in c["paragraphs"]]
        self.assertEqual(ids, list(range(1, len(ids) + 1)))

    def test_no_annotation_residue(self):
        for chapter in self.data["chapters"]:
            for p in chapter["paragraphs"]:
                for sym in NOTE_SYMBOLS:
                    self.assertNotIn(sym, p["text"], msg=f"id={p['id']}")
                    self.assertNotIn(sym, p["ruby"], msg=f"id={p['id']}")

    def test_ruby_is_kana_only(self):
        for chapter in self.data["chapters"]:
            for p in chapter["paragraphs"]:
                self.assertIsNone(
                    KANJI_RE.search(p["ruby"]),
                    msg=f"id={p['id']} ruby={p['ruby']}",
                )

    def test_chapter_file_matches_combined(self):
        for chapter in self.data["chapters"]:
            path = CHAPTER_DIR / f"chapter{chapter['chapter']:02d}.json"
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), chapter)

    def test_no_empty_chapters(self):
        for chapter in self.data["chapters"]:
            self.assertGreater(chapter["paragraph_count"], 0)


if __name__ == "__main__":
    unittest.main()

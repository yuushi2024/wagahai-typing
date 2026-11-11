// ローマ字入力エンジンの単体テスト
// 実行: node --test tests/js/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSegments,
  RomajiMatcher,
  canonicalRomaji,
} from '../../assets/js/romaji.js';

// 文字列を 1 打鍵ずつ入力し、途中でミスが起きたら失敗させる
function typeAll(hira, romaji) {
  const m = new RomajiMatcher(buildSegments(hira));
  for (const ch of romaji) {
    const r = m.input(ch);
    assert.ok(r.ok, `"${romaji}" の "${ch}" でミス（対象: ${hira}）`);
  }
  return m;
}

// 受理できることを確認
function accepts(hira, romaji) {
  const m = typeAll(hira, romaji);
  assert.ok(m.complete, `"${romaji}" は ${hira} を完了できなかった`);
}

// 受理できないことを確認
function rejects(hira, romaji) {
  const m = new RomajiMatcher(buildSegments(hira));
  let ok = true;
  for (const ch of romaji) {
    if (!m.input(ch).ok) { ok = false; break; }
  }
  assert.ok(!(ok && m.complete), `"${romaji}" は ${hira} で受理されてしまった`);
}

test('かな -> ローマ字候補', () => {
  assert.deepEqual(buildSegments('し')[0].options, ['si', 'shi', 'ci']);
  assert.deepEqual(buildSegments('ち')[0].options, ['ti', 'chi']);
  assert.deepEqual(buildSegments('つ')[0].options, ['tu', 'tsu']);
  assert.deepEqual(buildSegments('ふ')[0].options, ['hu', 'fu']);
  assert.deepEqual(buildSegments('じ')[0].options, ['zi', 'ji']);
});

test('拗音は 1 セグメントにまとまる', () => {
  const segs = buildSegments('しゃ');
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0].options, ['sya', 'sha']);
});

test('複数の入力方式を受け付ける（し/ち/つ/ふ/じ）', () => {
  for (const r of ['si', 'shi', 'ci']) accepts('し', r);
  for (const r of ['ti', 'chi']) accepts('ち', r);
  for (const r of ['tu', 'tsu']) accepts('つ', r);
  for (const r of ['hu', 'fu']) accepts('ふ', r);
  for (const r of ['zi', 'ji']) accepts('じ', r);
});

test('拗音の入力方式（しゃ/ちゃ/じゃ）', () => {
  for (const r of ['sya', 'sha']) accepts('しゃ', r);
  for (const r of ['tya', 'cha', 'cya']) accepts('ちゃ', r);
  for (const r of ['zya', 'ja', 'jya']) accepts('じゃ', r);
  for (const r of ['syu', 'shu']) accepts('しゅ', r);
  for (const r of ['syo', 'sho']) accepts('しょ', r);
});

test('「ん」は母音・や行の前では n 単独不可、nn / xn は可', () => {
  accepts('んあ', 'nna');
  accepts('んあ', 'xna');
  rejects('んあ', 'na');
  // 子音の前では n 単独も可
  accepts('んか', 'nka');
  accepts('んか', 'nnka');
  accepts('んか', 'xnka');
});

test('促音（っ）は次子音の重ね打ち・ltu・xtu', () => {
  accepts('かった', 'katta');
  accepts('かった', 'kaltuta'); // っ を ltu で
  accepts('かった', 'kaxtuta'); // っ を xtu で
  rejects('かった', 'kata');
});

test('促音は複数方式を混在できる', () => {
  accepts('しっぱい', 'shippai');
  accepts('しっぱい', 'sippai');
  accepts('しっぱい', 'shiltupai');
});

test('代表例「わがはい」を wagahai で入力できる', () => {
  accepts('わがはい', 'wagahai');
});

test('進捗（done）が正しく進む', () => {
  const m = new RomajiMatcher(buildSegments('わがはい'));
  assert.equal(m.done, 0);
  m.input('w'); m.input('a');
  assert.equal(m.done, 1); // わ
  m.input('g'); m.input('a');
  assert.equal(m.done, 2); // が
  assert.equal(m.complete, false);
  m.input('h'); m.input('a'); m.input('i');
  assert.equal(m.complete, true);
});

test('ミスは correct を増やさず miss を増やす', () => {
  const m = new RomajiMatcher(buildSegments('あ'));
  const r = m.input('k');
  assert.equal(r.ok, false);
  assert.equal(m.correct, 0);
  assert.equal(m.miss, 1);
  m.input('a');
  assert.equal(m.correct, 1);
  assert.equal(m.complete, true);
});

test('入力途中で方式を切り替えられる（し を si と shi の途中まで）', () => {
  const m = new RomajiMatcher(buildSegments('しお'));
  m.input('s'); // si と shi の共通部分
  assert.deepEqual(m.nextKeys().sort(), ['h', 'i']);
  m.input('h');
  m.input('i'); // shi で確定
  assert.equal(m.done, 1);
});

test('記号・句読点を入力できる', () => {
  accepts('あ。', 'a.');
  accepts('あ、い', 'a,i');
  accepts('「あ」', '[a]');
});

test('英数字はそのまま入力できる', () => {
  accepts('ＡＢＣ', 'abc');
  accepts('１２３', '123');
});

test('canonicalRomaji は先頭候補を返す', () => {
  assert.equal(canonicalRomaji(buildSegments('し')[0]), 'si');
  assert.equal(canonicalRomaji(buildSegments('しゃ')[0]), 'sya');
});

test('実データの文を複数方式で完走できる', () => {
  // 「わがはいはねこである」
  accepts('わがはいはねこである', 'wagahaihanekodearu');
  accepts('わがはいはねこである', 'wagahaihanekodearu'.replace('shi', 'si'));
  // 促音 + 拗音 + ん の混合
  accepts('しんぶんしゃ', 'shinbunsha');
  accepts('しんぶんしゃ', 'sinbunsya');
  accepts('きっぷ', 'kippu');
});

// ガイド表示は matcher.current()（メソッド）を呼ぶ契約。
// プロパティ参照に退化すると undefined になり表示が止まるため、ここで固定する。
test('current() は現在のかな・候補・入力済みを返す', () => {
  const m = new RomajiMatcher(buildSegments('わがはい'));
  const c0 = m.current();
  assert.equal(typeof m.current, 'function');
  assert.equal(c0.kana, 'わ');
  assert.ok(c0.option.length > 0);
  assert.equal(c0.typed, '');

  m.input('w');
  const c1 = m.current();
  assert.equal(c1.kana, 'わ');
  assert.equal(c1.typed, 'w');
  assert.ok(c1.option.startsWith('w'));
});

test('current() は全かな入力後に null を返す', () => {
  const m = new RomajiMatcher(buildSegments('あい'));
  m.input('a');
  m.input('i');
  assert.equal(m.complete, true);
  assert.equal(m.current(), null);
});

test('nextKeys() は現在のかなで有効な次のキーを返す', () => {
  const m = new RomajiMatcher(buildSegments('し'));
  // si / shi / ci の先頭は s と c
  assert.deepEqual(m.nextKeys().sort(), ['c', 's']);
  m.input('s');
  // 残りは i と h の両方が有効
  assert.deepEqual(m.nextKeys().sort(), ['h', 'i']);
});

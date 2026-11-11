// 原文とルビの対応付けの単体テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignTextRuby, tokensForParagraph } from '../../assets/js/align.js';

function shape(text, ruby) {
  const t = alignTextRuby(text, ruby);
  return t ? t.map((x) => `${x.text}:${x.ruby}`) : null;
}

test('漢字のかたまりに読みが付く', () => {
  assert.deepEqual(shape('吾輩は猫である。', 'わがはいはねこである。'), [
    '吾輩:わがはい', 'は:は', '猫:ねこ', 'で:で', 'あ:あ', 'る:る', '。:。',
  ]);
});

test('送り仮名つきの漢字', () => {
  assert.deepEqual(shape('生れた', 'うまれた'), ['生:うま', 'れ:れ', 'た:た']);
});

test('片仮名はひらがなに正規化して対応する', () => {
  assert.deepEqual(shape('ニャーニャー', 'にゃーにゃー'), [
    'ニ:に', 'ャ:ゃ', 'ー:ー', 'ニ:に', 'ャ:ゃ', 'ー:ー',
  ]);
});

test('先頭の漢字（直前アンカーなし）', () => {
  assert.deepEqual(shape('猫が', 'ねこが'), ['猫:ねこ', 'が:が']);
});

test('末尾の漢字は残りを読みとする', () => {
  assert.deepEqual(shape('私は猫', 'わたしはねこ'), ['私:わたし', 'は:は', '猫:ねこ']);
});

test('対応付けできないときは null', () => {
  assert.equal(alignTextRuby('あい', 'かき'), null);
  assert.equal(alignTextRuby('あい', 'あ'), null);
});

test('tokensForParagraph は失敗時にフォールバックする', () => {
  const t = tokensForParagraph('あ猫が', 'いぬ');
  assert.equal(t.length, 3);
  assert.deepEqual(t.map((x) => x.text), ['あ', '猫', 'が']);
  assert.ok(t.every((x) => x.ruby === ''));
});

test('実データの先頭段落を対応付けできる', () => {
  const t = alignTextRuby(
    '吾輩は猫である。名前はまだ無い。',
    'わがはいはねこである。なまえはまだない。'
  );
  assert.ok(t);
  assert.equal(t.map((x) => x.text).join(''), '吾輩は猫である。名前はまだ無い。');
  assert.equal(t.map((x) => x.ruby).join(''), 'わがはいはねこである。なまえはまだない。');
});

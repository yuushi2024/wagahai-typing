// タイピングセッションの単体テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TypingSession } from '../../assets/js/engine.js';

const PARAS = [
  { text: 'あい', ruby: 'あい' },
  { text: 'うえ', ruby: 'うえ' },
];

// 決め打ちの時刻で経過時間を制御する
function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('段落を打ち終えると自動で次の段落へ進む', () => {
  const s = new TypingSession(PARAS);
  for (const ch of 'ai') s.input(ch);
  assert.equal(s.paragraphNumber, 2);
  assert.equal(s.finished, false);
});

test('最終段落を打ち終えると章クリアになる', () => {
  const s = new TypingSession(PARAS);
  for (const ch of 'aiue') s.input(ch);
  assert.equal(s.finished, true);
  const last = s.input('a');
  assert.equal(last.type, 'finished');
});

test('正解数・ミス数・正確率を集計する', () => {
  const s = new TypingSession([{ text: 'あい', ruby: 'あい' }]);
  s.input('x'); // ミス
  s.input('a');
  s.input('i');
  assert.equal(s.correct, 2);
  assert.equal(s.miss, 1);
  assert.ok(Math.abs(s.accuracy - (2 / 3) * 100) < 1e-9);
});

test('打鍵速度 KPM を計算する', () => {
  const clock = fakeClock();
  const s = new TypingSession([{ text: 'あい', ruby: 'あい' }], clock.now);
  s.input('a'); // t=0 で開始
  clock.advance(30000); // 30 秒かけて
  s.input('i'); // 打ち終える
  // 2 打鍵を 30 秒 -> 4 KPM
  assert.ok(Math.abs(s.kpm - 4) < 1e-6);
});

test('スキップで次の段落へ進める', () => {
  const s = new TypingSession(PARAS);
  s.skipParagraph();
  assert.equal(s.paragraphNumber, 2);
  s.skipParagraph();
  assert.equal(s.finished, true);
});

test('stats に進捗が含まれる', () => {
  const s = new TypingSession(PARAS);
  const st = s.stats;
  assert.equal(st.paragraphNumber, 1);
  assert.equal(st.paragraphCount, 2);
  assert.equal(st.correct, 0);
});

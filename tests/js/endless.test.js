// エンドレスモード（全章通し）の単体テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TypingSession, EndlessRun } from '../../assets/js/engine.js';
import { buildSegments, canonicalRomaji } from '../../assets/js/romaji.js';

// 章の構成（章番号は飛んでいてもよい）
const INDEX = { chapters: [{ chapter: 1 }, { chapter: 2 }, { chapter: 3 }] };

const CH1 = [
  { text: 'あい', ruby: 'あい' },
  { text: 'うえ', ruby: 'うえ' },
];
const CH2 = [{ text: 'かき', ruby: 'かき' }];
const CH3 = [{ text: 'さし', ruby: 'さし' }];
const PARAS = { 1: CH1, 2: CH2, 3: CH3 };

// 決め打ちの時刻で経過時間を制御する
function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

// 現在の段落を先頭候補のローマ字で打ち切る
function typeParagraph(session) {
  const segs = buildSegments(session.current.ruby);
  for (const seg of segs) {
    for (const ch of canonicalRomaji(seg)) {
      const r = session.input(ch);
      assert.notEqual(r.type, 'miss', `"${ch}" でミス（${session.current.ruby}）`);
    }
  }
}

// 章を最後まで打ち切る（最終段落で chapter-complete になる）
function clearChapter(session) {
  let guard = 0;
  while (!session.finished && guard++ < 200) typeParagraph(session);
  assert.equal(session.finished, true);
}

test('start で第1章のセッションを開始する', () => {
  const run = new EndlessRun(INDEX);
  const s = run.start(CH1);
  assert.ok(s instanceof TypingSession);
  assert.equal(run.chapter, 1);
  assert.equal(run.chapterPos, 0);
  assert.equal(run.chapterCount, 3);
  assert.equal(run.clearedChapters, 0);
  assert.equal(run.done, false);
});

test('nextChapterNumber は次の章番号、最終章では null を返す', () => {
  const run = new EndlessRun(INDEX);
  run.start(CH1);
  assert.equal(run.nextChapterNumber, 2);
  run.advance(CH2);
  assert.equal(run.nextChapterNumber, 3);
  run.advance(CH3);
  assert.equal(run.isLastChapter, true);
  assert.equal(run.nextChapterNumber, null);
});

test('章をクリアすると次の章のセッションが返り、通算スコアが引き継がれる', () => {
  const run = new EndlessRun(INDEX);
  const s1 = run.start(CH1);
  clearChapter(s1);
  const ch1Correct = s1.correct; // 「あい」「うえ」= 4 打鍵

  const s2 = run.advance(CH2);
  assert.ok(s2 instanceof TypingSession);
  assert.equal(run.chapter, 2);
  assert.equal(run.clearedChapters, 1);
  assert.equal(run.totalCorrect, ch1Correct);
  // 章が替わっても段落は先頭から
  assert.equal(s2.paragraphNumber, 1);
  // 通算スコアは前章分を含む
  assert.equal(run.totalStats.correct, ch1Correct);
});

test('エンドレス中の通算スコアは進行中の章も含めて集計する', () => {
  const run = new EndlessRun(INDEX);
  const s1 = run.start(CH1);
  clearChapter(s1);
  const afterCh1 = run.totalStats.correct;

  run.advance(CH2);
  // 第2章「かき」を 2 打鍵（k, a）だけ進める
  run.session.input('k');
  run.session.input('a');
  assert.equal(run.totalStats.correct, afterCh1 + 2);
});

test('通算スコアはミスも含めて正確率を計算する', () => {
  const run = new EndlessRun(INDEX);
  const s1 = run.start(CH1);
  s1.input('x'); // ミス
  clearChapter(s1);
  const ch1 = run.totalStats;
  assert.equal(ch1.miss, 1);

  run.advance(CH2);
  run.session.input('y'); // ミス（第2章）
  const total = run.totalStats;
  assert.equal(total.miss, 2);
  assert.ok(Math.abs(total.accuracy - (total.correct / (total.correct + 2)) * 100) < 1e-9);
});

test('最終章をクリアすると done になり次のセッションは null', () => {
  const run = new EndlessRun(INDEX);
  clearChapter(run.start(CH1));
  clearChapter(run.advance(CH2));
  clearChapter(run.advance(CH3));
  const next = run.advance();
  assert.equal(next, null);
  assert.equal(run.done, true);
  assert.equal(run.clearedChapters, 3);
  assert.equal(run.totalStats.clearedChapters, 3);
});

test('最終章クリア後の通算スコアは最終章分を二重に数えない', () => {
  const run = new EndlessRun(INDEX);
  const s1 = run.start(CH1);
  clearChapter(s1);
  const s2 = run.advance(CH2);
  clearChapter(s2);
  const s3 = run.advance(CH3);
  clearChapter(s3);

  // 確定前の通算値（進行中の第3章を含む）
  const before = run.totalStats.correct;
  run.advance(); // 第3章を確定
  const after = run.totalStats.correct;
  assert.equal(after, before);
  assert.equal(run.session, null);
});

test('エンドレスの経過時間は章をまたいでも継続する', () => {
  const clock = fakeClock();
  const run = new EndlessRun(INDEX, clock.now);
  run.start(CH1);
  clock.advance(5000);
  assert.equal(run.elapsedSeconds, 5);

  run.advance(CH2); // 新しいセッションでも走行中の合計時間は続く
  clock.advance(3000);
  assert.equal(run.elapsedSeconds, 8);
});

test('最終章クリア後は endedAt で時間が止まる', () => {
  const clock = fakeClock();
  const run = new EndlessRun({ chapters: [{ chapter: 1 }] }, clock.now);
  clearChapter(run.start(CH1));
  run.advance();
  clock.advance(9000);
  assert.equal(run.done, true);
  assert.ok(run.elapsedSeconds < 9);
});

test('start 前に advance を呼ぶとエラー', () => {
  const run = new EndlessRun(INDEX);
  assert.throws(() => run.advance(CH1), /start\(\)/);
});

test('通算の打鍵速度 KPM を計算する', () => {
  const clock = fakeClock();
  const run = new EndlessRun(INDEX, clock.now);
  const s = run.start(CH1);
  s.input('a'); // t=0 で開始
  clock.advance(60000); // 60 秒
  s.input('i');
  // 2 打鍵を 60 秒 -> 2 KPM
  assert.ok(Math.abs(run.totalStats.kpm - 2) < 1e-6);
});

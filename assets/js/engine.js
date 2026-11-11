// タイピングセッションの進行と成績を管理する（DOM 非依存）
import { buildSegments, RomajiMatcher } from './romaji.js';

// 通算成績の計算（章ごと・エンドレスの両方で共通）
function ratio(correct, miss) {
  const total = correct + miss;
  return total > 0 ? (correct / total) * 100 : 100;
}

function kpmOf(correct, seconds) {
  return seconds > 0 ? (correct / seconds) * 60 : 0;
}

export class TypingSession {
  // now: テスト用に時刻取得を差し替えられるようにする
  constructor(paragraphs, now = () => performance.now()) {
    this.paragraphs = paragraphs;
    this.now = now;
    this.index = 0;
    this.correct = 0;
    this.miss = 0;
    this.startTime = null;
    this.endTime = null;
    this.finished = false;
    this._startParagraph();
  }

  _startParagraph() {
    const p = this.paragraphs[this.index];
    this.segments = buildSegments(p.ruby);
    this.matcher = new RomajiMatcher(this.segments);
  }

  get current() {
    return this.paragraphs[this.index];
  }

  // 章内で次の段落がまだあるか
  get hasNextParagraph() {
    return this.index + 1 < this.paragraphs.length;
  }

  // 次に進む段落番号（最後の段落なら null）
  get nextParagraphNumber() {
    return this.hasNextParagraph ? this.index + 2 : null;
  }

  get paragraphNumber() {
    return this.index + 1;
  }

  get paragraphCount() {
    return this.paragraphs.length;
  }

  get elapsedSeconds() {
    if (this.startTime === null) return 0;
    const end = this.endTime ?? this.now();
    return (end - this.startTime) / 1000;
  }

  // 打鍵速度（1 分あたりの正解打鍵数）
  get kpm() {
    return kpmOf(this.correct, this.elapsedSeconds);
  }

  get accuracy() {
    return ratio(this.correct, this.miss);
  }

  get stats() {
    return {
      correct: this.correct,
      miss: this.miss,
      accuracy: this.accuracy,
      kpm: this.kpm,
      elapsedSeconds: this.elapsedSeconds,
      paragraphNumber: this.paragraphNumber,
      paragraphCount: this.paragraphCount,
    };
  }

  // 1 打鍵を処理し、結果の種別を返す
  input(ch) {
    if (this.finished) return { type: 'finished' };
    if (this.startTime === null) this.startTime = this.now();

    const r = this.matcher.input(ch);
    if (!r.ok) {
      this.miss += 1;
      return { type: 'miss' };
    }
    this.correct += 1;

    if (!this.matcher.complete) return { type: 'ok' };

    // 段落クリア
    if (!this.hasNextParagraph) {
      this.endTime = this.now();
      this.finished = true;
      return { type: 'chapter-complete' };
    }
    this.index += 1;
    this._startParagraph();
    return { type: 'paragraph-complete' };
  }

  // 現在の段落をスキップする（ミス扱いにはしない）
  skipParagraph() {
    if (this.finished) return { type: 'finished' };
    if (this.startTime === null) this.startTime = this.now();
    if (!this.hasNextParagraph) {
      this.endTime = this.now();
      this.finished = true;
      return { type: 'chapter-complete' };
    }
    this.index += 1;
    this._startParagraph();
    return { type: 'paragraph-complete' };
  }
}

// エンドレスモード（全章通し）の進行を管理する。
// 章の区切りでリザルトに止まらず、次の章を自動で読み込んで続ける。
export class EndlessRun {
  constructor(index, now = () => performance.now()) {
    this.index = index;
    this.now = now;
    this.chapters = index.chapters;
    this.chapterPos = 0;
    this.totalCorrect = 0;
    this.totalMiss = 0;
    this.totalParagraphs = 0;
    this.clearedChapters = 0;
    this.startedAt = null;
    this.endedAt = null;
    this.done = false;
    this.session = null;
  }

  get chapter() {
    return this.chapters[this.chapterPos].chapter;
  }

  get chapterCount() {
    return this.chapters.length;
  }

  get isLastChapter() {
    return this.chapterPos + 1 >= this.chapters.length;
  }

  // 次の章番号（最終章なら null）
  get nextChapterNumber() {
    return this.isLastChapter ? null : this.chapters[this.chapterPos + 1].chapter;
  }

  get elapsedSeconds() {
    if (this.startedAt === null) return 0;
    const end = this.endedAt ?? this.now();
    return (end - this.startedAt) / 1000;
  }

  // 全章を通した通算成績（進行中の章を含む）
  get totalStats() {
    const correct = this.totalCorrect + (this.session ? this.session.correct : 0);
    const miss = this.totalMiss + (this.session ? this.session.miss : 0);
    const sec = this.elapsedSeconds;
    return {
      correct,
      miss,
      accuracy: ratio(correct, miss),
      kpm: kpmOf(correct, sec),
      elapsedSeconds: sec,
      clearedChapters: this.clearedChapters,
      chapterCount: this.chapterCount,
    };
  }

  // 最初の章を開始する
  start(paragraphs) {
    if (this.startedAt === null) this.startedAt = this.now();
    this.session = new TypingSession(paragraphs, this.now);
    return this.session;
  }

  // 章クリア時に確定した集計値を取り込み、次の章へ進む。
  // 最終章のときは次章がないため paragraphs は不要（null でよい）。
  advance(paragraphs = null) {
    if (!this.session) throw new Error('start() を先に呼んでください');
    this.totalCorrect += this.session.correct;
    this.totalMiss += this.session.miss;
    this.totalParagraphs += this.session.paragraphCount;
    this.clearedChapters += 1;

    if (this.isLastChapter) {
      this.done = true;
      this.endedAt = this.now();
      // 最終章は確定値を取り込んだら session を外す。
      // 残したままだと totalStats が最終章分を二重に数えてしまう。
      this.session = null;
      return null;
    }
    this.chapterPos += 1;
    this.session = new TypingSession(paragraphs, this.now);
    return this.session;
  }
}

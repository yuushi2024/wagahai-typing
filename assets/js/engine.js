// タイピングセッションの進行と成績を管理する（DOM 非依存）
import { buildSegments, RomajiMatcher } from './romaji.js';

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
    const sec = this.elapsedSeconds;
    return sec > 0 ? (this.correct / sec) * 60 : 0;
  }

  get accuracy() {
    const total = this.correct + this.miss;
    return total > 0 ? (this.correct / total) * 100 : 100;
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
    if (this.index + 1 >= this.paragraphs.length) {
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
    if (this.index + 1 >= this.paragraphs.length) {
      this.endTime = this.now();
      this.finished = true;
      return { type: 'chapter-complete' };
    }
    this.index += 1;
    this._startParagraph();
    return { type: 'paragraph-complete' };
  }
}

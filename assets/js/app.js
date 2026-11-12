// 画面の制御（章選択 → プレイ → リザルト）
import { TypingSession, EndlessRun } from './engine.js';
import { tokensForParagraph } from './align.js';
import { canonicalRomaji, buildSegments } from './romaji.js';
import { SoundFX } from './sound.js';

const $ = (id) => document.getElementById(id);

const KANJI_CHAPTERS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一'];

const state = {
  index: null,
  chapter: null,
  chapterData: null,
  session: null,
  tokens: [],
  sentences: [],
  currentSentenceIdx: -1,
  errorTimer: null,
  mode: 'normal', // 'normal' | 'endless'
  run: null, // エンドレスモードの通算管理
  sound: new SoundFX(),
};

// 章データの取得
async function fetchChapterData(chapterNo) {
  const res = await fetch(`data/chapters/chapter${String(chapterNo).padStart(2, '0')}.json`);
  if (!res.ok) throw new Error(`章データの取得に失敗 (${res.status})`);
  return res.json();
}

// ---------- 章選択 ----------
async function loadIndex() {
  const res = await fetch('data/chapters/index.json');
  if (!res.ok) throw new Error(`index.json の取得に失敗 (${res.status})`);
  return res.json();
}

function renderChapters(index) {
  $('select-note').textContent =
    `全${index.chapter_count}章 ・ 全${index.paragraph_count.toLocaleString()}段落。お好みの章を選んでください。`;
  const grid = $('chapter-grid');
  grid.innerHTML = '';
  for (const ch of index.chapters) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'chapter-card';
    const kn = KANJI_CHAPTERS[ch.chapter] || String(ch.chapter);
    const pct = Math.min(100, Math.round((ch.paragraph_count / index.paragraph_count) * 100 * 2));
    card.innerHTML = `
      <span class="cc-spine" aria-hidden="true"></span>
      <div class="cc-body">
        <div class="cc-header">
          <span class="cc-no">巻の${kn}</span>
          <span class="cc-cat-icon">🐾</span>
        </div>
        <span class="cc-title">第${kn}章</span>
        <span class="cc-meta">📖 全 ${ch.paragraph_count} 段落</span>
        <span class="cc-bar"><i style="width:${pct}%"></i></span>
      </div>`;
    card.addEventListener('click', () => startChapter(index, ch.chapter));
    grid.appendChild(card);
  }
}

// 通常モード: 選ばれた章だけを読み込んで開始
async function startChapter(index, chapterNo) {
  state.chapterData = await fetchChapterData(chapterNo);
  state.chapter = chapterNo;
  state.index = index;
  state.run = null;
  beginSession();
}

// エンドレスモード: 第1章から全章通しで開始
async function startEndless(index) {
  state.index = index;
  state.run = new EndlessRun(index);
  await enterRunChapter(index.chapters[0].chapter);
}

// エンドレスの現在章を読み込んでセッションを開始する
async function enterRunChapter(chapterNo) {
  const data = await fetchChapterData(chapterNo);
  state.chapter = chapterNo;
  state.chapterData = data;
  state.session = state.run.start(data.paragraphs);
  show('view-game');
  updateModeUI();
  loadParagraph();
  updateStats();
}

// エンドレスで次の章へ（章クリア後）
async function advanceRunChapter(chapterNo) {
  const data = await fetchChapterData(chapterNo);
  state.chapter = chapterNo;
  state.chapterData = data;
  state.session = state.run.advance(data.paragraphs);
  loadParagraph();
  updateStats();
}

function beginSession() {
  state.session = new TypingSession(state.chapterData.paragraphs);
  show('view-game');
  updateModeUI();
  loadParagraph();
  updateStats();
}

// モードに応じてヘッダーのバッジ表示を切り替える
function updateModeUI() {
  $('game-mode-badge').hidden = state.mode !== 'endless';
}

// ---------- 文分割ロジック ----------
function splitTokensIntoSentences(tokens) {
  const sentences = [];
  let cur = [];
  let rStart = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    cur.push({ tok, tokenIndex: i });
    // 句点・感嘆符・疑問符・改行で文を区切る
    const isEnd = /[。！？\n]/.test(tok.text) || tok.text.endsWith('。') || tok.text.endsWith('！') || tok.text.endsWith('？');
    if (isEnd) {
      const rEnd = tok.rEnd;
      sentences.push({
        items: cur,
        rStart,
        rEnd,
        text: cur.map((c) => c.tok.text).join(''),
        ruby: cur.map((c) => c.tok.ruby).join(''),
      });
      rStart = rEnd;
      cur = [];
    }
  }
  if (cur.length > 0) {
    const rEnd = cur[cur.length - 1].tok.rEnd;
    sentences.push({
      items: cur,
      rStart,
      rEnd,
      text: cur.map((c) => c.tok.text).join(''),
      ruby: cur.map((c) => c.tok.ruby).join(''),
    });
  }
  return sentences;
}

function getCurrentSentenceIndex() {
  if (!state.sentences || state.sentences.length === 0) return 0;
  const doneRuby = state.session.matcher.doneRuby;
  for (let i = 0; i < state.sentences.length; i++) {
    if (doneRuby < state.sentences[i].rEnd) return i;
  }
  return Math.max(0, state.sentences.length - 1);
}

// ---------- プレイ ----------
function loadParagraph() {
  const p = state.session.current;
  state.tokens = tokensForParagraph(p.text, p.ruby);
  state.sentences = splitTokensIntoSentences(state.tokens);
  state.currentSentenceIdx = -1;

  const label = $('game-chapter-label');
  const kn = KANJI_CHAPTERS[state.chapter] || String(state.chapter);
  label.textContent = `第${kn}章`;
  if (state.mode === 'endless' && state.run) {
    label.textContent += `（${state.run.chapterPos + 1}/${state.run.chapterCount}）`;
  }

  renderSentence();
  renderGuide();
}

function renderSentence() {
  const curIdx = getCurrentSentenceIndex();
  // 文を打ち終えて次の文へ進んだときは澄んだ鈴音を鳴らす
  if (curIdx > state.currentSentenceIdx && state.currentSentenceIdx >= 0) {
    state.sound.playParagraph();
  }
  state.currentSentenceIdx = curIdx;

  const s = state.sentences[curIdx];
  if (!s) return;

  const doneRuby = state.session.matcher.doneRuby;

  // バッジ & プログレス更新
  $('sentence-badge').textContent = `文 ${curIdx + 1} / ${state.sentences.length}`;
  $('game-progress').textContent =
    `段落 ${state.session.paragraphNumber} / ${state.session.paragraphCount} ・ 文 ${curIdx + 1} / ${state.sentences.length}`;

  const line = $('sentence-line');
  line.innerHTML = '';

  let markedCurrent = false;
  s.items.forEach(({ tok, tokenIndex }) => {
    const span = document.createElement('span');
    span.className = 'tok';
    span.dataset.i = String(tokenIndex);

    if (tok.ruby) {
      const ruby = document.createElement('ruby');
      const base = document.createElement('span');
      base.className = 'base';
      base.textContent = tok.text;
      const rt = document.createElement('rt');
      rt.textContent = tok.ruby;
      ruby.appendChild(base);
      ruby.appendChild(rt);
      span.appendChild(ruby);
    } else {
      const base = document.createElement('span');
      base.className = 'base';
      base.textContent = tok.text;
      span.appendChild(base);
    }

    if (tok.ruby.length > 0) {
      if (tok.rEnd <= doneRuby) {
        span.classList.add('done');
      } else if (tok.rStart <= doneRuby && !markedCurrent) {
        span.classList.add('current');
        markedCurrent = true;
      }
    }
    line.appendChild(span);
  });

  // 次の文プレビュー
  const np = $('next-preview');
  const npText = $('np-text');
  if (curIdx + 1 < state.sentences.length) {
    np.classList.remove('is-hidden');
    np.style.display = 'flex';
    npText.textContent = state.sentences[curIdx + 1].text;
  } else if (state.session.hasNextParagraph) {
    np.classList.remove('is-hidden');
    np.style.display = 'flex';
    npText.textContent = '（次の段落へ続きます）';
  } else {
    np.classList.add('is-hidden');
    np.style.display = 'none';
  }
}

function renderGuide() {
  const cur = state.session.matcher.current();
  if (!cur) {
    $('guide-kana').textContent = '了';
    $('guide-romaji').textContent = '';
  } else {
    $('guide-kana').textContent = cur.kana;
    $('guide-romaji').innerHTML =
      `<span class="typed">${escapeHtml(cur.typed)}</span><span class="rest">${escapeHtml(cur.option.slice(cur.typed.length))}</span>`;
  }

  // 現在の文に対応するローマ字ガイドを表示
  const curIdx = state.currentSentenceIdx >= 0 ? state.currentSentenceIdx : getCurrentSentenceIndex();
  const s = state.sentences[curIdx];
  if (!s) return;

  const segs = state.session.segments;
  let rubyPos = 0;
  const sentenceSegs = [];

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const segRubyLen = seg.kana.length;
    const segRubyEnd = rubyPos + segRubyLen;

    if (segRubyEnd > s.rStart && rubyPos < s.rEnd) {
      sentenceSegs.push({ seg, idx: i });
    }
    rubyPos = segRubyEnd;
  }

  const parts = [];
  sentenceSegs.forEach(({ seg, idx }) => {
    const r = escapeHtml(canonicalRomaji(seg));
    if (idx < state.session.matcher.done) {
      parts.push(`<b>${r}</b>`);
    } else if (idx === state.session.matcher.done) {
      parts.push(`<span class="cur">${r}</span>`);
    } else {
      parts.push(r);
    }
  });

  $('guide-line').innerHTML = parts.join(' ');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updateStats() {
  const st = state.mode === 'endless' && state.run
    ? state.run.totalStats
    : state.session.stats;
  $('stat-correct').textContent = st.correct;
  $('stat-miss').textContent = st.miss;
  $('stat-acc').textContent = `${st.accuracy.toFixed(1)}%`;
  $('stat-kpm').innerHTML = `${st.kpm.toFixed(0)} <small>KPM</small>`;
}

// 画面下部のトースト通知
let toastTimer = null;
function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('is-hidden');
  void el.offsetWidth;
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-show');
    el.classList.add('is-hidden');
  }, 2000);
}

// 間違えたときのアニメーション（メインの打鍵盤全体を揺らす）
function flashError() {
  const board = $('typing-board');
  if (!board) return;
  board.classList.remove('is-error');
  void board.offsetWidth;
  board.classList.add('is-error');
  clearTimeout(state.errorTimer);
  state.errorTimer = setTimeout(() => board.classList.remove('is-error'), 220);
}

function handleKey(e) {
  if (!state.session || state.session.finished) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') { showSelect(); return; }
  if (e.key.length !== 1) return;
  e.preventDefault();

  const r = state.session.input(e.key);
  if (r.type === 'miss') {
    state.sound.playMiss();
    flashError();
    updateStats();
    return;
  }

  state.sound.playKey();
  updateStats();

  if (r.type === 'paragraph-complete') {
    state.sound.playParagraph();
    loadParagraph();
  } else if (r.type === 'chapter-complete') {
    state.sound.playChapter();
    handleChapterComplete();
    return;
  }
  renderSentence();
  renderGuide();
}

function skipSentenceOrParagraph() {
  if (!state.session || state.session.finished) return;
  const curIdx = getCurrentSentenceIndex();
  const s = state.sentences[curIdx];

  // 文をスキップする（この文の読みの末尾まで matcher を進める）
  while (state.session.matcher.doneRuby < s.rEnd && !state.session.matcher.complete) {
    const cur = state.session.matcher.current();
    if (!cur) break;
    const nextChar = cur.option[cur.typed.length] || 'a';
    state.session.input(nextChar);
  }

  updateStats();
  if (state.session.matcher.complete) {
    if (state.session.hasNextParagraph) {
      state.sound.playParagraph();
      loadParagraph();
    } else {
      state.sound.playChapter();
      handleChapterComplete();
      return;
    }
  } else {
    renderSentence();
    renderGuide();
  }
}

// 章の最終段落を打ち終えたときの処理
async function handleChapterComplete() {
  if (state.mode === 'endless' && state.run) {
    const cleared = state.chapter;
    const next = state.run.nextChapterNumber;
    if (next === null) {
      state.run.advance();
      showResult();
      return;
    }
    const nextKn = KANJI_CHAPTERS[next] || String(next);
    showToast(`🐾 第${KANJI_CHAPTERS[cleared]}章 読了！ → 第${nextKn}章へ進みます`);
    try {
      await advanceRunChapter(next);
    } catch (err) {
      showResult();
    }
    return;
  }
  showResult();
}

// ---------- リザルト ----------
function showResult() {
  const isEndless = state.mode === 'endless' && state.run;
  const st = isEndless ? state.run.totalStats : state.session.stats;
  const lastChapter = state.index.chapters[state.index.chapters.length - 1].chapter;
  const kn = KANJI_CHAPTERS[state.chapter] || String(state.chapter);
  const praise = $('result-praise');

  if (isEndless) {
    const completed = st.clearedChapters >= state.run.chapterCount;
    $('result-kicker').textContent = completed ? '全巻完読！' : '章走破！';
    $('result-title').textContent = completed
      ? `全${state.run.chapterCount}章走破！完全読了！`
      : `第${kn}章 走破`;
    if (praise) {
      praise.textContent = completed
        ? '「全巻走破、実に見事であった！吾輩も感服の至りである。」'
        : '「次の章へそのまま進め！歩みを止めることなかれ。」';
    }
    $('result-paras').textContent =
      `${st.clearedChapters} / ${state.run.chapterCount} 章 ・ ${state.run.totalParagraphs} 段落`;
    $('btn-next').hidden = true;
    $('btn-retry').textContent = completed ? 'もう一度（第一章から）' : '第一章からやり直す';
    $('btn-retry').dataset.action = 'endless-restart';
  } else {
    $('result-kicker').textContent = '読了之証';
    $('result-title').textContent = `第${kn}章 読了`;
    if (praise) {
      praise.textContent = '「見事なる打鍵にて、此の一章を読了せり。」';
    }
    $('result-paras').textContent = `全 ${st.paragraphCount} 段落`;
    $('btn-next').hidden = false;
    $('btn-retry').textContent = 'もう一度打つ';
    $('btn-retry').dataset.action = 'retry';
    const hasNext = state.chapter < lastChapter;
    $('btn-next').disabled = !hasNext;
    const nextKn = KANJI_CHAPTERS[state.chapter + 1] || String(state.chapter + 1);
    $('btn-next').textContent = hasNext ? `第${nextKn}章へ進む 📖` : '全巻読了です 🐾';
  }

  $('result-correct').textContent = st.correct;
  $('result-miss').textContent = st.miss;
  $('result-acc').textContent = `${st.accuracy.toFixed(1)}%`;
  $('result-kpm').textContent = `${st.kpm.toFixed(0)} KPM`;
  $('result-time').textContent = `${st.elapsedSeconds.toFixed(1)}秒`;
  show('view-result');
}

// ---------- 画面切替 ----------
function show(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.add('is-hidden');
  $(id).classList.remove('is-hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showSelect() {
  const el = $('toast');
  el.classList.remove('is-show');
  el.classList.add('is-hidden');
  clearTimeout(toastTimer);
  show('view-select');
}

// ---------- モード切替 ----------
function setMode(mode) {
  state.mode = mode;
  const endless = mode === 'endless';
  $('mode-normal').classList.toggle('is-active', !endless);
  $('mode-endless').classList.toggle('is-active', endless);
  $('mode-normal').setAttribute('aria-pressed', String(!endless));
  $('mode-endless').setAttribute('aria-pressed', String(endless));
  $('chapter-grid').classList.toggle('is-hidden', endless);
  $('endless-panel').classList.toggle('is-hidden', !endless);
  $('select-note').hidden = endless;
}

// ---------- ユーティリティ制御（テーマ・効果音） ----------
function initTheme() {
  const btn = $('btn-theme-toggle');
  if (!btn) return;
  const updateUI = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    $('theme-icon').textContent = isDark ? '📖' : '🕯️';
    $('theme-label').textContent = isDark ? '文庫（昼）' : '書斎（夜）';
  };
  updateUI();
  btn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem('wagahai_theme', 'light'); } catch (_) {}
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      try { localStorage.setItem('wagahai_theme', 'dark'); } catch (_) {}
    }
    updateUI();
  });
}

function initSound() {
  const btn = $('btn-sound-toggle');
  if (!btn) return;
  const updateUI = () => {
    $('sound-icon').textContent = state.sound.enabled ? '🔊' : '🔇';
    $('sound-label').textContent = state.sound.enabled ? '音: 入' : '音: 切';
  };
  updateUI();
  btn.addEventListener('click', () => {
    state.sound.toggle();
    updateUI();
  });
}

// ---------- 初期化 ----------
async function init() {
  initTheme();
  initSound();

  $('btn-back').addEventListener('click', showSelect);
  $('btn-skip').addEventListener('click', skipSentenceOrParagraph);
  $('btn-menu').addEventListener('click', showSelect);
  $('btn-retry').addEventListener('click', () => {
    if ($('btn-retry').dataset.action === 'endless-restart') {
      startEndless(state.index);
    } else {
      show('view-game');
      beginSession();
    }
  });
  $('btn-next').addEventListener('click', () => {
    const idx = state.index.chapters.findIndex((c) => c.chapter === state.chapter);
    if (idx >= 0 && idx + 1 < state.index.chapters.length) {
      startChapter(state.index, state.index.chapters[idx + 1].chapter);
    }
  });
  $('mode-normal').addEventListener('click', () => setMode('normal'));
  $('mode-endless').addEventListener('click', () => setMode('endless'));
  $('btn-endless-start').addEventListener('click', () => startEndless(state.index));
  window.addEventListener('keydown', handleKey);
  $('typing-board').addEventListener('click', () => $('typing-board').focus());

  try {
    const index = await loadIndex();
    state.index = index;
    renderChapters(index);
    setMode('normal');
  } catch (err) {
    $('select-note').textContent =
      `目録を読み込めませんでした：${err.message}。ローカルサーバーで開いてください。`;
  }
}

init();

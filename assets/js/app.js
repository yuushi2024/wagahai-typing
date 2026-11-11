// 画面の制御（章選択 → プレイ → リザルト）
import { TypingSession, EndlessRun } from './engine.js';
import { tokensForParagraph } from './align.js';
import { canonicalRomaji } from './romaji.js';

const $ = (id) => document.getElementById(id);

const state = {
  index: null,
  chapter: null,
  chapterData: null,
  session: null,
  tokens: [],
  errorTimer: null,
  mode: 'normal', // 'normal' | 'endless'
  run: null, // エンドレスモードの通算管理
};

// 章データの取得（存在する章はすべて取得できる）
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
    `全${index.chapter_count}章 ・ 全${index.paragraph_count.toLocaleString()}段落。章を選んでください。`;
  const grid = $('chapter-grid');
  grid.innerHTML = '';
  for (const ch of index.chapters) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'chapter-card';
    card.innerHTML = `
      <span class="cc-no">CHAPTER ${String(ch.chapter).padStart(2, '0')}</span>
      <span class="cc-title">第${ch.chapter}章</span>
      <span class="cc-meta">${ch.paragraph_count} 段落</span>
      <span class="cc-bar"><i style="width:${Math.min(100, (ch.paragraph_count / index.paragraph_count) * 100 * 2)}%"></i></span>`;
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

// ---------- プレイ ----------
function loadParagraph() {
  const p = state.session.current;
  state.tokens = tokensForParagraph(p.text, p.ruby);
  const label = $('game-chapter-label');
  label.textContent = `第${state.chapter}章`;
  if (state.mode === 'endless' && state.run) {
    label.textContent += `（${state.run.chapterPos + 1}/${state.run.chapterCount}）`;
  }
  renderText();
  renderGuide();
}

function renderText() {
  const line = $('text-line');
  line.innerHTML = '';
  state.tokens.forEach((tok, i) => {
    const span = document.createElement('span');
    span.className = 'tok';
    span.dataset.i = String(i);
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
    line.appendChild(span);
  });
  refreshHighlight();
}

function refreshHighlight() {
  const doneRuby = state.session.matcher.doneRuby;
  let pos = 0;
  let markedCurrent = false;
  for (const span of $('text-line').children) {
    const i = Number(span.dataset.i);
    const tok = state.tokens[i];
    const start = pos;
    const end = pos + tok.ruby.length;
    pos = end;
    span.classList.remove('done', 'current');
    if (tok.ruby.length === 0) continue;
    if (end <= doneRuby) {
      span.classList.add('done');
    } else if (start <= doneRuby && !markedCurrent) {
      span.classList.add('current');
      markedCurrent = true;
    }
  }
}

function renderGuide() {
  const cur = state.session.matcher.current();
  if (!cur) {
    $('guide-kana').textContent = '完了';
    $('guide-romaji').textContent = '';
  } else {
    $('guide-kana').textContent = cur.kana;
    $('guide-romaji').innerHTML =
      `<span class="typed">${escapeHtml(cur.typed)}</span><span class="rest">${escapeHtml(cur.option.slice(cur.typed.length))}</span>`;
  }
  // この段落のローマ字ガイド（現在位置の前後だけを表示）
  const done = state.session.matcher.done;
  const segs = state.session.segments;
  const from = Math.max(0, done - 3);
  const to = Math.min(segs.length, done + 12);
  const parts = [];
  if (from > 0) parts.push('…');
  for (let i = from; i < to; i += 1) {
    const r = escapeHtml(canonicalRomaji(segs[i]));
    if (i < done) parts.push(`<b>${r}</b>`);
    else if (i === done) parts.push(`<span class="cur">${r}</span>`);
    else parts.push(r);
  }
  if (to < segs.length) parts.push('…');
  $('guide-line').innerHTML = parts.join(' ');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updateStats() {
  // エンドレス中は全章通算のスコアを表示する
  const st = state.mode === 'endless' && state.run
    ? state.run.totalStats
    : state.session.stats;
  $('stat-correct').textContent = st.correct;
  $('stat-miss').textContent = st.miss;
  $('stat-acc').textContent = `${st.accuracy.toFixed(1)}%`;
  $('stat-kpm').innerHTML = `${st.kpm.toFixed(0)} <small>KPM</small>`;
  $('game-progress').textContent = `${state.session.paragraphNumber} / ${state.session.paragraphCount} 段落`;
}

// 画面下部のトースト通知（章の自動進行などに使う）
let toastTimer = null;
function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('is-hidden');
  void el.offsetWidth; // 連続表示でもアニメーションを再生し直す
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-show');
    el.classList.add('is-hidden');
  }, 1800);
}

function flashError() {
  const panel = $('text-panel');
  panel.classList.remove('is-error');
  // 連続ミスでもアニメーションを再生し直す
  void panel.offsetWidth;
  panel.classList.add('is-error');
  clearTimeout(state.errorTimer);
  state.errorTimer = setTimeout(() => panel.classList.remove('is-error'), 220);
}

function handleKey(e) {
  if (state.session.finished) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') { showSelect(); return; }
  if (e.key.length !== 1) return; // 修飾キー・特殊キーは無視
  e.preventDefault();

  const r = state.session.input(e.key);
  if (r.type === 'miss') {
    flashError();
    updateStats();
    return;
  }
  updateStats();
  if (r.type === 'paragraph-complete') {
    loadParagraph();
  } else if (r.type === 'chapter-complete') {
    handleChapterComplete();
    return;
  }
  refreshHighlight();
  renderGuide();
}

function skipParagraph() {
  if (state.session.finished) return;
  const r = state.session.skipParagraph();
  updateStats();
  if (r.type === 'chapter-complete') { handleChapterComplete(); return; }
  loadParagraph();
}

// 章の最終段落を打ち終えたときの処理（モードで分岐）
async function handleChapterComplete() {
  if (state.mode === 'endless' && state.run) {
    const cleared = state.chapter;
    const next = state.run.nextChapterNumber;
    if (next === null) {
      // 最終章まで走破 → 完全クリア
      state.run.advance();
      showResult();
      return;
    }
    showToast(`第${cleared}章 クリア！ → 第${next}章へ`);
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

  if (isEndless) {
    const completed = st.clearedChapters >= state.run.chapterCount;
    $('result-kicker').textContent = completed ? '完全クリア！' : '章クリア！';
    $('result-title').textContent = completed
      ? `全${state.run.chapterCount}章走破！完全クリア！`
      : `第${state.chapter}章クリア`;
    $('result-paras').textContent =
      `${st.clearedChapters} / ${state.run.chapterCount} 章 ・ ${state.run.totalParagraphs} 段落`;
    $('btn-next').hidden = true;
    $('btn-retry').textContent = completed ? 'もう一度（第1章から）' : '第1章からやり直す';
    $('btn-retry').dataset.action = 'endless-restart';
  } else {
    $('result-kicker').textContent = '章クリア！';
    $('result-title').textContent = `第${state.chapter}章`;
    $('result-paras').textContent = `${st.paragraphCount} 段落`;
    $('btn-next').hidden = false;
    $('btn-retry').textContent = 'もう一度';
    $('btn-retry').dataset.action = 'retry';
    const hasNext = state.chapter < lastChapter;
    $('btn-next').disabled = !hasNext;
    $('btn-next').textContent = hasNext ? `第${state.chapter + 1}章へ` : '最終章です';
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
}

function showSelect() {
  // 章選択に戻るときはトーストも消す
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

// ---------- 初期化 ----------
async function init() {
  $('btn-back').addEventListener('click', showSelect);
  $('btn-skip').addEventListener('click', skipParagraph);
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
  $('text-panel').addEventListener('click', () => $('text-panel').focus());

  try {
    const index = await loadIndex();
    state.index = index;
    renderChapters(index);
    setMode('normal');
  } catch (err) {
    $('select-note').textContent =
      `データを読み込めませんでした：${err.message}。ローカルサーバー（例: python3 -m http.server）で開いてください。`;
  }
}

init();

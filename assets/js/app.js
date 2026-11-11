// 画面の制御（章選択 → プレイ → リザルト）
import { TypingSession } from './engine.js';
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
};

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

async function startChapter(index, chapterNo) {
  // 選ばれた章の JSON だけを読み込む（段階的ロード）
  const res = await fetch(`data/chapters/chapter${String(chapterNo).padStart(2, '0')}.json`);
  if (!res.ok) throw new Error(`章データの取得に失敗 (${res.status})`);
  state.chapterData = await res.json();
  state.chapter = chapterNo;
  state.index = index;
  beginSession();
}

function beginSession() {
  state.session = new TypingSession(state.chapterData.paragraphs);
  show('view-game');
  loadParagraph();
  updateStats();
}

// ---------- プレイ ----------
function loadParagraph() {
  const p = state.session.current;
  state.tokens = tokensForParagraph(p.text, p.ruby);
  $('game-chapter-label').textContent = `第${state.chapter}章`;
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
  const st = state.session.stats;
  $('stat-correct').textContent = st.correct;
  $('stat-miss').textContent = st.miss;
  $('stat-acc').textContent = `${st.accuracy.toFixed(1)}%`;
  $('stat-kpm').innerHTML = `${st.kpm.toFixed(0)} <small>KPM</small>`;
  $('game-progress').textContent = `${st.paragraphNumber} / ${st.paragraphCount} 段落`;
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
    showResult();
    return;
  }
  refreshHighlight();
  renderGuide();
}

function skipParagraph() {
  if (state.session.finished) return;
  const r = state.session.skipParagraph();
  updateStats();
  if (r.type === 'chapter-complete') { showResult(); return; }
  loadParagraph();
}

// ---------- リザルト ----------
function showResult() {
  const st = state.session.stats;
  $('result-title').textContent = `第${state.chapter}章`;
  $('result-correct').textContent = st.correct;
  $('result-miss').textContent = st.miss;
  $('result-acc').textContent = `${st.accuracy.toFixed(1)}%`;
  $('result-kpm').textContent = `${st.kpm.toFixed(0)} KPM`;
  $('result-time').textContent = `${st.elapsedSeconds.toFixed(1)}秒`;
  $('result-paras').textContent = `${st.paragraphCount} 段落`;
  const idx = state.index.chapters.findIndex((c) => c.chapter === state.chapter);
  const hasNext = idx >= 0 && idx + 1 < state.index.chapters.length;
  $('btn-next').disabled = !hasNext;
  $('btn-next').textContent = hasNext ? `第${state.chapter + 1}章へ` : '最終章です';
  show('view-result');
}

// ---------- 画面切替 ----------
function show(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.add('is-hidden');
  $(id).classList.remove('is-hidden');
}

function showSelect() {
  show('view-select');
}

// ---------- 初期化 ----------
async function init() {
  $('btn-back').addEventListener('click', showSelect);
  $('btn-skip').addEventListener('click', skipParagraph);
  $('btn-menu').addEventListener('click', showSelect);
  $('btn-retry').addEventListener('click', () => { show('view-game'); beginSession(); });
  $('btn-next').addEventListener('click', () => {
    const idx = state.index.chapters.findIndex((c) => c.chapter === state.chapter);
    if (idx >= 0 && idx + 1 < state.index.chapters.length) {
      startChapter(state.index, state.index.chapters[idx + 1].chapter);
    }
  });
  window.addEventListener('keydown', handleKey);
  $('text-panel').addEventListener('click', () => $('text-panel').focus());

  try {
    const index = await loadIndex();
    state.index = index;
    renderChapters(index);
  } catch (err) {
    $('select-note').textContent =
      `データを読み込めませんでした：${err.message}。ローカルサーバー（例: python3 -m http.server）で開いてください。`;
  }
}

init();

// ローマ字入力エンジン
// ひらがな（ルビ）に対して、一般的な日本語ローマ字入力のあらゆるバリエーションを
// 受け付けるオートマトンを提供する。
//
// 例: し = si / shi / ci 、ち = ti / chi 、つ = tu / tsu 、ふ = hu / fu など。
// ん・促音（っ）は文脈依存のため、前後のかなを見て受理パターンを動的に決める。

// 1 文字かな -> ローマ字候補
const SINGLE = {
  'あ': ['a'], 'い': ['i'], 'う': ['u'], 'え': ['e'], 'お': ['o'],
  'か': ['ka'], 'き': ['ki'], 'く': ['ku'], 'け': ['ke'], 'こ': ['ko'],
  'が': ['ga'], 'ぎ': ['gi'], 'ぐ': ['gu'], 'げ': ['ge'], 'ご': ['go'],
  'さ': ['sa'], 'し': ['si', 'shi', 'ci'], 'す': ['su'], 'せ': ['se'], 'そ': ['so'],
  'ざ': ['za'], 'じ': ['zi', 'ji'], 'ず': ['zu'], 'ぜ': ['ze'], 'ぞ': ['zo'],
  'た': ['ta'], 'ち': ['ti', 'chi'], 'つ': ['tu', 'tsu'], 'て': ['te'], 'と': ['to'],
  'だ': ['da'], 'ぢ': ['di', 'ji'], 'づ': ['du', 'zu'], 'で': ['de'], 'ど': ['do'],
  'な': ['na'], 'に': ['ni'], 'ぬ': ['nu'], 'ね': ['ne'], 'の': ['no'],
  'は': ['ha'], 'ひ': ['hi'], 'ふ': ['hu', 'fu'], 'へ': ['he'], 'ほ': ['ho'],
  'ば': ['ba'], 'び': ['bi'], 'ぶ': ['bu'], 'べ': ['be'], 'ぼ': ['bo'],
  'ぱ': ['pa'], 'ぴ': ['pi'], 'ぷ': ['pu'], 'ぺ': ['pe'], 'ぽ': ['po'],
  'ま': ['ma'], 'み': ['mi'], 'む': ['mu'], 'め': ['me'], 'も': ['mo'],
  'や': ['ya'], 'ゆ': ['yu'], 'よ': ['yo'],
  'ら': ['ra'], 'り': ['ri'], 'る': ['ru'], 'れ': ['re'], 'ろ': ['ro'],
  'わ': ['wa'], 'を': ['wo', 'o'], 'ゔ': ['vu'],
  'ぁ': ['xa', 'la'], 'ぃ': ['xi', 'li'], 'ぅ': ['xu', 'lu'], 'ぇ': ['xe', 'le'], 'ぉ': ['xo', 'lo'],
  'ゃ': ['xya', 'lya', 'ya'], 'ゅ': ['xyu', 'lyu', 'yu'], 'ょ': ['xyo', 'lyo', 'yo'],
  'ゕ': ['xka', 'lka', 'ka'], 'ゖ': ['xke', 'lke', 'ke'],
  'ー': ['-'],
};

// 2 文字かな（拗音など）-> ローマ字候補
const DIGRAPH = {
  'きゃ': ['kya'], 'きゅ': ['kyu'], 'きょ': ['kyo'],
  'ぎゃ': ['gya'], 'ぎゅ': ['gyu'], 'ぎょ': ['gyo'],
  'しゃ': ['sya', 'sha'], 'しゅ': ['syu', 'shu'], 'しょ': ['syo', 'sho'],
  'じゃ': ['zya', 'ja', 'jya'], 'じゅ': ['zyu', 'ju', 'jyu'],
  'じょ': ['zyo', 'jo', 'jyo'], 'じぇ': ['zye', 'je', 'jye'],
  'ちゃ': ['tya', 'cha', 'cya'], 'ちゅ': ['tyu', 'chu', 'cyu'],
  'ちょ': ['tyo', 'cho', 'cyo'], 'ちぇ': ['tye', 'che', 'cye'],
  'にゃ': ['nya'], 'にゅ': ['nyu'], 'にょ': ['nyo'],
  'ひゃ': ['hya'], 'ひゅ': ['hyu'], 'ひょ': ['hyo'],
  'びゃ': ['bya'], 'びゅ': ['byu'], 'びょ': ['byo'],
  'ぴゃ': ['pya'], 'ぴゅ': ['pyu'], 'ぴょ': ['pyo'],
  'みゃ': ['mya'], 'みゅ': ['myu'], 'みょ': ['myo'],
  'りゃ': ['rya'], 'りゅ': ['ryu'], 'りょ': ['ryo'],
  'ふぁ': ['fa', 'fua'], 'ふぃ': ['fi', 'fui'], 'ふぇ': ['fe', 'fue'], 'ふぉ': ['fo', 'fuo'],
  'ゔぁ': ['va', 'vua'], 'ゔぃ': ['vi', 'vui'], 'ゔぇ': ['ve', 'vue'], 'ゔぉ': ['vo', 'vuo'],
  'うぃ': ['wi', 'whi'], 'うぇ': ['we', 'whe'], 'うぉ': ['who'], 'うぁ': ['wha'],
  'つぁ': ['tsa'], 'つぃ': ['tsi'], 'つぇ': ['tse'], 'つぉ': ['tso'],
  'てぃ': ['thi', 'tei'], 'でぃ': ['dhi', 'dei'],
};

// 「ん」の次に来ると単独の n が使えないかな（母音・や行）
const VOWEL_Y = 'あいうえおやゆよゃゅょぁぃぅぇぉ';

// 記号・英数 -> 打鍵する文字
function mapSymbol(ch) {
  const table = {
    '。': '.', '、': ',', '「': '[', '」': ']', '『': '[', '』': ']',
    '！': '!', '？': '?', '・': '/', '…': '.', '―': '-', 'ー': '-',
    '　': ' ', '（': '(', '）': ')', '：': ':', '；': ';', '〜': '~',
  };
  if (Object.prototype.hasOwnProperty.call(table, ch)) return table[ch];
  if (/[a-zA-Z]/.test(ch)) return ch.toLowerCase();
  if (/[0-9]/.test(ch)) return ch;
  const code = ch.codePointAt(0);
  if (code >= 0xff21 && code <= 0xff3a) return String.fromCharCode(code - 0xff21 + 97); // Ａ-Ｚ
  if (code >= 0xff41 && code <= 0xff5a) return String.fromCharCode(code - 0xff41 + 97); // ａ-ｚ
  if (code >= 0xff10 && code <= 0xff19) return String.fromCharCode(code - 0xff10 + 48); // ０-９
  return null;
}

// 位置 i のかなのローマ字候補を返す（促音の先読みにも使う）
export function kanaOptionsAt(hira, i) {
  if (i >= hira.length) return [''];
  const two = hira.slice(i, i + 2);
  if (DIGRAPH[two]) return DIGRAPH[two];
  const ch = hira[i];
  if (ch === 'ん') return ['nn', 'xn', 'n'];
  if (ch === 'っ') return ['ltu', 'xtu'];
  if (SINGLE[ch]) return SINGLE[ch];
  const mapped = mapSymbol(ch);
  if (mapped !== null) return [mapped];
  return ['']; // 打鍵不要（々・α などの記号）
}

// 本文（ひらがな読み）を 1 かなずつのセグメントに分解する
export function buildSegments(hira) {
  const segs = [];
  let i = 0;
  while (i < hira.length) {
    const two = hira.slice(i, i + 2);
    const ch = hira[i];

    if (DIGRAPH[two]) {
      segs.push({ kana: two, options: DIGRAPH[two], pass: false });
      i += 2;
      continue;
    }

    if (ch === 'っ') {
      // 促音: 次の子音を重ねる（かった -> katta）か ltu / xtu
      const opts = new Set(['ltu', 'xtu']);
      for (const o of kanaOptionsAt(hira, i + 1)) {
        const c = o[0];
        if (c && /[a-z]/.test(c) && !'aiueo'.includes(c)) opts.add(c);
      }
      segs.push({ kana: 'っ', options: [...opts], pass: false, sokuon: true });
      i += 1;
      continue;
    }

    if (ch === 'ん') {
      // 母音・や行が続くときは nn / xn のみ。それ以外は n 単独も可。
      const nxt = hira[i + 1];
      const opts = ['nn', 'xn'];
      if (!nxt || !VOWEL_Y.includes(nxt)) opts.unshift('n');
      segs.push({ kana: 'ん', options: opts, pass: false });
      i += 1;
      continue;
    }

    if (SINGLE[ch]) {
      segs.push({ kana: ch, options: SINGLE[ch], pass: false });
      i += 1;
      continue;
    }

    const mapped = mapSymbol(ch);
    if (mapped !== null) {
      segs.push({ kana: ch, options: [mapped], pass: false });
      i += 1;
      continue;
    }

    // 打鍵不要の文字（々 や ○ などの記号）はそのまま通過させる
    segs.push({ kana: ch, options: [''], pass: true });
    i += 1;
  }
  return segs;
}

// セグメントの代表的なローマ字（先頭候補）
export function canonicalRomaji(seg) {
  return seg.options.find((o) => o.length > 0) || '';
}

// 位置集合の ε 閉包。長さ 0 の候補（通過）を自動で消化する。
function closure(states, segs) {
  const seen = new Set();
  const out = [];
  const stack = states.slice();
  while (stack.length) {
    const s = stack.pop();
    if (s.seg >= segs.length) {
      if (!seen.has('ACC')) {
        seen.add('ACC');
        out.push({ seg: segs.length, opt: 0, pos: 0 });
      }
      continue;
    }
    const opt = segs[s.seg].options[s.opt];
    if (s.pos >= opt.length) {
      const ns = s.seg + 1;
      if (ns >= segs.length) {
        if (!seen.has('ACC')) {
          seen.add('ACC');
          out.push({ seg: segs.length, opt: 0, pos: 0 });
        }
      } else {
        for (let k = 0; k < segs[ns].options.length; k += 1) {
          stack.push({ seg: ns, opt: k, pos: 0 });
        }
      }
      continue;
    }
    const key = `${s.seg}:${s.opt}:${s.pos}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function initialState(segs) {
  if (segs.length === 0) return [{ seg: 0, opt: 0, pos: 0 }];
  const states = [];
  for (let k = 0; k < segs[0].options.length; k += 1) {
    states.push({ seg: 0, opt: k, pos: 0 });
  }
  return states;
}

// 1 段落分のローマ字入力判定器
export class RomajiMatcher {
  constructor(segments) {
    this.segs = segments;
    this.reset();
  }

  reset() {
    this.correct = 0;
    this.miss = 0;
    this.states = closure(initialState(this.segs), this.segs);
  }

  get complete() {
    return this.states.some((s) => s.seg >= this.segs.length);
  }

  // 確定済みのかな数（通過文字は自動的に確定）
  get done() {
    if (this.complete) return this.segs.length;
    let m = 0;
    for (const s of this.states) m = Math.max(m, s.seg);
    return m;
  }

  // 確定済みのルビ文字数（表示のハイライト用）
  get doneRuby() {
    const d = this.done;
    let len = 0;
    for (let i = 0; i < d; i += 1) len += this.segs[i].kana.length;
    return len;
  }

  // 1 打鍵を処理する。受理できれば ok:true、できなければミス。
  input(ch) {
    const c = ch.toLowerCase();
    const next = [];
    for (const s of this.states) {
      if (s.seg >= this.segs.length) continue;
      const opt = this.segs[s.seg].options[s.opt];
      if (opt[s.pos] === c) next.push({ seg: s.seg, opt: s.opt, pos: s.pos + 1 });
    }
    const cl = closure(next, this.segs);
    if (cl.length === 0) {
      this.miss += 1;
      return { ok: false };
    }
    this.states = cl;
    this.correct += 1;
    return { ok: true };
  }

  // 現在のかなで次に押すべきキー候補
  nextKeys() {
    const done = this.done;
    if (done >= this.segs.length) return [];
    const set = new Set();
    for (const s of this.states) {
      if (s.seg === done) {
        const opt = this.segs[s.seg].options[s.opt];
        if (s.pos < opt.length) set.add(opt[s.pos]);
      }
    }
    return [...set];
  }

  // 現在のかなで入力済みのローマ字
  typedPart() {
    const done = this.done;
    if (done >= this.segs.length) return '';
    let best = '';
    for (const s of this.states) {
      if (s.seg === done) {
        const opt = this.segs[s.seg].options[s.opt];
        const part = opt.slice(0, s.pos);
        if (part.length > best.length) best = part;
      }
    }
    return best;
  }

  // 現在入力中のかなの表示情報（ガイド用）
  current() {
    const done = this.done;
    if (done >= this.segs.length) return null;
    // もっとも入力が進んでいる方式を代表として表示する
    let best = null;
    for (const s of this.states) {
      if (s.seg !== done) continue;
      if (!best || s.pos > best.pos) best = s;
    }
    const option = this.segs[done].options[best.opt];
    return {
      kana: this.segs[done].kana,
      option,
      typed: option.slice(0, best.pos),
      nextKeys: this.nextKeys(),
    };
  }
}

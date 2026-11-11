// 原文(text)とルビ(ruby)の対応付け
// 表示用に「どの原文文字がどの読みに対応するか」をトークン列に分解する。
// 漢字はまとめて 1 トークン、かな・記号は 1 文字ずつ。漢字トークンの読みは、
// 直後に続く非漢字のかな列をアンカーにして ruby から切り出す。読みの中にも
// 同じかな（助詞など）が現れうるため、後戻り探索して妥当解を選ぶ。長い段落
// でもスタックを溢れさせないよう、再帰ではなく明示的なスタックで実装する。

const KANJI_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3005\u3006]/;

// ルビ側では片仮名がひらがなに正規化されているため、比較用に変換する
function normalizeForRuby(ch) {
  const code = ch.charCodeAt(0);
  if (code >= 0x30a1 && code <= 0x30f6) return String.fromCharCode(code - 0x60);
  return ch;
}

// text と ruby をトークン列に対応付ける。対応付けできない場合は null。
export function alignTextRuby(text, ruby) {
  const n = text.length;
  const m = ruby.length;
  const tokens = [];
  const frames = [];
  const failed = new Set();
  let ti = 0;
  let ri = 0;

  const pushToken = (a, b, c, d) => tokens.push({ text: text.slice(a, b), ruby: ruby.slice(c, d), kanji: true, rStart: c, rEnd: d });

  // 行き詰まったとき、直前の選択点まで戻って次の候補を試す
  function backtrack() {
    while (frames.length > 0) {
      const f = frames[frames.length - 1];
      failed.add(`${f.ti},${f.ri}`);
      f.ci += 1;
      tokens.length = f.tokLen;
      if (f.ci < f.candidates.length) {
        ri = f.candidates[f.ci];
        ti = f.j;
        pushToken(f.ti, f.j, f.ri, ri);
        return true;
      }
      frames.pop();
    }
    return false;
  }

  while (true) {
    let advanced = false;

    if (ti === n) {
      if (ri === m) return tokens;
    } else if (!KANJI_RE.test(text[ti])) {
      if (ri < m && ruby[ri] === normalizeForRuby(text[ti])) {
        tokens.push({ text: text[ti], ruby: ruby[ri], kanji: false, rStart: ri, rEnd: ri + 1 });
        ti += 1;
        ri += 1;
        advanced = true;
      } else {
        failed.add(`${ti},${ri}`);
      }
    } else if (!failed.has(`${ti},${ri}`)) {
      let j = ti;
      while (j < n && KANJI_RE.test(text[j])) j += 1;

      if (j >= n) {
        // 末尾まで漢字: 残りのルビをすべて読みとする
        pushToken(ti, j, ri, m);
        ti = n;
        ri = m;
        advanced = true;
      } else {
        let k = j;
        while (k < n && !KANJI_RE.test(text[k])) k += 1;
        const anchor = [...text.slice(j, k)].map(normalizeForRuby).join('');
        // 漢字 1 字あたりの読みはせいぜい数かな。探索窓を限定して爆発を防ぐ。
        const maxRead = (j - ti) * 6 + 6;
        const candidates = [];
        let p = ri;
        const limit = Math.min(m, ri + maxRead);
        while (true) {
          const idx = ruby.indexOf(anchor, p);
          if (idx === -1 || idx > limit) break;
          candidates.push(idx);
          p = idx + 1;
        }
        if (candidates.length > 0) {
          // 漢字の読みが長くなる候補（アンカー位置が後ろ）から試す。
          candidates.reverse();
          frames.push({ ti, ri, j, candidates, ci: 0, tokLen: tokens.length });
          ri = candidates[0];
          ti = j;
          pushToken(frames[frames.length - 1].ti, j, frames[frames.length - 1].ri, ri);
          advanced = true;
        }
      }
    }

    if (!advanced && !backtrack()) return null;
  }
}

// 段落をトークン列に変換する。対応付けに失敗した場合は、漢字のかたまりと
// それ以外に分けた簡易トークン（読みは空）を返す。
export function tokensForParagraph(text, ruby) {
  const aligned = alignTextRuby(text, ruby);
  if (aligned) return aligned;

  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (KANJI_RE.test(text[i])) {
      let j = i;
      while (j < text.length && KANJI_RE.test(text[j])) j += 1;
      tokens.push({ text: text.slice(i, j), ruby: '', kanji: true, rStart: 0, rEnd: 0 });
      i = j;
    } else {
      tokens.push({ text: text[i], ruby: '', kanji: false, rStart: 0, rEnd: 0 });
      i += 1;
    }
  }
  return tokens;
}

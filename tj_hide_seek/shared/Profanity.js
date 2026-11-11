/**
 * TJ Hide and Seek - the bad-word filter used by the server on every chat line, whiteboard and stash note.
 * mask(text) -> text with offensive words starred out (first letter kept for English, every character for Chinese).
 *
 * English words are matched per word after undoing the usual tricks:
 *   leetspeak (sh1t, @ss, $lut), stretched letters (fuuuuck), separators inside a word (f.u.c.k, f u c k)
 * SUB words are bad anywhere inside a word (motherfucker, bullshit); EXACT words only on their own
 * (so "class", "Dickens", "grape", "cocktail", "Niger" stay as they are).
 * Chinese phrases are matched ignoring spaces / punctuation stuck between the characters (傻 逼, 傻.逼).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TJProfanity = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUB = ['fuck', 'fuk', 'fck', 'shit', 'cunt', 'nigg', 'bitch', 'biatch', 'whore', 'slut', 'pussy', 'asshole', 'bastard', 'faggot',
    'retard', 'wank', 'twat', 'dildo', 'porn', 'jizz', 'cocksuck', 'dickhead', 'douche', 'bollock'];
  const ALLOW = new Set(['shiitake', 'scunthorpe', 'penistone', 'cockburn', 'niger', 'nigeria', 'nigerian']);
  const EXACT = ['ass', 'asses', 'arse', 'dick', 'dicks', 'cock', 'cocks', 'fag', 'fags', 'tit', 'tits', 'titty', 'titties', 'boob', 'boobs',
    'penis', 'vagina', 'cum', 'cumming', 'wtf', 'stfu', 'kys', 'gtfo', 'rape', 'raped', 'rapist', 'raping', 'nigga', 'niga', 'prick',
    'piss', 'pissed', 'damn', 'dammit', 'goddamn', 'hoe', 'hoes', 'thot', 'milf', 'sex', 'sexy', 'nazi', 'sb', 'nmsl', 'cnm', 'tmd', 'nmb', 'mlgb'];
  // matched like the Chinese list (letters only, spaces ignored), for phrases
  const PHRASES = ['killyourself', 'killurself', 'gokillyourself', 'godie'];
  const ZH = ['傻逼', '傻b', '傻比', '傻屄', '煞笔', '沙比', '傻叉', '傻屌', '屌丝', '屌', '鸡巴', '几把', '鸡吧', '操你', '草你', '艹你', '肏', '屄',
    '日你', '干你娘', '你妈', '你媽', '尼玛', '泥马', '草泥马', '他妈', '他媽', '妈的', '媽的', '妈逼', '妈卖批', '卧槽', '我操', '我草', '我靠',
    '贱人', '贱货', '婊子', '碧池', '狗日', '王八蛋', '混蛋', '滚蛋', '去死', '死全家', '脑残', '智障', '弱智', '白痴', '废物', '杂种', '畜生', '人渣', '蠢货', '狗屎'];

  const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't' };
  const squeeze = (s, n) => s.replace(n === 1 ? /(.)\1+/g : /(.)\1{2,}/g, n === 1 ? '$1' : '$1$1');
  // fuuuck -> fuck, but a word with a real double letter (nigg) only gets its runs cut to two
  const subs = [SUB.filter(w => squeeze(w, 1) === w), SUB.map(w => squeeze(w, 2))];
  const exact = new Set(EXACT);

  function bad(word) {           // word: lowercase letters only, leet already undone
    if (ALLOW.has(word)) return false;
    const forms = [word, squeeze(word, 2), squeeze(word, 1)];
    if (forms.some(f => exact.has(f))) return true;
    return subs[0].some(w => forms[2].includes(w)) || subs[1].some(w => forms[1].includes(w)) || /n+i+g{2,}/.test(word);
  }
  // a word is letters/digits/leet symbols, optionally joined by single separators (f.u.c.k, f-u-c-k, f u c k is handled below)
  const WORD = /[\p{L}\p{N}@$!|+]+(?:[._*\-'][\p{L}\p{N}@$!|+]+)*/gu;
  const norm = w => {
    const letters = /\p{L}/u.test(w);
    let s = '';
    for (const ch of w.toLowerCase()) {
      if (/\p{L}/u.test(ch)) s += ch;
      else if (letters && LEET[ch]) s += LEET[ch];
    }
    return s;
  };

  function mask(text) {
    text = String(text || '');
    const chars = [...text], out = [...chars];  // by code point, so CJK and emoji keep their places
    const idx = []; { let i = 0; for (const ch of text) { idx.push(i); i += ch.length; } }
    const at = Object.create(null); idx.forEach((u, k) => (at[u] = k));
    const star = (from, to, keepFirst) => { for (let k = from; k < to; k++) if (!(keepFirst && k === from) && !/\s/.test(out[k])) out[k] = '*'; };

    // 1. single words
    for (const m of text.matchAll(WORD)) {
      if (/[一-鿿]/.test(m[0]) && !/[a-z]/i.test(m[0])) continue;
      if (bad(norm(m[0]))) star(at[m.index], at[m.index + m[0].length] ?? out.length, true);
    }
    // 2. letters spaced out one by one: "f u c k", "s h i t"
    for (const m of text.matchAll(/(?:^|(?<=[^\p{L}\p{N}]))(?:[\p{L}\p{N}@$](?:\s+|[._\-]\s*)){2,}[\p{L}\p{N}@$](?![\p{L}\p{N}])/gu)) {
      const w = norm(m[0].replace(/[\s._\-]/g, ''));
      if (w.length >= 3 && bad(w)) star(at[m.index], at[m.index + m[0].length] ?? out.length, true);
    }
    // 3. Chinese: match on the CJK / latin characters only, so spaces and punctuation in between do not help
    const keep = [];
    out.forEach((ch, k) => { if (/[一-鿿\p{L}]/u.test(ch)) keep.push(k); });
    const flat = keep.map(k => chars[k].toLowerCase()).join('');
    for (const w of [...ZH, ...PHRASES]) {
      let p = flat.indexOf(w);
      while (p >= 0) { for (let k = p; k < p + [...w].length; k++) out[keep[k]] = '*'; p = flat.indexOf(w, p + 1); }
    }
    return out.join('');
  }

  return { mask, bad: w => bad(norm(w)) };
});

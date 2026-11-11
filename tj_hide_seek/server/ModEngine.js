/**
 * TJ Hide and Seek - keyword moderation engine (pure: no file access, runs in Node and in JavaScriptCore).
 *
 *   const eng = ModEngine.compile({ rules, exceptions, variants });
 *   eng.check('some text')  ->  { ok: true } | { ok: false, hits: [{ id, term, cat }] }
 *
 * Rules   { id, term, lang: 'en' | 'py' | 'zh', cat, mode: 'word' | 'sub', unless: [strings], on: bool }
 * Exceptions   [{ term }]  strings that are fine wherever they appear (a hit overlapping one is dropped)
 * Variants     { "艹": "草", ... }  Chinese characters folded to a canonical one before matching
 *
 * Text is normalised first: NFKC (full-width -> ASCII), lower case, accents / zero-width characters removed,
 * Cyrillic / Greek look-alikes -> Latin, Traditional -> Simplified Chinese, variants folded.
 * Two streams are then searched:
 *   Latin stream   words (and pinyin) split on anything that is not a letter / digit / leet symbol, so
 *                  "f.u.c.k", "f u c k", "fuuuuck", "$h1t", "fuck你", "wo cao" are all seen as the word.
 *                  'word' rules must equal a whole word, so "class", "Scunthorpe", "grape" are safe;
 *                  'sub' rules match inside a word ("motherfucker").
 *   Chinese stream only the Han characters and Latin letters, so spaces, digits, punctuation and emoji between
 *                  characters do not help ("傻 逼", "傻.1.逼"); also checked with repeated characters collapsed.
 * Any hit that overlaps an exception, or one of the rule's own `unless` strings, is ignored.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ModEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_TEXT = 1000, MAX_TOKENS = 300, MAX_WINDOW = 6, MAX_JOIN = 40;

  // ---- Traditional -> Simplified (pairs: traditional char then simplified char). Not exhaustive: the common ones.
  const T2S_PAIRS = ('與与 專专 業业 東东 絲丝 兩两 嚴严 喪丧 個个 豐丰 臨临 為为 麗丽 舉举 義义 烏乌 樂乐 喬乔 習习 鄉乡 書书 買买 亂乱 爭争 虧亏 雲云 亞亚 產产 親亲 億亿 僅仅 從从 倉仓 儀仪 們们 價价 眾众 優优 夥伙 會会 傘伞 偉伟 傳传 傷伤 倫伦 偽伪 體体 餘余 債债 傾倾 僑侨 僕仆 儉俭 儘尽 兒儿 黨党 蘭兰 關关 興兴 茲兹 養养 獸兽 內内 岡冈 冊册 寫写 軍军 農农 馮冯 決决 況况 凍冻 淨净 涼凉 減减 湊凑 幾几 鳳凤 憑凭 凱凯 擊击 鑿凿 劃划 劉刘 則则 剛刚 創创 刪删 別别 劑剂 劍剑 劇剧 勸劝 辦办 務务 動动 勵励 勁劲 勞劳 勢势 勳勋 勝胜 區区 醫医 華华 協协 單单 賣卖 盧卢 衛卫 卻却 廠厂 廳厅 歷历 厲厉 壓压 厭厌 縣县 參参 雙双 發发 變变 敘叙 疊叠 葉叶 號号 嘆叹 嘰叽 嚇吓 嗎吗 嗚呜 嚨咙 囑嘱 囪囱 圖图 圓圆 聖圣 場场 壞坏 塊块 堅坚 壇坛 壩坝 塢坞 墳坟 墜坠 壟垄 壘垒 夢梦 夾夹 奪夺 獎奖 奮奋 婦妇 媽妈 嫵妩 學学 寧宁 寶宝 實实 寵宠 審审 憲宪 宮宫 寬宽 賓宾 寢寝 對对 尋寻 導导 壽寿 將将 爾尔 塵尘 堯尧 尷尴 屆届 屬属 屜屉 層层 屢屡 島岛 嶺岭 崗岗 嶄崭 巒峦 幣币 帥帅 師师 帳帐 帶带 幫帮 幹干 庫库 廁厕 廂厢 廈厦 廚厨 廣广 廟庙 張张 彈弹 彌弥 彎弯 彙汇 歸归 當当 錄录 彥彦 徹彻 徑径 復复 惡恶 惱恼 悶闷 愛爱 慣惯 懷怀 態态 慶庆 憂忧 憐怜 懲惩 懸悬 戀恋 戲戏 戶户 擔担 拋抛 擇择 擁拥 攔拦 擠挤 擾扰 擬拟 撫抚 撲扑 撥拨 擴扩 擺摆 攝摄 攜携 敵敌 數数 斂敛 斷断 無无 舊旧 時时 曠旷 曉晓 曆历 曬晒 朧胧 桿杆 條条 棟栋 榮荣 樓楼 標标 樣样 樸朴 機机 橫横 檢检 櫃柜 檔档 檯台 橋桥 歡欢 歲岁 殘残 殺杀 殼壳 氣气 漢汉 湯汤 溝沟 滿满 漁渔 漸渐 潑泼 澤泽 濟济 濕湿 滅灭 燈灯 災灾 煙烟 煩烦 熱热 爺爷 牆墙 牠它 犧牺 狀状 猶犹 獅狮 獨独 獵猎 獲获 獻献 現现 瑪玛 環环 甕瓮 畢毕 畫画 異异 瘋疯 痺痹 癡痴 瞭了 礦矿 碼码 磚砖 確确 禮礼 禍祸 禪禅 離离 種种 積积 穩稳 窮穷 窩窝 競竞 筆笔 簡简 節节 範范 築筑 籤签 類类 糧粮 紅红 紀纪 約约 級级 紛纷 純纯 紙纸 紗纱 紡纺 細细 終终 組组 結结 絕绝 絞绞 給给 絡络 統统 經经 綁绑 綠绿 維维 綱纲 網网 綜综 綢绸 緊紧 線线 緣缘 編编 緩缓 練练 縱纵 總总 績绩 繁繁 織织 繞绕 繼继 續续 纏缠 罰罚 罵骂 羅罗 羈羁 翹翘 聞闻 聯联 聰聪 職职 聽听 肅肃 脅胁 腦脑 腳脚 臉脸 臘腊 臥卧 臺台 艙舱 艱艰 藝艺 莊庄 菸烟 萬万 蒼苍 蓋盖 蓮莲 薦荐 藥药 藍蓝 蟲虫 蠶蚕 蠻蛮 補补 裝装 裡里 製制 複复 襲袭 見见 規规 覺觉 覽览 觀观 觸触 計计 訂订 訃讣 認认 討讨 讓让 訊讯 記记 講讲 許许 論论 設设 訪访 訣诀 證证 評评 詞词 詢询 該该 詳详 誇夸 誌志 誓誓 誕诞 語语 誤误 說说 誰谁 課课 調调 談谈 請请 諸诸 諾诺 謀谋 謊谎 謎谜 謝谢 謠谣 謹谨 識识 譜谱 警警 譯译 議议 護护 讀读 豬猪 貓猫 貝贝 貞贞 負负 財财 貢贡 貧贫 貨货 販贩 貪贪 貫贯 責责 貴贵 貸贷 費费 貿贸 賀贺 賃赁 賊贼 賜赐 賞赏 賠赔 賢贤 質质 賬账 賴赖 贈赠 贊赞 贏赢 趕赶 趙赵 跡迹 踐践 蹤踪 軀躯 車车 軌轨 軒轩 軟软 轉转 轟轰 轡辔 輕轻 載载 輔辅 輛辆 輝辉 輩辈 輪轮 輸输 轄辖 辭辞 辯辩 迴回 這这 連连 週周 進进 遊游 運运 過过 達达 違违 遠远 適适 遲迟 遷迁 選选 遺遗 邁迈 邊边 邏逻 郵邮 釋释 針针 釣钓 鈴铃 鋒锋 鋼钢 錢钱 錯错 鍋锅 鍵键 鎖锁 鐘钟 鐵铁 鑰钥 長长 門门 閉闭 問问 閒闲 間间 閣阁 閥阀 閱阅 闆板 闊阔 闖闯 陣阵 陰阴 陳陈 陸陆 陽阳 隊队 階阶 際际 隨随 險险 隱隐 雜杂 難难 電电 霧雾 靈灵 靜静 頁页 頂顶 項项 順顺 須须 預预 領领 頭头 頻频 題题 額额 顏颜 願愿 顯显 風风 飛飞 飢饥 飯饭 飲饮 飽饱 飾饰 餅饼 餓饿 館馆 馬马 駁驳 駐驻 駕驾 駛驶 騎骑 騙骗 驚惊 驗验 驟骤 骯肮 髒脏 髮发 鬆松 鬥斗 鬧闹 魚鱼 鮮鲜 鳥鸟 鳴鸣 鷹鹰 麥麦 黃黄 點点 齊齐 齒齿 齡龄 龍龙 龜龟 賤贱 婊婊 屌屌 雞鸡 鷄鸡 嬌娇 嬲嬲 獸兽 軟软 慾欲 淫淫 姦奸 淩凌 撈捞 擼撸 擾扰 靠靠 屍尸 屁屁 豈岂 啟启 啓启 啞哑 噁恶 嘔呕 咒咒 殘残 懶懒 懂懂 憤愤 憶忆 憲宪 懼惧 擋挡 擰拧 攙搀 敗败 敵敌 斃毙 曇昙 業业 樁桩 毀毁 毆殴 沒没 滾滚 濫滥 灣湾 煩烦 爛烂 獄狱 瘦瘦 癮瘾 盜盗 睏困 矯矫 硬硬 禿秃 稱称 穢秽 窺窥 竊窃 糞粪 糾纠 紮扎 絨绒 綽绰 縫缝 縮缩 繩绳 罷罢 羨羡 習习 聾聋 臟脏 艷艳 蕩荡 蝕蚀 衝冲 補补 襪袜 覆覆 詐诈 詛诅 誘诱 諷讽 謗谤 譏讥 譴谴 讒谗 豎竖 賭赌 贓赃 趨趋 蹟迹 輾辗 迫迫 週周 鄙鄙 醜丑 醬酱 釘钉 鉤钩 銀银 鍛锻 鎮镇 鑽钻 閃闪 隻只 雙双 霸霸 韓韩 頸颈 顧顾 顫颤 餵喂 駭骇 騷骚 驢驴 髏髅 鬍胡 鯨鲸 鴨鸭 鵝鹅 麼么 黑黑 黨党 鼠鼠 齷龌 齪龊').split(' ');
  const T2S = Object.create(null);
  for (const p of T2S_PAIRS) { const a = [...p]; if (a.length === 2 && a[0] !== a[1]) T2S[a[0]] = a[1]; }

  // Cyrillic / Greek letters that look like Latin ones
  const HOMOGLYPH = { 'а': 'a', 'в': 'b', 'с': 'c', 'е': 'e', 'н': 'h', 'і': 'i', 'ј': 'j', 'к': 'k', 'м': 'm', 'о': 'o', 'р': 'p', 'ѕ': 's', 'т': 't', 'у': 'y', 'х': 'x', 'һ': 'h', 'ԁ': 'd', 'ɡ': 'g', 'ɑ': 'a', 'ο': 'o', 'α': 'a', 'ν': 'v', 'ρ': 'p', 'τ': 't', 'ι': 'i', 'κ': 'k', 'υ': 'u', 'ε': 'e', 'β': 'b', 'η': 'n', 'χ': 'x', 'ı': 'i', 'ø': 'o', 'ß': 'ss', 'æ': 'ae', 'đ': 'd', 'ł': 'l' };
  const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't' };
  const HAN = /\p{Script=Han}/u;

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sq2 = s => s.replace(/(.)\1{2,}/g, '$1$1');     // fuuuck -> fuuck
  const sq1 = s => s.replace(/(.)\1+/g, '$1');          // fuuuck -> fuck
  const hasDouble = s => sq1(s) !== s;
  /** Regex source for a term where every letter may be stretched (a doubled letter must stay at least doubled). */
  function stretch(term) {
    let out = '';
    for (let i = 0; i < term.length;) {
      let j = i; while (j < term.length && term[j] === term[i]) j++;
      out += esc(term[i]) + (j - i > 1 ? `{${j - i},}` : '+');
      i = j;
    }
    return out;
  }

  /** Fold one string: NFKC, lower case, strip accents / invisible characters, look-alikes, Traditional -> Simplified. */
  function fold(text, variants) {
    let s = String(text == null ? '' : text).slice(0, MAX_TEXT).normalize('NFKC').toLowerCase();
    s = s.normalize('NFD').replace(/[̀-ͯ​-‏⁠-⁤﻿­᠎͏︀-️]/g, '').normalize('NFC');
    let out = '';
    for (const ch of s) {
      if (HOMOGLYPH[ch]) out += HOMOGLYPH[ch];
      else if (T2S[ch] || (variants && variants[ch])) out += (variants && variants[ch]) || T2S[ch];
      else out += ch;
    }
    return out;
  }

  /** True when [a, b) touches one of the spans (a hit that overlaps an exception is not a hit). */
  const covered = (spans, a, b) => spans.some(s => s[0] < b && a < s[1]);
  function spansOf(str, needles) {
    const out = [];
    for (const n of needles) { if (!n) continue; let p = str.indexOf(n); while (p >= 0) { out.push([p, p + n.length]); p = str.indexOf(n, p + 1); } }
    return out;
  }

  function compile(cfg) {
    cfg = cfg || {};
    const variants = Object.assign(Object.create(null), cfg.variants || {});
    const foldTerm = t => fold(t, variants);
    // exceptions are written like terms: the Chinese ones are folded, the Latin ones are lower-cased with separators removed
    const excZh = [], excLa = [];
    for (const e of cfg.exceptions || []) {
      const t = foldTerm(typeof e === 'string' ? e : e.term).trim();
      if (!t) continue;
      if (HAN.test(t)) excZh.push(t.replace(/[^\p{Script=Han}a-z]/gu, '')); else excLa.push(t.replace(/\s+/g, ' '));
    }

    const zh = [], subs = [], words = new Map();
    for (const r of cfg.rules || []) {
      if (!r || r.on === false || !r.term) continue;
      const term = foldTerm(r.term).trim();
      const meta = { id: r.id, term: r.term, cat: r.cat || 'other' };
      if (HAN.test(term)) {
        const t = term.replace(/[^\p{Script=Han}a-z]/gu, '');
        if (!t) continue;
        zh.push({ meta, t, sq: sq1(t), unless: (r.unless || []).map(u => foldTerm(u).replace(/[^\p{Script=Han}a-z]/gu, '')) });
      } else {
        const letters = term.replace(/[^a-z0-9]/g, '');
        if (letters.length < 2) continue;
        const unless = (r.unless || []).map(u => foldTerm(u).trim().replace(/\s+/g, ' '));
        const multi = r.lang === 'py' || /\s/.test(term);
        if (r.mode === 'sub') {
          subs.push({ meta, re: new RegExp(stretch(letters)), unless });
        } else {
          const rule = { meta, multi, unless, re: null };
          for (const k of new Set([sq2(letters), hasDouble(letters) ? null : letters])) {
            if (!k) continue;
            if (!words.has(k)) words.set(k, []);
            words.get(k).push(rule);
          }
        }
      }
    }
    const maxWord = Math.min(MAX_JOIN, Math.max(0, ...[...words.keys()].map(k => k.length)));

    // ---------------------------------------------------------------- Chinese stream
    function scanZh(flat, hits) {
      if (!zh.length || !flat) return;
      const exc = spansOf(flat, excZh);
      for (const [pass, str] of [[0, flat], [1, sq1(flat)]]) {
        const ex = pass ? spansOf(str, excZh.map(sq1)) : exc;
        for (const r of zh) {
          const needle = pass ? r.sq : r.t;
          let p = str.indexOf(needle);
          while (p >= 0) {
            const q = p + needle.length;
            if (!covered(ex, p, q) && !(r.unless.length && covered(spansOf(str, r.unless.map(u => pass ? sq1(u) : u)), p, q))) { hits.set(r.meta.id, r.meta); break; }
            p = str.indexOf(needle, p + 1);
          }
        }
      }
    }

    // ---------------------------------------------------------------- Latin stream
    const TOKEN = /[a-z0-9@$!|+]+(?:[._\-*'’`~^]{1,2}[a-z0-9@$!|+]+)*/g;
    const trim = p => p.replace(/^[!|+@$]+(?=[a-z0-9])|[!|+@$]+$/g, '');
    const leet = p => {
      if (!/[a-z]/.test(p)) return p;
      const letters = (p.match(/[a-z]/g) || []).length;
      if (p.length < 3 && letters < 2) return p;
      let o = ''; for (const ch of p) o += LEET[ch] || ch; return o;
    };
    const alnum = p => p.replace(/[^a-z0-9]/g, '');

    function scanLatin(text, hits) {
      if (!words.size && !subs.length) return;
      const toks = [];                       // { alts: [..], one: '...', start, end }  (positions in `line`)
      const groups = [];                     // raw tokens: the parts of f.u.c.k, kept together for 'sub' rules
      let line = '', n = 0;
      for (const m of text.matchAll(TOKEN)) {
        if (++n > MAX_TOKENS) break;
        const g = { parts: [], joined: [] };
        for (const p of m[0].split(/[._\-*'’`~^]+/)) {
          if (!p) continue;
          const t = trim(p), l1 = leet(p), l2 = leet(t);
          const alts = [...new Set([alnum(p), alnum(t), alnum(l1), alnum(l2), alnum(p).replace(/[0-9]+/g, '')].filter(a => a.length > 0))];   // last one: shabi99, xx_fuck_69
          if (!alts.length) continue;
          const one = alnum(l2) || alnum(t) || alnum(p);
          const start = line.length + (line ? 1 : 0);
          line += (line ? ' ' : '') + alts[0];
          const tk = { alts, one, start, end: start + alts[0].length, single: one.length === 1, trail: alnum(t) };
          toks.push(tk); g.parts.push(tk);
        }
        if (g.parts.length) groups.push(g);
      }
      if (!toks.length) return;
      const exc = spansOf(line, excLa);
      const ok = (rule, a, b) => !covered(exc, a, b) && !(rule.unless.length && covered(spansOf(line, rule.unless), a, b));
      const hitWord = (str, a, b, nTok, allSingle) => {
        for (const f of new Set([str, sq2(str), sq1(str)])) {
          const rs = words.get(f);
          if (!rs) continue;
          for (const r of rs) if ((nTok === 1 || allSingle || r.multi) && ok(r, a, b)) hits.set(r.meta.id, r.meta);
        }
      };
      const hitSub = (str, a, b) => { for (const r of subs) if (r.re.test(str) && ok(r, a, b)) hits.set(r.meta.id, r.meta); };

      // 1. a single word (any spelling of it)
      for (const t of toks) for (const a of t.alts) { hitWord(a, t.start, t.end, 1, true); hitSub(a, t.start, t.end); }
      // 2. the parts of one dotted / dashed token glued together (f.u.c.k, s-h-i-t)
      for (const g of groups) if (g.parts.length > 1) {
        const a = g.parts[0].start, b = g.parts[g.parts.length - 1].end;
        const glued = [...new Set([g.parts.map(p => p.one).join(''), g.parts.map(p => p.alts[0]).join('')])];
        for (const s of glued) { hitWord(s, a, b, 1, true); hitSub(s, a, b); }
      }
      // 3. several words in a row: pinyin / phrases ("wo cao", "kill yourself"), and letters spaced out ("f u c k")
      for (let i = 0; i < toks.length; i++) {
        let joined = '', allSingle = true;
        for (let j = i; j < toks.length; j++) {
          const t = toks[j];
          if (!t.single) allSingle = false;
          if (j - i + 1 > MAX_WINDOW && !allSingle) break;
          if (j > i) for (const last of new Set([t.one, t.trail])) {      // the last word may carry a stray ! or +
            const s = joined + last;
            if (s && s.length <= maxWord) hitWord(s, toks[i].start, t.end, j - i + 1, allSingle);
          }
          joined += t.one;
          if (joined.length > MAX_JOIN) break;
        }
      }
      // 4. the same, for 'sub' rules, on runs of single letters ("m o t h e r f u c k e r")
      for (let i = 0; i < toks.length;) {
        if (!toks[i].single) { i++; continue; }
        let j = i; while (j < toks.length && toks[j].single) j++;
        if (j - i >= 3) hitSub(toks.slice(i, j).map(t => t.one).join(''), toks[i].start, toks[j - 1].end);
        i = j;
      }
    }

    function check(text) {
      const hits = new Map();
      const base = fold(text, variants);
      if (!base.trim()) return { ok: true };
      // Chinese stream: only Han characters and Latin letters, so separators between characters do not matter
      let flat = ''; for (const ch of base) if (HAN.test(ch) || (ch >= 'a' && ch <= 'z')) flat += ch;
      if (HAN.test(flat)) scanZh(flat, hits);
      // Latin stream (Han characters become spaces: "fuck你" -> "fuck")
      scanLatin(base.replace(/\p{Script=Han}/gu, ' '), hits);
      return hits.size ? { ok: false, hits: [...hits.values()] } : { ok: true };
    }
    return { check, size: { zh: zh.length, word: words.size, sub: subs.length } };
  }

  return { compile, fold };
});

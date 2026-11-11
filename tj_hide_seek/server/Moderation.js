/**
 * TJ Hide and Seek - moderation store: the keyword database admins edit, and the log of what got blocked.
 *
 *   DATA_DIR/tjhs-moderation.json   rules + exceptions + variants (seeded from moderation-default.json the first time).
 *                                   Edit it from the in-game "Keyword filter" panel, or by hand: it is re-read
 *                                   within 15 s of a change, no restart and no code change needed.
 *   DATA_DIR/tjhs-modlog.jsonl      one line per blocked username / chat line / note / whiteboard text, with the keywords
 *
 * See ModEngine.js for how text is normalised and matched.
 */
const fs = require('fs');
const path = require('path');
const ModEngine = require('./ModEngine.js');

const CATS = ['profanity', 'vulgar', 'sexual', 'slur', 'hate', 'harassment', 'threat', 'other'];
const LANGS = ['en', 'py', 'zh'];
const MAX_RULES = 5000, MAX_EXC = 1000, LOG_MEM = 500, LOG_FILE_MAX = 4 * 1024 * 1024;

class Moderation {
  constructor({ dataDir, log }) {
    this.log = log || console.log;
    this.file = path.join(dataDir || '.', 'tjhs-moderation.json');
    this.logFile = path.join(dataDir || '.', 'tjhs-modlog.jsonl');
    this.blocked = [];                                   // newest last
    this.mtime = 0;
    this.load();
    this.loadLog();
    setInterval(() => this.reloadIfChanged(), 15000).unref();
  }

  load() {
    let data = null;
    try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) {}
    if (!data || !Array.isArray(data.rules)) {
      data = JSON.parse(fs.readFileSync(path.join(__dirname, 'moderation-default.json'), 'utf8'));
      this.data = data; this.save();
      this.log(`moderation: seeded ${data.rules.length} rules into ${this.file}`);
    } else {
      this.data = { version: 1, variants: data.variants || {}, rules: data.rules, exceptions: data.exceptions || [] };
      try { this.mtime = fs.statSync(this.file).mtimeMs; } catch (e) {}
    }
    this.compile();
  }
  compile() {
    try {
      this.engine = ModEngine.compile(this.data);
      this.log(`moderation: ${this.data.rules.filter(r => r.on !== false).length} active rules (${JSON.stringify(this.engine.size)})`);
    } catch (e) { this.log('moderation: bad rules, keeping the previous ones: ' + e.message); }
  }
  reloadIfChanged() {
    let m = 0; try { m = fs.statSync(this.file).mtimeMs; } catch (e) { return; }
    if (m === this.mtime) return;
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(d.rules)) throw new Error('no rules array');
      this.data = { version: 1, variants: d.variants || {}, rules: d.rules, exceptions: d.exceptions || [] };
      this.mtime = m; this.compile();
    } catch (e) { this.mtime = m; this.log('moderation: ignoring the edited file: ' + e.message); }
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
    try { this.mtime = fs.statSync(this.file).mtimeMs; } catch (e) {}
  }

  /** { ok: true } or { ok: false, hits: [{ id, term, cat }] } */
  check(text) { return this.engine.check(text); }

  /** Check, and when blocked, log it. kind: 'username' | 'chat' | 'note' | 'board'. Returns true when the text is fine. */
  allow(text, { kind, user, ip, game }) {
    const r = this.check(text);
    if (r.ok) return true;
    this.record(text, { kind, user, ip, game, hits: r.hits });
    return false;
  }
  /** Add to the blocked log (also used for what the Gemini pass in AiModerator.js flags afterwards). */
  record(text, { kind, user, ip, game, hits, action }) {
    const e = { at: Date.now(), game: game || 'tjhs', kind, user: String(user || ''), ip: String(ip || ''), text: String(text).slice(0, 300), hits: hits || [] };
    if (action) e.action = action;
    this.blocked.push(e);
    if (this.blocked.length > LOG_MEM) this.blocked.splice(0, this.blocked.length - LOG_MEM);
    fs.appendFile(this.logFile, JSON.stringify(e) + '\n', () => {});
    this.log(`moderation: ${action || 'blocked'} ${e.game} ${kind} from ${e.user || '?'} (${e.ip || '?'}): ${e.hits.map(h => h.term).join(', ')}`);
  }
  loadLog() {
    try {
      const st = fs.statSync(this.logFile);
      let lines = fs.readFileSync(this.logFile, 'utf8').split('\n').filter(Boolean);
      if (st.size > LOG_FILE_MAX) { lines = lines.slice(-2000); fs.writeFileSync(this.logFile, lines.join('\n') + '\n'); }
      for (const l of lines.slice(-LOG_MEM)) { try { this.blocked.push(JSON.parse(l)); } catch (e) {} }
    } catch (e) {}
  }

  // ---------------------------------------------------------------- admin edits
  snapshot() {
    return { rules: this.data.rules, exceptions: this.data.exceptions, variants: this.data.variants, cats: CATS, log: this.blocked.slice(-200) };
  }
  static tidy(r) {
    const term = String(r.term || '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 40);
    if (term.length < 1) return { error: 'Type a keyword.' };
    const lang = LANGS.includes(r.lang) ? r.lang : (/\p{Script=Han}/u.test(term) ? 'zh' : 'en');
    const cat = CATS.includes(r.cat) ? r.cat : 'other';
    const unless = (Array.isArray(r.unless) ? r.unless : String(r.unless || '').split(/[,，\n]/)).map(s => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
    const out = { term, lang, cat, mode: r.mode === 'sub' ? 'sub' : 'word', on: r.on !== false };
    if (unless.length) out.unless = unless;
    return out;
  }
  /** op: add | update | remove  (rule: { id?, term, lang, cat, mode, unless, on }). Returns { ok } or { error }. */
  editRule(op, r) {
    const rules = this.data.rules;
    if (op === 'remove') {
      const i = rules.findIndex(x => x.id === r.id);
      if (i < 0) return { error: 'No such keyword.' };
      rules.splice(i, 1);
    } else if (op === 'update') {
      const i = rules.findIndex(x => x.id === r.id);
      if (i < 0) return { error: 'No such keyword.' };
      const t = Moderation.tidy(Object.assign({}, rules[i], r));
      if (t.error) return t;
      rules[i] = Object.assign({ id: r.id }, t);
    } else if (op === 'add') {
      if (rules.length >= MAX_RULES) return { error: 'Too many keywords.' };
      const t = Moderation.tidy(r);
      if (t.error) return t;
      if (rules.some(x => x.term.toLowerCase() === t.term.toLowerCase() && x.lang === t.lang)) return { error: 'That keyword is already in the list.' };
      rules.push(Object.assign({ id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }, t));
    } else return { error: 'Unknown action.' };
    this.save(); this.compile();
    return { ok: true };
  }
  editException(op, e) {
    const list = this.data.exceptions;
    if (op === 'remove') {
      const i = list.findIndex(x => x.id === e.id);
      if (i < 0) return { error: 'No such exception.' };
      list.splice(i, 1);
    } else if (op === 'add') {
      const term = String(e.term || '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 60);
      if (!term) return { error: 'Type the word or phrase that is allowed.' };
      if (list.length >= MAX_EXC) return { error: 'Too many exceptions.' };
      if (list.some(x => x.term.toLowerCase() === term.toLowerCase())) return { error: 'Already in the list.' };
      list.push({ id: 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), term, note: String(e.note || '').slice(0, 60) });
    } else return { error: 'Unknown action.' };
    this.save(); this.compile();
    return { ok: true };
  }
}

/** One store per data directory, shared by every game that filters text (TJ Hide and Seek, the flight sim chat). */
const shared = new Map();
Moderation.shared = ({ dataDir, log }) => {
  const key = path.resolve(dataDir || '.');
  if (!shared.has(key)) shared.set(key, new Moderation({ dataDir, log }));
  return shared.get(key);
};

module.exports = Moderation;

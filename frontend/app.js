/* =====================================================================
   STORY FORGE — frontend prototype (vanilla JS, no dependencies)
   Sections: Util · Api · Store · Sky · Editor · StoryGraph · GraphView · Inspector ·
             Suggestions · Review · Voice · Versions · Export · UI
   The human text is canonical. Nothing from the AI is written into the
   story until the user presses ACCEPT.
   ===================================================================== */
'use strict';

/* ------------------------------ Util ------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const humanKind = k => { const t = k.replace(/_/g, ' '); return t[0].toUpperCase() + t.slice(1); };
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  [].concat(kids).forEach(c => c && n.append(c.nodeType ? c : document.createTextNode(c)));
  return n;
}

/* ------------------------------- Api -------------------------------
   PLACEHOLDER WRAPPERS for the future FastAPI backend. None of these
   endpoints are assumed to exist yet. Every call resolves to
   { ok, data, error } and never throws, so the UI can degrade cleanly.

   Expected (proposed) response shapes — adjust when the backend lands:
     suggest   → { suggestions:[{ id, text, rationale }] }
     transcribe→ { text }
     analyze   → { nodes:[{ type, title, parent_id?, data?, links? }] }
     continuity→ { conflicts:[{ issue, detail, node_ids? }] }
     twist     → { twist:{ title, description, why, related, foreshadowing,
                           affected, consequences, compatibility } }
   ------------------------------------------------------------------ */
const Api = {
  base: 'http://127.0.0.1:8000', online: false, up: false, aiDetail: '', model: '', provider: 'ollama', label: '',
  async request(method, path, { json, form, raw, timeout = 30000 } = {}) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(this.base.replace(/\/$/, '') + path, {
        method, signal: ctl.signal,
        headers: json ? { 'Content-Type': 'application/json' } : undefined,
        body: json ? JSON.stringify(json) : form || undefined
      });
      if (!res.ok) { let msg = `HTTP ${res.status}`; try { const j = await res.json(); if (typeof j?.detail === 'string') msg = j.detail; } catch {} return { ok: false, error: msg }; }   // the backend's own explanation
      return { ok: true, data: raw ? await res.blob() : await res.json() };
    } catch (e) {
      return { ok: false, error: e.name === 'AbortError' ? 'Request timed out' : 'Backend unreachable' };
    } finally { clearTimeout(to); }
  },
  health:        ()          => Api.request('GET', '/health', { timeout: 3000 }),
  getSettings:   ()          => Api.request('GET', '/api/settings'),
  putSettings:   (p)         => Api.request('PUT', '/api/settings', { json: p }),
  testAi:        ()          => Api.request('POST', '/api/settings/test', { json: {}, timeout: 120000 }),
  createStory:   (story)     => Api.request('POST', '/api/stories', { json: story }),
  getStory:      (id)        => Api.request('GET', `/api/stories/${encodeURIComponent(id)}`),
  transcribe:    (blob, lang) => { const f = new FormData(); f.append('audio', blob, 'voice.webm'); f.append('language', lang || 'en'); return Api.request('POST', '/api/transcribe', { form: f, timeout: 180000 }); },
  analyze:       (payload)   => Api.request('POST', '/api/story/analyze', { json: payload, timeout: 300000 }),
  suggest:       (payload)   => Api.request('POST', '/api/story/suggest', { json: payload, timeout: 300000 }),
  continuity:    (payload)   => Api.request('POST', '/api/story/continuity', { json: payload, timeout: 300000 }),
  twist:         (payload)   => Api.request('POST', '/api/story/twist', { json: payload, timeout: 300000 }),
  updateStory:   (id, story) => Api.request('PUT', `/api/story/${encodeURIComponent(id)}`, { json: story }),
  exportPdf:     (payload)   => Api.request('POST', '/api/export/pdf', { json: payload, raw: true, timeout: 120000 })
};

/* ------------------------------ Store ------------------------------ */
const NODE_TYPES = {
  story:     { label: 'STORY',     glyph: '☾' },
  chapter:   { label: 'CHAPTER',   glyph: '❡' },
  scene:     { label: 'SCENE',     glyph: '▣' },
  character: { label: 'CHARACTER', glyph: '☺' },
  event:     { label: 'EVENT',     glyph: '✸' },
  location:  { label: 'LOCATION',  glyph: '⌖' },
  mystery:   { label: 'MYSTERY',   glyph: '?' },
  twist:     { label: 'TWIST',     glyph: '↯' },
  idea:      { label: 'IDEA',      glyph: '✦' }
};
/* Origin of a node: human | proposed | accepted | edited | rejected.
   (Stored as origin 'human'|'ai'|'edited'|'rejected' + canon flag.) */
const ORIGIN = {
  human:    { tag: '★ HUMAN WRITTEN',   short: '★ HUMAN',          cls: 'human',    mark: '★' },
  proposed: { tag: '◆ AI PROPOSED',    short: '◆ AI PROPOSED',    cls: 'proposed', mark: '◆' },
  accepted: { tag: '✓ AI MADE · YOU ACCEPTED', short: '✓ AI · ACCEPTED', cls: 'accepted', mark: '✓' },
  edited:   { tag: '✎ AI MADE · YOU EDITED',   short: '✎ AI · EDITED',   cls: 'edited',   mark: '✎' },
  rejected: { tag: '✕ REJECTED',       short: '✕ REJECTED',       cls: 'rejected', mark: '✕' }
};
const originKey = n => (n.origin === 'ai' ? (n.canon ? 'accepted' : 'proposed') : (ORIGIN[n.origin] ? n.origin : 'human'));
const LS_KEY = 'storyforge.story.v1', LS_VER = 'storyforge.versions.v1';

function newStory() {
  const nodes = { s: { id: 's', type: 'story', title: 'Untitled story', parent: null, kids: [], origin: 'human', canon: true, collapsed: false, data: {}, links: [] } };
  return {
    id: uid(), title: '', html: '', nodes, rootId: 's', selected: 's', suggestions: [], updated: Date.now(),
    settings: { genre: '', tone: '', pov: 'Third person limited', lang: 'en', api: 'http://127.0.0.1:8000', reduceMotion: false, marks: true }
  };
}

const Store = {
  s: null, undoStack: [], redoStack: [], dirty: false, restoring: false,
  init(story) { this.s = story; Api.base = story.settings.api || Api.base; this.undoStack = [this.snap()]; this.redoStack = []; this.setDirty(false); },
  snap() { return JSON.stringify({ h: Editor.html ? Editor.html() : this.s.html, n: this.s.nodes, sel: this.s.selected }); },
  /* commit(): record an undo step + mark unsaved. Called after every meaningful change. */
  commit() {
    if (this.restoring) return;
    const sn = this.snap();
    if (sn === this.undoStack[this.undoStack.length - 1]) return;
    this.undoStack.push(sn); if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = []; this.setDirty(true); UI.syncUndo();
  },
  apply(sn) {
    const o = JSON.parse(sn); this.restoring = true;
    this.s.nodes = o.n; this.s.selected = this.s.nodes[o.sel] ? o.sel : this.s.rootId;
    Editor.setHtml(o.h); GraphView.render(); Inspector.render(); UI.renderNav(); this.restoring = false;
  },
  undo() { if (this.undoStack.length < 2) return; this.redoStack.push(this.undoStack.pop()); this.apply(this.undoStack[this.undoStack.length - 1]); this.setDirty(true); UI.syncUndo(); },
  redo() { if (!this.redoStack.length) return; const sn = this.redoStack.pop(); this.undoStack.push(sn); this.apply(sn); this.setDirty(true); UI.syncUndo(); },
  setDirty(d) {
    this.dirty = d; const m = $('#moon'), p = $('#saveState');
    m.dataset.state = d ? 'draft' : 'saved'; p.textContent = d ? '☾ Unsaved' : '● Saved'; p.className = 'pill' + (d ? '' : ' ok');
  },
  save(silent) {
    this.s.html = Editor.html(); this.s.updated = Date.now();
    const ok = lsSet(LS_KEY, this.s);
    if (!ok) { $('#moon').dataset.state = 'error'; $('#saveState').textContent = '⚠ Save failed'; $('#saveState').className = 'pill bad'; toast('Could not save locally (storage blocked or full).'); return false; }
    this.setDirty(false); if (!silent) toast('Story saved'); this.syncRemote(); return true;
  },
  syncRemote() {                                                        // best-effort copy into the backend's data folder
    if (!Api.up) return;
    Api.updateStory(this.s.id, Persist.pack()).then(r => { if (!r.ok) toast(`Saved here, but the backend copy failed: ${r.error}`, 4200); });
  },
  node: id => Store.s.nodes[id],
  addNode(type, title, parentId, extra = {}) {
    const parent = this.s.nodes[parentId] || this.s.nodes[this.s.rootId];
    const n = { id: uid(), type, title, parent: parent.id, kids: [], origin: 'human', canon: true, collapsed: false, data: {}, links: [], ...extra };
    this.s.nodes[n.id] = n; parent.kids.push(n.id); parent.collapsed = false; return n;
  },
  removeNode(id) {
    if (id === this.s.rootId) return; const n = this.s.nodes[id];
    const drop = i => { this.s.nodes[i].kids.forEach(drop); delete this.s.nodes[i]; };
    this.s.nodes[n.parent].kids = this.s.nodes[n.parent].kids.filter(k => k !== id); drop(id);
    Object.values(this.s.nodes).forEach(x => (x.links = x.links.filter(l => this.s.nodes[l])));
    if (!this.s.nodes[this.s.selected]) this.s.selected = this.s.rootId;
  }
};

/* ------------------------------- Sky -------------------------------
   Background: slow stars + faint constellation lines. Paused when the
   user prefers reduced motion, or while the tab is hidden. */
const Sky = {
  c: null, x: null, stars: [], parts: [], raf: 0, w: 0, h: 0,
  init() {
    this.c = $('#sky'); this.x = this.c.getContext('2d');
    addEventListener('resize', debounce(() => this.size(), 150)); this.size();
    document.addEventListener('visibilitychange', () => { cancelAnimationFrame(this.raf); if (!document.hidden) this.loop(); });
    this.loop();
  },
  size() {
    const d = Math.min(devicePixelRatio || 1, 2); this.w = innerWidth; this.h = innerHeight;
    this.c.width = this.w * d; this.c.height = this.h * d; this.x.setTransform(d, 0, 0, d, 0, 0);
    const n = Math.round(this.w * this.h / 16000);
    this.stars = Array.from({ length: n }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, r: Math.random() * 1.3 + .3, p: Math.random() * 6.28 }));
    this.parts = Array.from({ length: 14 }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, vx: (Math.random() - .5) * .12, vy: -Math.random() * .1 - .02, r: Math.random() * 1.6 + .6 }));
  },
  loop(t = 0) {
    cancelAnimationFrame(this.raf);
    const still = Store.s?.settings.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const x = this.x; x.clearRect(0, 0, this.w, this.h);
    x.lineWidth = .6;
    for (let i = 0; i < this.stars.length; i += 3) {            // sparse constellation lines
      const a = this.stars[i], b = this.stars[(i + 7) % this.stars.length];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 170) { x.strokeStyle = `rgba(185,164,255,${.12 * (1 - d / 170)})`; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }
    }
    for (const s of this.stars) {
      const tw = still ? .7 : .5 + .5 * Math.sin(t / 1800 + s.p);
      x.fillStyle = `rgba(235,228,255,${.25 + .55 * tw})`; x.beginPath(); x.arc(s.x, s.y, s.r, 0, 6.28); x.fill();
    }
    for (const p of this.parts) {
      if (!still) { p.x += p.vx; p.y += p.vy; if (p.y < -5) { p.y = this.h + 5; p.x = Math.random() * this.w; } if (p.x < -5) p.x = this.w; if (p.x > this.w + 5) p.x = 0; }
      x.fillStyle = 'rgba(168,140,255,.18)'; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.28); x.fill();
    }
    if (!still && document.body.classList.contains('view-landing')) this.raf = requestAnimationFrame(t2 => this.loop(t2));
  }
};

/* ------------------------------ Editor ------------------------------ */
const Editor = {
  ed: null, savedRange: null,
  init() {
    this.ed = $('#editor');
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
    const commitSoon = debounce(() => Store.commit(), 500);
    this.ed.addEventListener('input', () => {
      this.normalize(); this.markEdited(); this.updateEmpty(); this.count(); Structure.sync(); Store.setDirty(true); commitSoon();
    });
    this.ed.addEventListener('beforeinput', e => {                    // "#" at the start of a line opens the chapter / scene chooser
      if (e.inputType !== 'insertText' || !e.data) return;
      if (e.data !== '#') return this.leaveAiEdge(e);
      this.normalize(); const r = this.range(); if (!r || !r.collapsed) return;
      const b = this.block(r.startContainer); if (!b || b === this.ed) return;
      const pre = document.createRange(); pre.selectNodeContents(b); pre.setEnd(r.startContainer, r.startOffset);
      if (pre.toString().length) return;
      e.preventDefault(); BlockMenu.open(b);
    });
    this.ed.addEventListener('keydown', e => this.onKeydown(e));
    this.ed.addEventListener('paste', e => {                         // plain text only: never import foreign markup
      e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    document.addEventListener('selectionchange', () => this.onSelection());
    $('#selToolbar').addEventListener('mousedown', e => e.preventDefault());
    $('#selToolbar').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return; const act = b.dataset.act;
      const r = this.range(); if (!r || r.collapsed) return;
      if (act === 'delete') { this.trimRange(r).deleteContents(); this.afterEdit(); $('#selToolbar').hidden = true; }
      else Suggestions.request(act === 'suggest' ? 'ai_suggest' : act, { range: r.cloneRange(), text: r.toString() });
    });
    $('#btnDelSentence').onclick = () => this.deleteSentence();
    $('#btnDelLine').onclick = () => this.deleteLine();
    $('#btnRestore').onclick = () => this.restoreOriginal();
    $('#chkMarks').onchange = e => { document.body.classList.toggle('hide-marks', !e.target.checked); Store.s.settings.marks = e.target.checked; };
  },
  html() { return this.ed.innerHTML; },
  setHtml(h) { this.ed.innerHTML = h || ''; if (!this.ed.firstChild) this.ed.innerHTML = '<p><br></p>'; this.updateEmpty(); this.count(); },
  /* keep every line inside a <p> so chapters and scenes always have a block to live on */
  normalize() {
    const ed = this.ed; if (!ed.firstChild) { ed.innerHTML = '<p><br></p>'; this.caretStart(ed.firstChild); return; }
    const isBlock = n => n.nodeType === 1 && /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE)$/.test(n.nodeName);
    for (const n of [...ed.childNodes]) {
      if (isBlock(n) || !n.parentNode) continue;
      const sel = getSelection(), keep = sel.rangeCount && sel.anchorNode === n ? sel.anchorOffset : null;
      const p = document.createElement('p'); ed.insertBefore(p, n); p.append(n);
      while (p.nextSibling && !isBlock(p.nextSibling)) { const nx = p.nextSibling; if (nx.nodeName === 'BR') { nx.remove(); break; } p.append(nx); }
      if (keep !== null) sel.collapse(n, keep);
    }
  },
  caretStart(node) { this.ed.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(node); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); this.savedRange = r.cloneRange(); },
  caretEnd(node) { this.ed.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(node); r.collapse(!node.textContent); const s = getSelection(); s.removeAllRanges(); s.addRange(r); this.savedRange = r.cloneRange(); },
  onKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.altKey && /^Digit[012]$/.test(e.code)) {          // Ctrl+Alt+1 chapter · 2 scene · 0 plain
      e.preventDefault(); this.normalize(); const r = this.range() || this.savedRange; if (!r) return toast('Click on a line first.');
      const b = this.block(r.startContainer); if (!b || b === this.ed) return;
      return Structure.assign({ Digit1: 'chapter', Digit2: 'scene', Digit0: null }[e.code], b);
    }
    const r = this.range(); if (!r || !r.collapsed) return;
    const b = this.block(r.startContainer); if (!b || b === this.ed || !b.dataset.sf) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {                           // a heading never splits into two headings
      e.preventDefault();
      const tail = document.createRange(); tail.selectNodeContents(b); tail.setStart(r.startContainer, r.startOffset);
      const p = document.createElement('p'); p.append(tail.extractContents()); if (!p.textContent) p.append(document.createElement('br'));
      if (!b.textContent) b.append(document.createElement('br'));
      b.after(p);
      [b, p].forEach(x => x.querySelectorAll('.ai-text').forEach(sp => { if (!sp.textContent) sp.remove(); }));   // a split must not carry an empty AI span into the new line
      p.querySelectorAll('.ai-text').forEach(sp => { sp.dataset.original = ''; });
      if (!b.firstChild) b.append(document.createElement('br')); if (!p.firstChild) p.append(document.createElement('br'));
      this.caretStart(p); this.afterEdit();
    } else if (e.key === 'Backspace') {
      const pre = document.createRange(); pre.selectNodeContents(b); pre.setEnd(r.startContainer, r.startOffset);
      if (!pre.toString().length) { e.preventDefault(); Structure.assign(null, b); }       // first Backspace at line start: back to plain text
    }
  },
  text() { return this.ed.innerText.replace(/ /g, ' ').trim(); },
  updateEmpty() { this.ed.classList.toggle('is-empty', !this.ed.textContent.trim() && !this.ed.querySelector('img')); },
  count() { const full = this.text(); this.ed.classList.toggle('has-body', full.length > 90); const w = full.split(/\s+/).filter(Boolean).length; $('#wordCount').textContent = `${w} word${w === 1 ? '' : 's'}`; },
  afterEdit() { this.normalize(); this.updateEmpty(); this.count(); Structure.sync(); Store.commit(); Store.setDirty(true); },
  /* the selection range if it lies inside the editor */
  range() {
    const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0);
    return this.ed.contains(r.commonAncestorContainer) ? r : null;
  },
  onSelection() {
    const r = this.range(); const tb = $('#selToolbar');
    if (r) this.savedRange = r.cloneRange();
    if (r && !r.collapsed && r.toString().trim()) {
      const b = r.getBoundingClientRect(); tb.hidden = false;
      const w = tb.offsetWidth || 300;
      tb.style.left = Math.max(w / 2 + 8, Math.min(innerWidth - w / 2 - 8, b.left + b.width / 2)) + 'px';
      tb.style.top = Math.max(60, b.top - 52) + 'px';
    } else tb.hidden = true;
    const inAi = r && this.aiSpanAt(r.startContainer);
    $('#btnRestore').hidden = !inAi;
  },
  leaveAiEdge(e) {                                                     // typing at the edge of an AI passage is the human's own text, not AI
    const r = this.range(); if (!r || !r.collapsed) return;
    const sp = this.aiSpanAt(r.startContainer); if (!sp) return;
    const pre = document.createRange(); pre.selectNodeContents(sp); pre.setEnd(r.startContainer, r.startOffset);
    const n = pre.toString().length, atEnd = n === sp.textContent.length;
    if (!atEnd && n !== 0) return;                                     // middle of an AI passage → counts as "human-edited AI"
    e.preventDefault();
    const tx = document.createTextNode(e.data === ' ' ? '\u00a0' : e.data); atEnd ? sp.after(tx) : sp.before(tx);   // nbsp: a lone trailing space is invisible and the caret would slide back into the AI span
    const nr = document.createRange(); nr.setStart(tx, tx.length); nr.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(nr);
    this.ed.dispatchEvent(new Event('input'));
  },
  aiSpanAt(n) { const e = n.nodeType === 3 ? n.parentElement : n; return e && e.closest ? e.closest('.ai-text') : null; },
  markEdited() {                                                       // typing inside an AI passage → "human-edited AI"
    const r = this.range(); const sp = r && this.aiSpanAt(r.startContainer);
    if (sp && sp.dataset.origin !== 'edited') { sp.dataset.origin = 'edited'; sp.title = 'AI suggestion you edited'; }
  },
  block(node) { let n = node.nodeType === 3 ? node.parentNode : node; while (n && n.parentNode !== this.ed) n = n.parentNode; return n; },
  deleteLine() {
    const r = this.range() || this.savedRange; if (!r) return toast('Place the cursor in a line first.');
    const b = this.block(r.startContainer); if (!b || b === this.ed) return;
    b.remove(); this.afterEdit();
  },
  deleteSentence() {
    const r = this.range() || this.savedRange; if (!r) return toast('Place the cursor in a sentence first.');
    const b = this.block(r.startContainer); if (!b || b === this.ed) return;
    const pre = document.createRange(); pre.selectNodeContents(b); pre.setEnd(r.startContainer, r.startOffset);
    const pos = pre.toString().length, text = b.textContent;
    const re = /[^.!?।]+[.!?।]*["”')\]]*\s*/g; let m, a = 0, z = text.length;
    while ((m = re.exec(text))) { if (pos >= m.index && pos <= m.index + m[0].length) { a = m.index; z = m.index + m[0].length; break; } }
    const rg = document.createRange(); const s = this.point(b, a), e = this.point(b, z);
    rg.setStart(s.n, s.o); rg.setEnd(e.n, e.o); rg.deleteContents();
    if (!b.textContent.trim()) b.remove();
    this.afterEdit();
  },
  point(root, off) {                                                   // char offset → DOM point
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n, acc = 0, last = null;
    while ((n = w.nextNode())) { last = n; if (acc + n.length >= off) return { n, o: off - acc }; acc += n.length; }
    return last ? { n: last, o: last.length } : { n: root, o: 0 };
  },
  /* A triple-click selects a line but ends at the start of the NEXT line; pull the end back so replacing it never leaves an empty paragraph. */
  trimRange(r) {
    if (!r || r.collapsed || r.endOffset !== 0) return r;
    const eb = this.block(r.endContainer);
    if (!eb || eb === this.ed || eb === this.block(r.startContainer) || !eb.previousElementSibling) return r;
    const c = r.cloneRange(), prev = eb.previousElementSibling; c.setEnd(prev, prev.childNodes.length); return c;
  },
  /* Replace/insert text as an AI passage. `original` is retained so the human text can be restored. */
  insertAi(text, { range, original = '', edited = false }) {
    const sp = el('span', { class: 'ai-text', 'data-origin': edited ? 'edited' : 'ai', 'data-original': original, title: edited ? 'AI suggestion you edited' : 'AI suggestion you accepted' }, text);
    let r = range;
    if (!r || !this.ed.contains(r.commonAncestorContainer)) {
      r = document.createRange(); let p = this.ed.lastElementChild;
      if (!p) { p = el('p'); p.append(document.createElement('br')); this.ed.append(p); }
      r.selectNodeContents(p); r.collapse(false);
    }
    r = this.trimRange(r); r.deleteContents();
    this.ed.querySelectorAll('p > br:only-child').forEach(b => b.parentElement.querySelector('.ai-text') && b.remove());
    r.insertNode(sp);
    this.afterEdit();
  },
  insertHuman(text) {
    let r = this.range() || this.savedRange;
    if (!r || !this.ed.contains(r.commonAncestorContainer)) {
      r = document.createRange(); let p = this.ed.lastElementChild;
      if (!p) { p = el('p'); this.ed.append(p); }
      r.selectNodeContents(p); r.collapse(false);
    }
    r.deleteContents(); r.insertNode(document.createTextNode((r.startOffset > 0 ? ' ' : '') + text)); this.afterEdit();
  },
  restoreOriginal() {
    const r = this.range(); const sp = r && this.aiSpanAt(r.startContainer); if (!sp) return;
    const orig = sp.dataset.original || '';
    if (orig) sp.replaceWith(document.createTextNode(orig)); else sp.remove();
    this.afterEdit(); toast('Original human text restored');
  }
};

/* ============================ STRUCTURE ==============================
   The page is the source of truth for chapters and scenes.
   A heading is a paragraph carrying data-sf="chapter" | "scene" and a data-id.
   Structure.sync() mirrors those headings into graph nodes (fromText:true),
   so the story map and graph always match the page. */
const Structure = {
  headings() { return $$('[data-sf]', Editor.ed); },
  textOf(h) { return h.textContent.replace(/\s+/g, ' ').trim().slice(0, 120); },
  signature() { return Object.values(Store.s.nodes).map(n => `${n.id}|${n.type}|${n.title}|${n.parent}|${n.origin}|${n.kids.join(',')}`).join(';'); },
  originOf(h) {
    const sp = [...h.querySelectorAll('.ai-text')]; if (!sp.length) return 'human';
    const ai = sp.reduce((a, x) => a + x.textContent.length, 0);
    return ai < h.textContent.length - 1 || sp.some(x => x.dataset.origin === 'edited') ? 'edited' : 'ai';
  },
  /* returns true when the node structure changed */
  sync() {
    const S = Store.s; if (!S) return false;
    const N = S.nodes, root = N[S.rootId], before = this.signature(), seen = new Set(), struct = new Map(); let chapter = null;
    for (const h of this.headings()) {
      const kind = h.dataset.sf;
      if (kind !== 'chapter' && kind !== 'scene') { h.removeAttribute('data-sf'); h.removeAttribute('data-id'); continue; }
      let id = h.dataset.id;
      if (!id || seen.has(id) || (N[id] && !N[id].fromText)) { id = uid(); h.dataset.id = id; }     // new, duplicated (copy/paste) or clashing id
      seen.add(id);
      const title = this.textOf(h) || (kind === 'chapter' ? 'Untitled chapter' : 'Untitled scene');
      const n = N[id] || (N[id] = { id, type: kind, title, parent: null, kids: [], origin: 'human', canon: true, collapsed: false, data: {}, links: [], fromText: true });
      n.type = kind; n.title = title; n.fromText = true;
      n.origin = this.originOf(h); n.canon = true;                                  // a heading made of AI text is AI-made, not human
      const parent = kind === 'scene' && chapter ? chapter : root.id;
      n.parent = parent; (struct.get(parent) || struct.set(parent, []).get(parent)).push(id);
      if (kind === 'chapter') chapter = id;
    }
    for (const n of Object.values(N)) if (n.fromText && !seen.has(n.id)) {         // heading deleted from the page
      n.kids.forEach(k => { const c = N[k]; if (c && !c.fromText) { c.parent = root.id; root.kids.push(c.id); } });
      delete N[n.id];
    }
    for (const p of Object.values(N)) {                                           // document order first, then notes
      const keep = p.kids.filter(k => N[k] && !N[k].fromText && N[k].parent === p.id);
      p.kids = [...(struct.get(p.id) || []), ...keep];
    }
    Object.values(N).forEach(x => (x.links = x.links.filter(l => N[l])));
    const lost = !N[S.selected]; if (lost) S.selected = S.rootId;
    const changed = before !== this.signature();
    if (changed) { this.refresh(lost); }
    return changed;
  },
  refresh(selectionLost) {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => { GraphView.render(); UI.renderNav(); UI.updateStrip(); if (selectionLost) Inspector.render(); });
  },
  assign(kind, block) {
    if (!block || block === Editor.ed) return;
    if (kind === 'chapter' || kind === 'scene') { block.dataset.sf = kind; if (!block.dataset.id) block.dataset.id = uid(); }
    else { block.removeAttribute('data-sf'); block.removeAttribute('data-id'); }
    Editor.afterEdit(); Editor.caretEnd(block);
    if (kind) toast(kind === 'chapter' ? 'Chapter added to your story map' : 'Scene added to your story map');
  },
  unassignSubtree(id) {
    const N = Store.s.nodes, walk = i => { const n = N[i]; if (!n) return; if (n.fromText) { const h = Editor.ed.querySelector(`[data-id="${i}"]`); if (h) { h.removeAttribute('data-sf'); h.removeAttribute('data-id'); } } n.kids.forEach(walk); };
    walk(id);
  },
  setText(id, text) { const h = Editor.ed.querySelector(`[data-id="${id}"]`); if (h) h.textContent = text; },
  jumpTo(id) {
    const h = Editor.ed.querySelector(`[data-id="${id}"]`); if (!h) return false;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    h.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    h.classList.remove('jump-flash'); void h.offsetWidth; h.classList.add('jump-flash'); setTimeout(() => h.classList.remove('jump-flash'), 1700);
    if (innerWidth > 760) Editor.caretEnd(h);
    return true;
  }
};

/* "#" at the start of a line opens this chooser. */
const BlockMenu = {
  el: null, block: null, idx: 0, KINDS: ['chapter', 'scene'],
  init() {
    this.el = $('#blockMenu');
    this.el.addEventListener('mousedown', e => e.preventDefault());
    this.el.addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (b) this.choose(b.dataset.kind); });
    document.addEventListener('mousedown', e => { if (!this.el.hidden && !e.target.closest('#blockMenu')) this.close(); });
    document.addEventListener('keydown', e => this.onKey(e), true);
  },
  open(block) {
    this.block = block; this.idx = 0; this.paint(); this.el.hidden = false;
    const r = block.getBoundingClientRect(), w = this.el.offsetWidth, h = this.el.offsetHeight;
    this.el.style.left = Math.max(10, Math.min(innerWidth - w - 10, r.left + 16)) + 'px';
    this.el.style.top = Math.max(10, Math.min(innerHeight - h - 10, r.bottom + 8)) + 'px';
  },
  close() { this.el.hidden = true; this.block = null; },
  paint() { $$('[data-kind]', this.el).forEach((b, i) => b.setAttribute('aria-selected', String(i === this.idx))); },
  choose(kind) { const b = this.block; this.close(); Structure.assign(kind, b); },
  onKey(e) {
    if (this.el.hidden) return; const k = e.key, stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'ArrowDown' || k === 'ArrowUp') { stop(); this.idx = 1 - this.idx; this.paint(); }
    else if (k === 'Enter') { stop(); this.choose(this.KINDS[this.idx]); }
    else if (k === '1' || k === '2') { stop(); this.choose(this.KINDS[+k - 1]); }
    else if (k === 'Escape' || k === 'Backspace') { stop(); this.close(); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { this.close(); document.execCommand('insertText', false, '#'); }   // it was a literal #
  }
};

/* ============================== PERSIST ==============================
   Story Forge book file (.storyforge.json): everything needed to restore the
   book exactly — text, chapters, scenes, graph notes, relationships, history.
   Markdown (.md): text + chapters (##) + scenes (###).  Files are untrusted
   input: text is rebuilt from a whitelist, never inserted as raw HTML. */
const Persist = {
  FORMAT: 'storyforge-book', VERSION: 1, handle: null,
  slug() { return (Store.s?.title || 'story').trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'story'; },
  fileName() { return `${this.slug()}.storyforge.json`; },
  pack() {
    const S = Store.s; S.html = Editor.html(); const { api, ...settings } = S.settings;
    return {
      format: this.FORMAT, version: this.VERSION, app: 'Story Forge', exportedAt: new Date().toISOString(),
      story: { id: S.id, title: S.title, html: S.html, rootId: S.rootId, selected: S.selected, nodes: S.nodes, settings, suggestions: S.suggestions.map(({ range, ...r }) => r) }
    };
  },
  async saveToComputer() {
    Store.save(true);                                                    // keep the browser copy in step too
    const text = JSON.stringify(this.pack(), null, 2);
    try {
      if (window.showSaveFilePicker) {                                   // Chrome / Edge: save in place, same file next time
        if (!this.handle) this.handle = await window.showSaveFilePicker({ suggestedName: this.fileName(), types: [{ description: 'Story Forge book', accept: { 'application/json': ['.json'] } }] });
        const w = await this.handle.createWritable(); await w.write(text); await w.close();
        toast(`Saved to your computer: ${this.handle.name}`, 3200); return true;
      }
    } catch (e) { if (e.name === 'AbortError') return false; this.handle = null; }
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: this.fileName() });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Downloaded ${this.fileName()} — keep it somewhere safe`, 4200); return true;
  },
  /* ---- reading files ---- */
  sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html'), out = document.createElement('div');
    const inline = (src, dst) => src.childNodes.forEach(n => {
      if (n.nodeType === 3) dst.append(n.textContent);
      else if (n.nodeName === 'BR') dst.append(document.createElement('br'));
      else if (n.nodeType === 1 && n.classList.contains('ai-text')) {
        const o = n.dataset.origin === 'edited' ? 'edited' : 'ai';
        dst.append(el('span', { class: 'ai-text', 'data-origin': o, 'data-original': String(n.dataset.original || '').slice(0, 5000), title: o === 'edited' ? 'AI suggestion you edited' : 'AI suggestion you accepted' }, n.textContent));
      } else if (n.nodeType === 1) dst.append(n.textContent);
    });
    let loose = null;
    doc.body.childNodes.forEach(n => {
      if (n.nodeType === 1 && /^(P|DIV|H[1-6])$/.test(n.nodeName)) {
        loose = null; const p = document.createElement('p'), sf = n.dataset.sf;
        if (sf === 'chapter' || sf === 'scene') { p.dataset.sf = sf; if (/^[a-z0-9]{1,16}$/.test(n.dataset.id || '')) p.dataset.id = n.dataset.id; }
        inline(n, p); if (!p.firstChild) p.append(document.createElement('br')); out.append(p);
      } else if (n.nodeType === 3 && !n.textContent.trim()) { /* ignore whitespace between blocks */ }
      else { if (!loose) { loose = document.createElement('p'); out.append(loose); } const tmp = document.createElement('div'); tmp.append(n.cloneNode(true)); inline(tmp, loose); }
    });
    return out.innerHTML;
  },
  parseBook(text) {
    let o; try { o = JSON.parse(text); } catch { throw new Error('That file isn’t a valid Story Forge book.'); }
    if (o?.format !== this.FORMAT || !o.story) throw new Error('That file isn’t a Story Forge book (.storyforge.json).');
    if (o.version > this.VERSION) throw new Error('This book was saved by a newer version of Story Forge. Update the app first.');
    const s = o.story, base = newStory(), nodes = {}, str = (v, n) => String(v ?? '').slice(0, n);
    for (const [id, n] of Object.entries(s.nodes || {})) {
      if (!/^[\w-]{1,24}$/.test(id) || !NODE_TYPES[n?.type]) continue;
      const data = {}; Object.entries(n.data || {}).forEach(([k, v]) => { if (/^\w{1,24}$/.test(k)) data[k] = str(v, 5000); });
      nodes[id] = { id, type: n.type, title: str(n.title, 200), parent: n.parent ?? null, kids: Array.isArray(n.kids) ? n.kids.filter(k => typeof k === 'string') : [],
        origin: ['human', 'ai', 'edited', 'rejected'].includes(n.origin) ? n.origin : 'human', canon: n.canon !== false, collapsed: !!n.collapsed, data,
        links: Array.isArray(n.links) ? n.links.filter(k => typeof k === 'string') : [], ...(n.fromText ? { fromText: true } : {}) };
    }
    const rootId = nodes[s.rootId]?.type === 'story' ? s.rootId : base.rootId; if (!nodes[rootId]) nodes[rootId] = base.nodes[base.rootId];
    for (const n of Object.values(nodes)) {                              // repair references
      n.kids = n.kids.filter(k => nodes[k] && k !== n.id); n.links = n.links.filter(k => nodes[k]);
      if (n.id !== rootId && !nodes[n.parent]) { n.parent = rootId; if (!nodes[rootId].kids.includes(n.id)) nodes[rootId].kids.push(n.id); }
    }
    nodes[rootId].parent = null;
    const keys = ['genre', 'tone', 'pov', 'lang', 'reduceMotion', 'marks'], settings = { ...base.settings }; keys.forEach(k => { if (s.settings && k in s.settings) settings[k] = s.settings[k]; }); settings.api = Api.base;
    const sugg = (Array.isArray(s.suggestions) ? s.suggestions : []).slice(0, 200).map(x => ({ id: str(x.id, 24), kind: str(x.kind, 40) || 'ai_suggest', original: str(x.original, 8000), text: str(x.text, 8000), why: str(x.why, 2000), status: str(x.status, 24) || 'pending', sample: !!x.sample, at: Number(x.at) || Date.now(), range: null }));
    return { ...base, id: str(s.id, 24) || uid(), title: str(s.title, 200), html: this.sanitizeHtml(s.html), nodes, rootId, selected: nodes[s.selected] ? s.selected : rootId, suggestions: sugg, settings };
  },
  parseMarkdown(text, fileName) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n'), blocks = []; let title = '', para = [];
    const flush = () => { if (para.length) { blocks.push({ kind: pendingScene ? 'scene' : 'p', text: para.join(' ').trim() }); para = []; pendingScene = false; } };
    let pendingScene = false;
    for (const raw of lines) {
      if (/^<!--\s*scene\s*-->$/i.test(raw.trim())) { flush(); pendingScene = true; continue; }
      const m = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/.exec(raw);
      if (m) { flush(); const d = m[1].length;
        if (d === 1 && !title && !blocks.length) title = m[2].trim();
        else blocks.push({ kind: d <= 2 ? 'chapter' : 'scene', text: m[2].trim() }); }
      else if (!raw.trim()) flush(); else para.push(raw.trim().replace(/^\\#/, '#'));
    }
    flush();
    return this.fromBlocks(title, blocks, fileName);
  },
  fromBlocks(title, blocks, fileName) {
    if (!blocks.length && !title) throw new Error('That file looks empty.');
    const base = newStory(); title = title || fileName.replace(/\.(md|markdown|txt|html?)$/i, '');
    const toHtml = t => esc(t).replace(/⟦AI: ([\s\S]*?)⟧/g, '<span class="ai-text" data-origin="ai">$1</span>');
    const html = blocks.map(b => `<p${b.kind === 'p' ? '' : ` data-sf="${b.kind}"`}>${toHtml(b.text)}</p>`).join('');
    base.title = title.slice(0, 200); base.nodes[base.rootId].title = base.title || 'Untitled story'; base.html = this.sanitizeHtml(html); base.settings.api = Api.base;
    return base;
  },
  parseHtml(text, fileName) {
    const doc = new DOMParser().parseFromString(text, 'text/html'), sc = doc.getElementById('storyforge-book');
    if (sc) return this.parseBook(sc.textContent);                       // a Story Forge web export carries the whole book
    const blocks = []; let title = '';
    doc.body.querySelectorAll('h1,h2,h3,p').forEach(n => {
      const t = n.textContent.replace(/\s+/g, ' ').trim(); if (!t) return;
      if (n.tagName === 'H1' && !title && !blocks.length) title = t; else blocks.push({ kind: n.tagName === 'H1' || n.tagName === 'H2' ? 'chapter' : n.tagName === 'H3' ? 'scene' : 'p', text: t });
    });
    return this.fromBlocks(title || doc.title, blocks, fileName);
  },
  async importFile(file) {
    if (file.size > 20e6) throw new Error('That file is larger than 20 MB.');
    const text = await file.text();
    if (/\.json$/i.test(file.name) || text.trimStart().startsWith('{')) return this.parseBook(text);
    if (/\.html?$/i.test(file.name) || /^\s*<(!doctype|html)/i.test(text)) return this.parseHtml(text, file.name);
    return this.parseMarkdown(text, file.name);
  }
};

/* ---------------------------- Story Graph ----------------------------
   Story data (Store.s.nodes)  →  StoryGraph.build()  →  GraphView
   The model hands any renderer a plain graph:
     { rootId, selected, nodes:{id:{id,type,label,origin,collapsed,parent,children}},
       edges:[{source,target,kind:'child'|'relation'}] }
   A renderer only needs { init(), render(graph, ctx), fit?() }.
   To replace the tree with an Obsidian-style graph later, write a new view
   and call GraphView.use(MyForceGraph). Nothing else needs to change. */
const StoryGraph = {
  build() {
    const S = Store.s, nodes = {}, edges = [];
    for (const n of Object.values(S.nodes)) {
      nodes[n.id] = { id: n.id, type: n.type, label: n.title, origin: originKey(n), collapsed: !!n.collapsed, parent: n.parent, children: [...n.kids] };
      if (n.parent) edges.push({ source: n.parent, target: n.id, kind: 'child' });
      n.links.forEach(l => S.nodes[l] && edges.push({ source: n.id, target: l, kind: 'relation' }));
    }
    return { rootId: S.rootId, selected: S.selected, nodes, edges };
  },
  neighbors(g, id) {
    const s = new Set([id]); g.edges.forEach(e => { if (e.source === id) s.add(e.target); if (e.target === id) s.add(e.source); }); return s;
  },
  toggle(id) { const n = Store.s.nodes[id]; if (n) n.collapsed = !n.collapsed; },
  expandAll() { Object.values(Store.s.nodes).forEach(n => (n.collapsed = false)); }
};
const GraphView = {
  impl: null,
  use(view) { this.impl = view; view.init?.(); },
  init() { this.impl?.init?.(); },
  render() {
    if (!Store.s || !this.impl) return;
    const has = Object.keys(Store.s.nodes).length > 1;                  // the graph only exists once a chapter or scene has been assigned
    $('#graphEmpty').hidden = has; $('#treeWrap').hidden = !has; $('#selStrip').hidden = !has; $('.tree-tools').hidden = !has; $('#navAdd').hidden = !has;
    if (!has) return;
    this.impl.render(StoryGraph.build(), { onSelect: id => UI.select(id, innerWidth <= 1200, true), onToggle: id => { StoryGraph.toggle(id); this.render(); } });
  },
  fit() { this.impl?.fit?.(); },
  reset() { this.impl?.reset?.(); },
  fitOnce() { this.impl?.fitOnce?.(); }
};

/* Current (temporary) renderer: left-to-right SVG tree with pan/zoom. */
const TreeView = {
  svg: null, g: null, view: { x: 40, y: 20, k: 1 }, pos: {}, W: 150, H: 50, GX: 166, GY: 62, _fitted: false, _sel: null,
  init() {
    this.svg = $('#treeSvg');
    let drag = null;
    this.svg.addEventListener('pointerdown', e => { if (e.target.closest('.node')) return; drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y }; this.svg.setPointerCapture(e.pointerId); this.svg.classList.add('dragging'); });
    this.svg.addEventListener('pointermove', e => { if (!drag) return; this.view.x = drag.vx + e.clientX - drag.x; this.view.y = drag.vy + e.clientY - drag.y; this.applyView(); });
    const end = () => { drag = null; this.svg.classList.remove('dragging'); };
    this.svg.addEventListener('pointerup', end); this.svg.addEventListener('pointercancel', end);
    this.svg.addEventListener('wheel', e => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.12 : .89, e.offsetX, e.offsetY); }, { passive: false });
    $('#zoomIn').onclick = () => this.zoom(1.2); $('#zoomOut').onclick = () => this.zoom(.83); $('#zoomFit').onclick = () => this.fit();
    $('#btnExpandAll').onclick = () => { StoryGraph.expandAll(); GraphView.render(); };
    $('#btnAnalyze').onclick = () => Suggestions.analyze();
  },
  reset() { this._fitted = false; },
  fitOnce() { if (!this._fitted) this.fit(); },
  zoom(f, cx, cy) {
    const b = this.svg.getBoundingClientRect(); cx ??= b.width / 2; cy ??= b.height / 2;
    const k = Math.max(.25, Math.min(2.5, this.view.k * f)), r = k / this.view.k;
    this.view.x = cx - (cx - this.view.x) * r; this.view.y = cy - (cy - this.view.y) * r; this.view.k = k; this.applyView();
  },
  fit() {
    const b = this.svg.getBoundingClientRect(); const ps = Object.values(this.pos); if (!ps.length || !b.width) return;
    const w = Math.max(...ps.map(p => p.x)) + this.W + 40, h = Math.max(...ps.map(p => p.y)) + this.H + 40;
    const k = Math.max(.65, Math.min(1.2, b.width / w, b.height / h)); this.view = { k, x: 20 * k, y: Math.max(10, (b.height - h * k) / 2) }; this._fitted = true;
    if (w * k > b.width) this.focus(this._sel); else this.applyView();
  },
  focus(id) {                                                         // centre one node in the viewport
    const p = this.pos[id], b = this.svg.getBoundingClientRect(); if (!p || !b.width) return this.applyView();
    this.view.x = b.width / 2 - (p.x + this.W / 2) * this.view.k; this.view.y = b.height / 2 - (p.y + this.H / 2) * this.view.k; this.applyView();
  },
  applyView() { this.g && this.g.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`); },
  layout(g) {
    this.pos = {}; let row = 0;
    const walk = (id, d) => {
      const n = g.nodes[id], kids = n.collapsed ? [] : n.children;
      if (!kids.length) { this.pos[id] = { x: d * this.GX, y: row++ * this.GY }; return; }
      kids.forEach(k => walk(k, d + 1));
      this.pos[id] = { x: d * this.GX, y: (this.pos[kids[0]].y + this.pos[kids[kids.length - 1]].y) / 2 };
    };
    walk(g.rootId, 0);
  },
  render(g, ctx) {
    const NS = 'http://www.w3.org/2000/svg', N = g.nodes;
    const mk = (t, a = {}, txt) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; return e; };
    this.layout(g); this.svg.replaceChildren(); this.g = mk('g'); this.svg.append(this.g);
    const sel = g.selected, hasSel = !!N[sel], rel = hasSel ? StoryGraph.neighbors(g, sel) : new Set();
    const links = mk('g'), edges = mk('g'), nodes = mk('g'); this.g.append(links, edges, nodes);
    const seen = new Set();
    for (const e of g.edges) {
      const a = this.pos[e.source], b = this.pos[e.target]; if (!a || !b) continue;
      const hl = e.source === sel || e.target === sel;
      if (e.kind === 'child') {
        const x1 = a.x + this.W, y1 = a.y + this.H / 2, x2 = b.x, y2 = b.y + this.H / 2, mx = (x1 + x2) / 2;
        edges.append(mk('path', { class: 'edge' + (hl ? ' hl' : ''), d: `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}` }));
      } else {
        const key = [e.source, e.target].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
        const x1 = a.x + this.W / 2, y1 = a.y + this.H, x2 = b.x + this.W / 2, y2 = b.y;
        links.append(mk('path', { class: 'rel' + (hl ? ' hl' : ''), d: `M${x1} ${y1}Q${(x1 + x2) / 2 + 60} ${(y1 + y2) / 2} ${x2} ${y2}` }));
      }
    }
    for (const id in this.pos) {
      const n = N[id], p = this.pos[id], T = NODE_TYPES[n.type], O = ORIGIN[n.origin];
      const gEl = mk('g', { class: 'node' + (id === sel ? ' sel' : '') + (hasSel && !rel.has(id) ? ' dim' : ''), 'data-origin': n.origin, 'data-id': id, transform: `translate(${p.x} ${p.y})`, tabindex: 0, role: 'button', 'aria-label': `${T.label}: ${n.label}. ${O.tag}` });
      gEl.append(mk('rect', { class: 'body', width: this.W, height: this.H, rx: 12 }));
      gEl.append(mk('text', { class: 'gl', x: 11, y: 31 }, T.glyph));
      gEl.append(mk('text', { class: 'ty', x: 32, y: 16 }, T.label));
      const title = n.label.length > 17 ? n.label.slice(0, 16) + '…' : n.label;
      gEl.append(mk('text', { class: 'ti', x: 32, y: 31 }, title || '(untitled)'));
      gEl.append(mk('text', { class: 'og', x: 32, y: 43 }, O.short));
      if (n.children.length) { const f = mk('text', { class: 'fold', x: this.W - 16, y: 20 }, n.collapsed ? '▸' : '▾'); f.addEventListener('click', e => { e.stopPropagation(); ctx.onToggle(id); }); gEl.append(f); }
      const pick = () => ctx.onSelect(id);
      gEl.addEventListener('click', pick); gEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      nodes.append(gEl);
    }
    this.applyView();
    const moved = this._sel !== sel; this._sel = sel;
    if (!this._fitted && this.svg.getBoundingClientRect().width) this.fit(); else if (moved) this.focus(sel);
  }
};
GraphView.impl = TreeView;   // ← swap this line to change the visualisation (init runs on DOMContentLoaded)

/* ----------------------------- Inspector ---------------------------- */
const SCHEMAS = {
  character: [['role', 'Role'], ['description', 'Description', 'area'], ['personality', 'Personality', 'area'], ['goals', 'Goals', 'area'], ['relationships', 'Relationships', 'area'], ['secrets', 'Secrets', 'area'], ['known', 'Known information', 'area'], ['unknown', 'Unknown information', 'area'], ['emotion', 'Current emotional state'], ['history', 'Character history', 'area']],
  event: [['description', 'Description', 'area'], ['characters', 'Characters involved'], ['location', 'Location'], ['timeline', 'Timeline position'], ['cause', 'Cause', 'area'], ['consequences', 'Consequences', 'area'], ['related', 'Related events']],
  twist: [['description', 'Twist', 'area'], ['why', 'Why AI suggested it', 'area'], ['related', 'Related characters'], ['foreshadowing', 'Foreshadowing', 'area'], ['affected', 'Affected events'], ['consequences', 'Possible consequences', 'area'], ['compatibility', 'Story compatibility', 'area']],
  _default: [['description', 'Description', 'area'], ['notes', 'Notes', 'area']]
};
const Inspector = {
  render() {
    const box = $('#inspector'), S = Store.s; const n = S && S.nodes[S.selected];
    if (!n) { box.innerHTML = '<p class="empty">Select a node in the graph to see its details.</p>'; return; }
    const O = ORIGIN[originKey(n)], T = NODE_TYPES[n.type];
    box.replaceChildren();
    const touch = debounce(() => Store.commit(), 600);
    const changed = () => { if (n.origin === 'ai') { n.origin = 'edited'; n.canon = true; this.render(); } Store.setDirty(true); touch(); GraphView.render(); UI.renderNav(); };
    box.append(el('div', { class: 'insp-head' }, [
      el('h2', { text: `${T.glyph} ${T.label[0]}${T.label.slice(1).toLowerCase()}` }),
      el('span', { class: 'badge ' + O.cls, text: O.tag })
    ]));
    const title = el('input', { value: n.title, 'aria-label': 'Title' }); title.addEventListener('input', () => { n.title = title.value; if (n.fromText) Structure.setText(n.id, title.value); if (n.id === S.rootId) { S.title = title.value; $('#storyTitle').value = title.value; UI.syncTitle(); } changed(); });
    box.append(el('label', {}, ['Name / title', title]));
    for (const [key, label, kind] of (SCHEMAS[n.type] || SCHEMAS._default)) {
      const f = el(kind === 'area' ? 'textarea' : 'input', { 'aria-label': label }); f.value = n.data[key] || '';
      f.addEventListener('input', () => { n.data[key] = f.value; changed(); }); box.append(el('label', {}, [label, f]));
    }
    if (n.type === 'event') {                                            // canon status + origin (read-only) per spec
      box.append(el('label', {}, ['Canon status', el('input', { value: n.origin === 'rejected' ? 'Rejected' : n.canon ? 'Canon' : 'Proposed — awaiting approval', readonly: '' })]));
    }
    if (n.type === 'twist' && !n.canon && n.origin !== 'rejected') {
      box.append(el('div', { class: 'row' }, [
        el('button', { class: 'btn small primary', text: 'Accept', onclick: () => this.accept(n) }),
        el('button', { class: 'btn small', text: 'Edit', onclick: () => box.querySelector('textarea')?.focus() }),
        el('button', { class: 'btn small danger', text: 'Reject', onclick: () => this.reject(n) }),
        el('button', { class: 'btn small needs-ai', text: 'Explore alternative', onclick: () => Suggestions.twist(n) })
      ]));
    } else if (n.origin === 'ai' && !n.canon) {
      box.append(el('div', { class: 'row' }, [
        el('button', { class: 'btn small primary', text: 'Accept', onclick: () => this.accept(n) }),
        el('button', { class: 'btn small danger', text: 'Reject', onclick: () => this.reject(n) })
      ]));
    } else if (n.origin === 'rejected') {
      box.append(el('button', { class: 'btn small', text: 'Restore as proposed', onclick: () => { n.origin = 'ai'; n.canon = false; this.after(); } }));
    }
    // relationships (constellation links)
    const rel = el('div', { class: 'chips' });
    n.links.forEach(l => Store.node(l) && rel.append(el('button', { class: 'chip x', title: 'Remove relationship', text: Store.node(l).title || '(untitled)', onclick: () => { n.links = n.links.filter(x => x !== l); this.after(); } })));
    const sel = el('select', { 'aria-label': 'Relate to another node' }, [el('option', { value: '', text: '+ relate to…' }), ...Object.values(S.nodes).filter(o => o.id !== n.id && !n.links.includes(o.id)).map(o => el('option', { value: o.id, text: `${NODE_TYPES[o.type].label} · ${o.title}` }))]);
    sel.onchange = () => { if (sel.value) { n.links.push(sel.value); this.after(); } };
    box.append(el('label', {}, ['Relationships (constellation lines)', rel, sel]));
    if (n.id !== S.rootId) box.append(el('button', { class: 'btn small danger', text: 'Delete item', onclick: () => { if (confirm(`Delete "${n.title}" and everything beneath it?`)) { Structure.unassignSubtree(n.id); Store.removeNode(n.id); Editor.afterEdit(); this.after(); } } }));
  },
  after() { Store.commit(); Store.setDirty(true); GraphView.render(); this.render(); UI.renderNav(); UI.setOnline(Api.online); },
  accept(n) { n.canon = true; this.after(); toast('Accepted into the story'); },
  reject(n) { n.origin = 'rejected'; n.canon = false; this.after(); toast('Rejected — kept in history, muted'); }
};

/* --------------------------- Suggestions ---------------------------- */
const AI_ACTIONS = [
  ['continue_scene', 'Continue scene'], ['improve_description', 'Improve description'], ['dialogue', 'Generate dialogue'], ['atmosphere', 'Add atmosphere'],
  ['character_reaction', 'Suggest character reaction'], ['foreshadowing', 'Suggest foreshadowing'], ['twist', 'Generate plot twist'], ['continuity', 'Find continuity conflict']
];
const Suggestions = {
  init() {
    const box = $('#aiActions');
    AI_ACTIONS.forEach(([k, l]) => box.append(el('button', { class: 'btn small needs-ai', text: l, onclick: () => this.run(k) })));
  },
  context() {
    const S = Store.s; return {
      story_id: S.id, title: S.title, settings: { genre: S.settings.genre, tone: S.settings.tone, pov: S.settings.pov },
      text: Editor.text(), tree: Object.values(S.nodes).map(n => ({ id: n.id, type: n.type, title: n.title, parent: n.parent, origin: n.origin, canon: n.canon, data: n.data, links: n.links })),
      selected_node: S.selected
    };
  },
  notice(msg) { const n = $('#aiStatus'); n.hidden = !msg; n.textContent = msg || ''; },
  offline(err) {
    const down = err === 'Backend unreachable' || err === 'Request timed out';
    this.notice(down ? `The AI backend isn't reachable (${err}). Your story is untouched. Start it at ${Api.base} and try again.` : `${err} Your story is untouched.`); UI.openSide('ai');
  },
  run(kind) {
    if (kind === 'continuity') return this.continuity();
    if (kind === 'twist') return this.twist();
    const r = Editor.range() || Editor.savedRange;
    const sel = r && !r.collapsed ? r.toString() : '';
    this.request(kind, { range: kind === 'continue_scene' ? null : (sel ? r.cloneRange() : null), text: sel });
  },
  /* kind: rewrite|expand|shorten|ai_suggest|continue_scene|… ; src: { range, text } */
  async request(kind, src) {
    this.notice('Asking the AI for a suggestion…'); UI.openSide('ai');
    const res = await Api.suggest({ ...this.context(), action: kind, selection: src.text || '' });
    if (!res.ok) return this.offline(res.error);
    const list = res.data?.suggestions || []; if (!list.length) return this.notice('The AI returned no suggestions.');
    this.notice('');
    list.forEach(s => this.add({ kind, original: src.text || '', text: s.text, why: s.rationale || '', range: src.range }));
  },
  add({ kind, original, text, why, range, sample }) {
    const rec = { id: uid(), kind, original, text, why, status: 'pending', sample: !!sample, at: Date.now() };
    rec.range = range || null;                                           // live Range: follows later edits (not persisted)
    Store.s.suggestions.unshift(rec); this.render(); this.review(rec); return rec;
  },
  review(rec) {
    Review.show({
      title: (rec.sample ? '[SAMPLE — NOT AI] ' : '') + (AI_ACTIONS.find(a => a[0] === rec.kind)?.[1] || humanKind(rec.kind)),
      why: rec.why, original: rec.original, suggestion: rec.text,
      onAccept: (t, edited) => { Editor.insertAi(t, { range: rec.range, original: rec.original, edited }); rec.status = edited ? 'accepted (edited)' : 'accepted'; this.render(); toast('Accepted into your story'); },
      onReject: () => { rec.status = 'rejected'; this.render(); toast('Rejected — kept in suggestion history'); }
    });
  },
  render() {
    const P = $('#aiPending'), H = $('#aiHistory'); P.replaceChildren(); H.replaceChildren();
    const list = Store.s?.suggestions || [];
    const pend = list.filter(s => s.status === 'pending'), hist = list.filter(s => s.status !== 'pending');
    if (!pend.length) P.append(el('p', { class: 'empty', text: 'Nothing waiting. Suggestions only appear when you ask for them, and never change your story until you accept.' }));
    pend.forEach(s => P.append(this.card(s, true)));
    if (!hist.length) H.append(el('p', { class: 'empty', text: 'Accepted and rejected suggestions are kept here.' }));
    hist.slice(0, 30).forEach(s => H.append(this.card(s, false)));
  },
  card(s, pending) {
    const c = el('div', { class: 'card' + (s.status === 'rejected' ? ' rejected' : '') }, [
      el('div', { class: 'kind', text: `${s.status === 'rejected' ? '✕' : s.status.startsWith('accepted') ? '✓' : '◆'} ${(s.sample ? 'SAMPLE · ' : '')}${humanKind(s.kind)} · ${pending ? 'AI PROPOSED' : s.status.startsWith('accepted') ? 'HUMAN ' + s.status.toUpperCase() : s.status.toUpperCase()}` }),
      el('p', { text: s.text.length > 160 ? s.text.slice(0, 160) + '…' : s.text })
    ]);
    if (pending) c.append(el('div', { class: 'row' }, [el('button', { class: 'btn small primary', text: 'Compare', onclick: () => this.review(s) })]));
    else if (s.status === 'rejected') c.append(el('div', { class: 'row' }, [el('button', { class: 'btn small', text: 'Reconsider', onclick: () => { s.status = 'pending'; this.render(); this.review(s); } })]));
    return c;
  },
  async continuity() {
    this.notice('Checking continuity…'); UI.openSide('ai');
    const res = await Api.continuity(this.context()); if (!res.ok) return this.offline(res.error);
    const conflicts = res.data?.conflicts || []; this.notice(conflicts.length ? '' : 'No continuity conflicts reported.');
    const P = $('#aiPending'); if (conflicts.length) P.querySelectorAll('.empty').forEach(e => e.remove());
    conflicts.forEach(c => {
      const card = el('div', { class: 'card' }, [el('div', { class: 'kind', text: '◆ CONTINUITY CONFLICT' }), el('p', { text: c.issue }), el('p', { class: 'muted', text: c.detail || '' })]);
      (c.node_ids || []).filter(id => Store.node(id)).forEach(id => card.append(el('button', { class: 'chip', text: Store.node(id).title, onclick: () => UI.select(id, true) })));
      P.prepend(card);
    });
  },
  /* Plot twist → proposed TWIST node in the tree (never in the text) */
  async twist(from) {
    this.notice('Asking for a twist…'); UI.openSide('ai');
    const res = await Api.twist({ ...this.context(), alternative_to: from ? { id: from.id, title: from.title, data: from.data } : null });
    if (!res.ok) return this.offline(res.error);
    const t = res.data?.twist; if (!t) return this.notice('No twist returned.'); this.notice('');
    const parent = from ? from.parent : (Store.node(Store.s.selected)?.type === 'chapter' ? Store.s.selected : Store.s.rootId);
    const n = Store.addNode('twist', t.title || 'Twist', parent, { origin: 'ai', canon: false, data: { description: t.description, why: t.why, related: t.related, foreshadowing: t.foreshadowing, affected: t.affected, consequences: t.consequences, compatibility: t.compatibility } });
    Inspector.after(); UI.select(n.id, true); toast('Twist proposed — awaiting your decision');
  },
  async analyze() {
    toast('Analyzing text…'); const res = await Api.analyze(this.context()); if (!res.ok) return this.offline(res.error);
    const items = res.data?.nodes || []; if (!items.length) return toast('Nothing new found');
    items.forEach(i => NODE_TYPES[i.type] && Store.addNode(i.type, i.title || 'Untitled', Store.node(i.parent_id) ? i.parent_id : Store.s.selected, { origin: 'ai', canon: false, data: i.data || {}, links: (i.links || []).filter(l => Store.node(l)) }));
    Inspector.after(); toast(`${items.length} node(s) proposed — review them in the tree`);
  }
};

/* ------------------------------ Review ------------------------------ */
const Review = {
  cb: null,
  init() {
    const dlg = $('#reviewDlg'), sug = $('#reviewSuggestion'); let edited = false;
    this.edited = () => edited;
    $('#rvEdit').onclick = () => { edited = true; sug.contentEditable = 'true'; sug.focus(); $('#rvAccept').textContent = 'Accept edited'; };
    $('#rvAccept').onclick = () => { const t = sug.innerText.trim(); if (!t) return; dlg.close(); this.cb?.onAccept(t, edited); };
    $('#rvReject').onclick = () => { dlg.close(); this.cb?.onReject(); };
    $('#rvLater').onclick = () => dlg.close();
    this.reset = () => { edited = false; sug.contentEditable = 'false'; $('#rvAccept').textContent = 'Accept'; };
  },
  show({ title, why, original, suggestion, onAccept, onReject }) {
    this.cb = { onAccept, onReject }; this.reset();
    $('#reviewTitle').textContent = title; $('#reviewWhy').textContent = why || '';
    $('#reviewOriginal').textContent = original || '(nothing — this would be new text)'; $('#reviewSuggestion').textContent = suggestion;
    const d = $('#reviewDlg'); if (!d.open) d.showModal();
  }
};

/* ------------------------------- Voice ------------------------------
   States: IDLE · LISTENING · PROCESSING · TRANSCRIBED · ERROR.
   TRANSCRIBED is only ever shown after the backend actually returned text. */
const Voice = {
  state: 'IDLE', rec: null, chunks: [], stream: null, ctx: null, an: null, raf: 0,
  STATES: {
    IDLE:        ['Speak', 'Tap the microphone and say your idea'],
    LISTENING:   ['Listening...', 'Tap again when you are done'],
    PROCESSING:  ['Processing...', 'Sending your recording for transcription'],
    TRANSCRIBED: ['Transcribed', 'Review the raw text below — nothing has been added to your story yet'],
    ERROR:       ['Try Again', 'Something went wrong']
  },
  init() {
    $('#mic').onclick = () => (this.state === 'LISTENING' ? this.stop() : this.state === 'PROCESSING' ? null : this.start());
    $('#btnTypeRaw').onclick = () => { this.showRaw(''); $('#rawText').focus(); };
    $('#btnDiscardRaw').onclick = () => { $('#rawBox').hidden = true; $('#rawText').value = ''; this.set('IDLE'); };
    $('#btnUseRaw').onclick = () => { const t = $('#rawText').value.trim(); if (!t) return; Editor.insertHuman(t); $('#rawBox').hidden = true; $('#rawText').value = ''; this.set('IDLE'); toast('Added to your story as your own words'); };
    $('#btnImprove').onclick = async () => {
      const t = $('#rawText').value.trim(); if (!t) return; Suggestions.notice('Improving your raw idea…');
      const res = await Api.suggest({ ...Suggestions.context(), action: 'improve_voice', selection: t });
      if (!res.ok) { Suggestions.offline(res.error); return toast('AI unavailable — your raw text is kept'); }
      const list = res.data?.suggestions || []; if (!list.length) return toast('No suggestion returned');
      Suggestions.notice(''); $('#rawBox').hidden = true;
      list.forEach(s => Suggestions.add({ kind: 'improve_voice', original: t, text: s.text, why: s.rationale || '', range: Editor.savedRange ? Editor.savedRange.cloneRange() : null }));
    };
  },
  set(s, detail) {
    this.state = s; const [main, sub] = this.STATES[s]; const mic = $('#mic');
    mic.dataset.state = s; mic.setAttribute('aria-pressed', s === 'LISTENING'); mic.setAttribute('aria-label', main.replace('...', ''));
    $('#micMain').textContent = main; $('#micSub').textContent = detail || sub;
    $('#levels').classList.toggle('on', s === 'LISTENING');
  },
  showRaw(t) { $('#rawBox').hidden = false; $('#rawText').value = t; },
  async start() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { this.set('ERROR', 'This browser can’t record audio. You can type your idea instead.'); return this.showRaw(''); }
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { this.set('ERROR', 'Microphone permission was denied. Allow it in the address bar, or type instead.'); return this.showRaw(''); }
    this.chunks = []; this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => this.finish();
    this.rec.start(); this.set('LISTENING');
    this.ctx = new (window.AudioContext || window.webkitAudioContext)(); const src = this.ctx.createMediaStreamSource(this.stream);
    this.an = this.ctx.createAnalyser(); this.an.fftSize = 128; src.connect(this.an); const data = new Uint8Array(this.an.frequencyBinCount), bars = $$('#levels i');
    const tick = () => { this.an.getByteFrequencyData(data); bars.forEach((b, i) => { const v = data[i * 3 + 2] / 255; b.style.height = 4 + v * 26 + 'px'; }); this.raf = requestAnimationFrame(tick); }; tick();
  },
  stop() { try { this.rec.stop(); } catch {} cancelAnimationFrame(this.raf); this.stream?.getTracks().forEach(t => t.stop()); this.ctx?.close(); $$('#levels i').forEach(b => (b.style.height = '4px')); this.set('PROCESSING'); },
  async finish() {
    const blob = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' });
    const res = await Api.transcribe(blob, Store.s.settings.lang);
    if (res.ok && res.data?.text) { this.showRaw(res.data.text); this.set('TRANSCRIBED'); }
    else if (res.ok) { this.set('ERROR', 'No speech was detected. Tap to try again.'); this.showRaw(''); }
    else {
      const off = res.error === 'Backend unreachable';
      this.set('ERROR', off ? 'Transcription isn’t connected yet — your recording was not transcribed. You can type your idea instead.' : `${res.error.replace(/[.\s]*$/, '')}. Tap to try again.`); this.showRaw('');
    }
  }
};

/* ----------------------------- Versions ----------------------------- */
const Versions = {
  list: () => lsGet(LS_VER, []),
  snapshot(label) {
    const v = this.list(); v.unshift({ id: uid(), at: Date.now(), label: label || '', html: Editor.html(), nodes: Store.s.nodes, title: Store.s.title, words: Editor.text().split(/\s+/).filter(Boolean).length });
    if (v.length > 30) v.length = 30; if (!lsSet(LS_VER, v)) toast('Version storage is full — delete old versions.'); this.render();
  },
  render() {
    const ul = $('#verList'); ul.replaceChildren(); const v = this.list();
    if (!v.length) ul.append(el('li', {}, 'No versions yet. Versions are also saved automatically before a restore.'));
    v.forEach(x => ul.append(el('li', {}, [
      el('div', { class: 'm' }, [el('b', { text: x.label || 'Version' }), el('div', { class: 'muted', text: `${new Date(x.at).toLocaleString()} · ${x.words} words` })]),
      el('button', { type: 'button', class: 'btn small', text: 'Restore', onclick: () => { this.snapshot('Auto — before restore'); Store.s.nodes = x.nodes; Store.s.selected = Store.s.rootId; Editor.setHtml(x.html); GraphView.render(); Inspector.render(); UI.renderNav(); Store.commit(); Store.setDirty(true); toast('Version restored'); $('#versionsDlg').close(); } }),
      el('button', { type: 'button', class: 'btn small danger', text: '✕', 'aria-label': 'Delete version', onclick: () => { lsSet(LS_VER, this.list().filter(y => y.id !== x.id)); this.render(); } })
    ])));
  }
};

/* ------------------------------ Export ------------------------------ */
const Exporter = {
  /* the page as blocks: { kind: 'chapter'|'scene'|'p', text } */
  blocks(marks) {
    return [...Editor.ed.children].map(b => {
      const c = b.cloneNode(true); if (marks) c.querySelectorAll('.ai-text').forEach(sp => (sp.textContent = `⟦AI: ${sp.textContent}⟧`));
      return { kind: b.dataset.sf || 'p', text: c.textContent.replace(/\s+/g, ' ').trim() };
    }).filter(b => b.text);
  },
  counts() { const N = Object.values(Store.s.nodes); return { ch: N.filter(n => n.type === 'chapter').length, sc: N.filter(n => n.type === 'scene').length, words: Editor.text().split(/\s+/).filter(Boolean).length }; },
  ext: { json: 'storyforge.json', md: 'md', txt: 'txt', html: 'html', pdf: 'pdf' },
  build(fmt, marks) {
    const title = Store.s.title || 'Untitled story', B = this.blocks(marks);
    if (fmt === 'json') return JSON.stringify(Persist.pack(), null, 2);
    if (fmt === 'md') return `# ${title}\n\n` + B.map(b => b.kind === 'chapter' ? `## ${b.text}` : b.kind === 'scene' ? `### ${b.text}` : b.text.replace(/^#/, '\\#')).join('\n\n') + '\n';
    if (fmt === 'html') {
      const body = B.map(b => { const t = esc(b.text).replace(/⟦AI: ([\s\S]*?)⟧/g, '<span class="ai">$1</span>'); return b.kind === 'chapter' ? `<h2>${t}</h2>` : b.kind === 'scene' ? `<h3>${t}</h3>` : `<p>${t}</p>`; }).join('\n');
      const book = JSON.stringify(Persist.pack()).replace(/</g, '\\u003c');
      return `<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>${esc(title)}</title>\n<style>body{font:19px/1.8 Georgia,serif;max-width:38em;margin:3em auto;padding:0 1em;color:#222}h1,h2{font-weight:700}h3{font-weight:400;font-size:1em;margin:1.6em 0 .4em}.ai{background:#eee4ff}</style>\n<body><h1>${esc(title)}</h1>\n${body}\n<script type="application/json" id="storyforge-book">${book}</script>\n</body></html>\n`;
    }
    return `${title.toUpperCase()}\n\n` + B.map(b => b.kind === 'chapter' ? `\n${b.text.toUpperCase()}\n` : b.text).join('\n\n') + '\n';
  },
  help: {
    json: 'Your whole book in one file: text, chapters, scenes, graph notes, relationships and suggestion history. Open it again with Import book and everything comes back exactly as you left it.',
    md: 'Plain text you can read anywhere. Chapters are “##” lines and scenes are “###” lines, so Import book restores the chapters and scenes. Graph notes and relationships are not included.',
    html: 'A page you can open in any browser or print. It also carries your whole book inside, so Import book can restore everything from it.',
    txt: 'A simple reading copy with no structure. It cannot be imported back with chapters — use the book file or Markdown for that.',
    pdf: 'A print-ready copy made by the backend (the backend must be running).'
  },
  preview() {
    const f = $('#expFormat').value, marks = $('#expMarks').checked, c = this.counts();
    $('#expPreview').textContent = f === 'json' ? `Story Forge book file\n\n“${Store.s.title || 'Untitled story'}”\n${c.ch} chapter${c.ch === 1 ? '' : 's'} · ${c.sc} scene${c.sc === 1 ? '' : 's'} · ${c.words} words\n\n${this.help.json}` : f === 'pdf' ? this.build('txt', marks) : this.build(f, marks).replace(/<script[\s\S]*?<\/script>/, '').slice(0, 4000);
    const h = $('#expHelp'); if (h) h.textContent = this.help[f];
  },
  async download() {
    const f = $('#expFormat').value, marks = $('#expMarks').checked, msg = $('#expMsg'); msg.hidden = true;
    if (f === 'json') { await Persist.saveToComputer(); return; }
    let blob;
    if (f === 'pdf') {
      const res = await Api.exportPdf({ story_id: Store.s.id, title: Store.s.title, text: this.build('txt', marks), blocks: this.blocks(marks), mark_ai: marks });
      if (!res.ok) { msg.hidden = false; msg.textContent = `PDF export needs the backend (${res.error}). Export Markdown or the book file now, or start the server and try again.`; return; }
      blob = res.data;
    } else blob = new Blob([this.build(f, marks)], { type: f === 'html' ? 'text/html' : 'text/plain' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${Persist.slug()}.${this.ext[f]}` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
};

/* --------------------------------- UI -------------------------------- */
const UI = {
  init() {
    $('#btnBegin').onclick = () => this.enter(newStory());
    $('#btnContinue').onclick = () => { const s = lsGet(LS_KEY, null); if (s) this.enter(s); };
    $('#btnContinue').hidden = !lsGet(LS_KEY, null);
    const menu = $('#moreMenu'), mbtn = $('#btnMore'); const closeMenu = () => { menu.hidden = true; mbtn.setAttribute('aria-expanded', 'false'); };
    mbtn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; mbtn.setAttribute('aria-expanded', String(!menu.hidden)); };
    menu.addEventListener('click', e => { if (e.target.closest('button')) closeMenu(); });
    document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenu(); });
    $('#btnHome').onclick = () => { if (Store.dirty && !confirm('You have unsaved changes. Leave anyway?')) return; this.leave(); };
    $('#btnSave').onclick = () => Store.save();
    $('#btnSaveFile').onclick = () => Persist.saveToComputer();
    const pick = () => $('#fileImport').click();
    $('#btnImport').onclick = pick; $('#btnImportLanding').onclick = pick;
    $('#fileImport').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { this.adopt(await Persist.importFile(f)); } catch (err) { toast(err.message || 'Could not read that file.', 5200); }
    };
    $('#btnExport2').onclick = () => $('#btnExport').click();
    $('#btnOpenDetails').onclick = () => this.tab('inspect');
    $('#btnPanel').onclick = () => {
      if (innerWidth <= 1200) return this.openSide($('#side').dataset.tab || 'tree');
      const ws = $('#workspace'), hide = !ws.classList.contains('no-side'); ws.classList.toggle('no-side', hide); $('#btnPanel').setAttribute('aria-pressed', !hide);
      try { localStorage.setItem('storyforge.sideHidden', hide ? '1' : '0'); } catch {}
      setTimeout(() => GraphView.fit(), 50);
    };
    $('#btnUndo').onclick = () => Store.undo(); $('#btnRedo').onclick = () => Store.redo();
    $('#btnVersions').onclick = () => { Versions.render(); $('#versionsDlg').showModal(); };
    $('#btnSnap').onclick = () => { Versions.snapshot($('#verLabel').value.trim()); $('#verLabel').value = ''; };
    $('#btnExport').onclick = () => { $('#expMsg').hidden = true; Exporter.preview(); $('#exportDlg').showModal(); };
    $('#expFormat').onchange = $('#expMarks').onchange = () => Exporter.preview(); $('#btnDoExport').onclick = () => Exporter.download();
    $('#btnSettings').onclick = () => this.openSettings();
    $('#storyTitle').addEventListener('input', e => { UI.syncTitle(); const S = Store.s; S.title = e.target.value; S.nodes[S.rootId].title = e.target.value || 'Untitled story'; Store.setDirty(true); GraphView.render(); UI.renderNav(); });
    $('#storyTitle').addEventListener('change', () => Store.commit());
    $('#btnAddNode').onclick = () => { const S = Store.s, t = $('#addType').value; const n = Store.addNode(t, `New ${NODE_TYPES[t].label.toLowerCase()}`, S.selected); Inspector.after(); this.select(n.id, innerWidth <= 1200); };
    $$('.tab').forEach(t => t.onclick = () => this.tab(t.dataset.tab));
    $('#btnTreeToggle').onclick = () => this.openSide('tree'); $('#btnAiToggle').onclick = () => this.openSide('ai');
    $('#btnSideClose').onclick = () => this.closePanels(); $('#btnNavToggle').onclick = () => this.togglePanel('#nav'); $('#btnNavClose').onclick = () => this.closePanels();
    $('#scrim').onclick = () => this.closePanels();
    document.addEventListener('keydown', e => {
      if ($('#app').hidden || document.querySelector('dialog[open]')) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 's' && e.shiftKey) { e.preventDefault(); Persist.saveToComputer(); }
      else if (mod && k === 's') { e.preventDefault(); Store.save(); }
      else if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); Store.undo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); Store.redo(); }
      else if (k === 'escape') this.closePanels();
    });
    addEventListener('beforeunload', e => { if (Store.s && Store.dirty) { e.preventDefault(); e.returnValue = ''; } });
    setInterval(() => this.ping(), 20000);
  },
  updateStrip() {
    const n = Store.s?.nodes[Store.s.selected]; if (!n) return;
    $('#selName').textContent = `${NODE_TYPES[n.type].label[0]}${NODE_TYPES[n.type].label.slice(1).toLowerCase()} · ${n.title || 'untitled'} · ${ORIGIN[originKey(n)].tag}`;
  },
  syncTitle() {
    const t = $('#storyTitle').value.trim(), h = $('#pageTitle'); h.textContent = t || 'Untitled story'; h.classList.toggle('is-placeholder', !t);
  },
  adopt(story) {                                                       // open an imported book
    if (Store.s && !$('#app').hidden && Editor.text()) {
      if (!confirm(`Open “${story.title || 'Untitled story'}”?\n\nThe story you are editing now is saved as a version first, so you can get it back from Version history.`)) return;
      Versions.snapshot('Auto — before import');
    }
    Persist.handle = null; this.enter(story); Store.save(true);
    const N = Object.values(story.nodes), c = N.filter(n => n.type === 'chapter').length, s = N.filter(n => n.type === 'scene').length;
    toast(`Imported “${story.title || 'Untitled story'}” — ${c} chapter${c === 1 ? '' : 's'}, ${s} scene${s === 1 ? '' : 's'}`, 4200);
  },
  enter(story) {
    Store.s = story; if (!story.suggestions) story.suggestions = [];
    const land = $('#landing'); land.classList.add('leaving'); $('#app').hidden = false; $('#app').classList.add('entering');
    document.body.classList.remove('view-landing'); setTimeout(() => { land.hidden = true; land.classList.remove('leaving'); $('#app').classList.remove('entering'); }, 520);
    Editor.setHtml(story.html); Structure.sync(); Store.init(story);
    $('#storyTitle').value = story.title || ''; this.syncTitle(); try { const hid = localStorage.getItem('storyforge.sideHidden') === '1'; $('#workspace').classList.toggle('no-side', hid); $('#btnPanel').setAttribute('aria-pressed', !hid); } catch {} $('#chkMarks').checked = story.settings.marks !== false; document.body.classList.toggle('hide-marks', story.settings.marks === false);
    GraphView.reset(); this.select(story.selected || story.rootId, false); GraphView.render(); Suggestions.render(); Inspector.render(); this.renderNav(); this.syncUndo(); this.ping();
    requestAnimationFrame(() => GraphView.fit()); Editor.ed.focus();
  },
  leave() { if (Store.s) Store.save(true); document.body.classList.add('view-landing'); $('#app').hidden = true; $('#landing').hidden = false; $('#landing').classList.remove('leaving'); $('#btnContinue').hidden = !lsGet(LS_KEY, null); this.closePanels(); Sky.loop(); },
  select(id, show, jump) {
    const S = Store.s; if (!S.nodes[id]) return; S.selected = id; this.updateStrip(); GraphView.render(); Inspector.render(); this.renderNav();
    let jumped = false;
    if (jump && id === S.rootId) { $('#paper').scrollTo({ top: 0, behavior: 'smooth' }); jumped = true; }
    else if (jump && S.nodes[id].fromText) jumped = Structure.jumpTo(id);
    if (jumped) { if (innerWidth <= 1200) this.closePanels(); } else if (show) this.openSide('inspect');
  },
  tab(name) {
    $('#side').dataset.tab = name; $$('.tab').forEach(t => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
    $('#panelTree').hidden = name !== 'tree'; $('#panelAi').hidden = name !== 'ai'; $('#panelInspect').hidden = name !== 'inspect';
    if (name === 'tree') requestAnimationFrame(() => { GraphView.fitOnce(); });
  },
  openSide(tab) { this.tab(tab); if (innerWidth <= 1200) { $('#side').classList.add('open'); $('#scrim').hidden = false; } },
  togglePanel(sel) { const p = $(sel), open = !p.classList.contains('open'); this.closePanels(); if (open) { p.classList.add('open'); $('#scrim').hidden = false; } },
  closePanels() { $('#side').classList.remove('open'); $('#nav').classList.remove('open'); $('#scrim').hidden = true; },
  renderNav() {
    const ul = $('#navList'), S = Store.s; if (!S) return; ul.replaceChildren();
    if (Object.keys(S.nodes).length <= 1) { ul.append(el('li', { class: 'nav-empty' }, 'Chapters and scenes you mark on the page will be listed here.')); return; }
    const walk = (id, d) => {
      const n = S.nodes[id], T = NODE_TYPES[n.type], O = ORIGIN[originKey(n)];
      const b = el('button', { class: `nav-${n.type === 'chapter' || n.type === 'scene' || n.type === 'story' ? n.type : 'note'}` + (id === S.selected ? ' sel' : ''), style: `padding-left:${9 + d * 16}px`, title: n.fromText ? `Jump to this ${n.type}` : `${T.label} · ${O.tag}`, onclick: () => this.select(id, innerWidth <= 1200, true) },
        [el('span', { class: 'g', text: T.glyph }), el('span', { class: 't', text: n.title || '(untitled)' }), el('span', { class: 'muted', text: { human: '★', proposed: '◆', accepted: '✓', edited: '✎', rejected: '✕' }[originKey(n)] })]);
      ul.append(el('li', {}, b)); n.kids.forEach(k => walk(k, d + 1));
    };
    walk(S.rootId, 0);
  },
  syncUndo() { $('#btnUndo').disabled = Store.undoStack.length < 2; $('#btnRedo').disabled = !Store.redoStack.length; },
  setOnline(on) {                                                       // on = backend up AND its AI model ready
    Api.online = on;
    const why = Api.up ? (Api.aiDetail || 'The AI model isn’t ready.') : 'Needs the AI backend, which isn’t connected yet';
    $$('.needs-ai').forEach(b => { b.disabled = !on; b.title = on ? '' : why; });
    const off = $('#aiOffline'); if (off) { off.dataset.orig ||= off.textContent; off.textContent = Api.up ? `The backend is running, but the AI isn’t ready. ${Api.aiDetail || ''}` : off.dataset.orig; off.hidden = on; }
    const p = $('#apiStatus'); if (p) { const eng = Api.provider === 'ollama' ? 'Local' : (Api.label || 'Cloud'); p.textContent = on ? `● AI online · ${eng}` : Api.up ? `◐ ${eng} · AI not ready` : '○ AI offline'; p.title = (on ? `${eng} · model ${Api.model}. ` : why + ' ') + 'Click to switch AI.'; p.className = 'pill pill-btn ' + (on ? 'ok' : ''); }
  },
  async ping() {
    const r = await Api.health(), d = r.ok && r.data ? r.data : {};
    Api.up = r.ok; Api.aiDetail = d.ai?.detail || ''; Api.model = d.ai?.model || ''; Api.provider = d.ai?.provider || 'ollama'; Api.label = d.ai?.label || '';
    this.setOnline(!!d.ai?.ready);
  }
,
  openSettings() {
    const s = Store.s.settings; $('#setGenre').value = s.genre; $('#setTone').value = s.tone; $('#setPov').value = s.pov; $('#setLang').value = s.lang; $('#setApi').value = s.api; $('#setMotion').checked = s.reduceMotion;
    $('#settingsDlg').showModal();
  }
};

const AiDlg = {
  data: null, mode: 'local',
  msg(text, cls = '') { const m = $('#aiMsg'); m.textContent = text; m.className = 'muted ' + cls; },
  async open() {
    $('#aiDlg').showModal(); this.msg('');
    const r = await Api.getSettings(); this.data = r.ok ? r.data : null;
    if (!r.ok) this.msg(r.error === 'Backend unreachable' ? 'The backend isn’t running, so the AI can’t be switched. Start ./run.sh first.' : r.error, 'bad');
    const d = this.data; if (d) $('#aiProv').value = d.provider !== 'ollama' ? d.provider : d.last_cloud;
    this.setMode(d && d.provider !== 'ollama' ? 'cloud' : 'local');
  },
  setMode(m) {
    this.mode = m;
    $('#engLocal').setAttribute('aria-checked', m === 'local'); $('#engCloud').setAttribute('aria-checked', m === 'cloud');
    $('#aiLocalBox').hidden = m !== 'local'; $('#aiCloudBox').hidden = m !== 'cloud'; this.fill();
  },
  cur() { return this.mode === 'local' ? 'ollama' : $('#aiProv').value; },
  fill() {
    const d = this.data; if (!d) return; const prov = this.cur(), p = d.providers[prov];
    if (this.mode === 'local') { $('#aiLocalModel').value = p.model; $('#aiClear').hidden = true; return; }
    $('#aiModel').value = p.model; $('#aiBase').value = p.base_url; $('#aiBaseRow').hidden = prov !== 'openai'; $('#aiKey').value = '';
    $('#aiKey').placeholder = p.has_key ? `saved key ••••${p.key_hint}${p.from_env ? ' (from environment)' : ''} — leave blank to keep` : 'paste your key';
    $('#aiClear').hidden = !p.has_key || p.from_env;
    $('#aiKeyNote').textContent = { openai: 'For Groq, OpenRouter, etc. change the Base URL and model.', anthropic: 'Get a key at console.anthropic.com.', gemini: 'Get a key at aistudio.google.com.' }[prov];
  },
  async save() {
    const prov = this.cur(), body = { provider: prov };
    if (prov === 'ollama') body.model = $('#aiLocalModel').value.trim();
    else {
      body.model = $('#aiModel').value.trim(); if (prov === 'openai') body.base_url = $('#aiBase').value.trim();
      const k = $('#aiKey').value.trim(); if (k) body.api_key = k;
      if (!k && !this.data?.providers[prov]?.has_key) { this.msg('Paste your API key first.', 'bad'); return false; }
    }
    const r = await Api.putSettings(body);
    if (!r.ok) { this.msg(r.error, 'bad'); return false; }
    const g = await Api.getSettings(); if (g.ok) this.data = g.data; this.fill(); UI.ping();
    this.msg(`Saved. Now using ${this.data?.providers[prov]?.label || prov}.`, 'ok'); return true;
  },
  async test() {
    if (!(await this.save())) return;
    this.msg('Testing…'); const r = await Api.testAi();
    this.msg(r.ok ? `It works: ${r.data.model} answered.` : r.error, r.ok ? 'ok' : 'bad');
  },
  init() {
    $('#apiStatus').onclick = () => this.open();
    $('#engLocal').onclick = () => this.setMode('local'); $('#engCloud').onclick = () => this.setMode('cloud');
    $('#aiProv').onchange = () => this.fill();
    $('#aiSave').onclick = () => this.save(); $('#aiTest').onclick = () => this.test();
    $('#aiClear').onclick = async () => { const r = await Api.putSettings({ provider: this.cur(), clear_key: true }); if (r.ok) { const g = await Api.getSettings(); if (g.ok) this.data = g.data; this.fill(); UI.ping(); this.msg('Key forgotten.', 'ok'); } else this.msg(r.error, 'bad'); };
    $('#aiForm').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); this.save(); } });
  }
};

function wireSettings() {
  AiDlg.init();
  const map = { setGenre: 'genre', setTone: 'tone', setPov: 'pov', setLang: 'lang', setMotion: 'reduceMotion' };
  Object.entries(map).forEach(([id, key]) => $('#' + id).addEventListener('change', e => { Store.s.settings[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; Store.setDirty(true); if (key === 'reduceMotion') Sky.loop(); }));
  $('#setApi').addEventListener('change', e => { Store.s.settings.api = e.target.value.trim() || 'http://127.0.0.1:8000'; Api.base = Store.s.settings.api; Store.setDirty(true); UI.ping(); });
  if (new URLSearchParams(location.search).has('dev')) $('#devBox').hidden = false;
  $('#btnSampleNodes').onclick = () => {
    const S = Store.s, ch = S.nodes.c1 ? 'c1' : S.rootId;
    const c = Store.addNode('character', '[SAMPLE] The man in the black cloak', ch, { origin: 'ai', canon: false, data: { role: 'Wanderer', description: 'Sample node to preview AI-proposed styling.' } });
    const e = Store.addNode('event', '[SAMPLE] Standoff at the cliff', S.nodes.sc1 ? 'sc1' : ch, { origin: 'edited', canon: true, data: { description: 'Sample human-edited AI node.' }, links: [c.id] });
    Store.addNode('twist', '[SAMPLE] The cloak is empty', 'c2', { origin: 'ai', canon: false, data: { description: 'Sample twist — not generated by AI.', why: 'UI preview only.' }, links: [c.id, e.id] });
    Store.addNode('idea', '[SAMPLE] Rejected idea', ch, { origin: 'rejected', canon: false });
    Inspector.after(); toast('Sample nodes added'); $('#settingsDlg').close();
  };
  $('#btnSampleSuggestion').onclick = () => {
    $('#settingsDlg').close();
    Suggestions.add({ kind: 'improve_voice', sample: true, original: 'under blue sky man black cloak mountain', text: 'Under the blue sky, a man in a black cloak stood at the edge of a mountain cliff.', why: 'Sample text to preview the comparison view. Not AI output.', range: null });
  };
  $('#btnResetStory').onclick = () => { if (confirm('Reset the whole story? Saved versions are kept.')) { Versions.snapshot('Auto — before reset'); $('#settingsDlg').close(); UI.enter(newStory()); } };
}

document.addEventListener('DOMContentLoaded', () => {
  Sky.init(); Editor.init(); GraphView.init(); BlockMenu.init(); Suggestions.init(); Review.init(); Voice.init(); UI.init(); wireSettings();
  Voice.set('IDLE'); UI.setOnline(false); $('#btnContinue').hidden = !lsGet(LS_KEY, null);
  $('#side').dataset.tab = 'tree';
  addEventListener('resize', debounce(() => Store.s && GraphView.fit(), 250));
});

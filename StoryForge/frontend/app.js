/* =====================================================================
   STORY FORGE — frontend prototype (vanilla JS, no dependencies)
   Sections: Util · Api · Store · Sky · Editor · Tree · Inspector ·
             Suggestions · Review · Voice · Versions · Export · UI
   The human text is canonical. Nothing from the AI is written into the
   story until the user presses ACCEPT.
   ===================================================================== */
'use strict';

/* ------------------------------ Util ------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
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
  base: 'http://127.0.0.1:8000',
  async request(method, path, { json, form, raw, timeout = 30000 } = {}) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(this.base.replace(/\/$/, '') + path, {
        method, signal: ctl.signal,
        headers: json ? { 'Content-Type': 'application/json' } : undefined,
        body: json ? JSON.stringify(json) : form || undefined
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, data: raw ? await res.blob() : await res.json() };
    } catch (e) {
      return { ok: false, error: e.name === 'AbortError' ? 'Request timed out' : 'Backend unreachable' };
    } finally { clearTimeout(to); }
  },
  health:        ()          => Api.request('GET', '/health', { timeout: 3000 }),
  createStory:   (story)     => Api.request('POST', '/api/stories', { json: story }),
  getStory:      (id)        => Api.request('GET', `/api/stories/${encodeURIComponent(id)}`),
  transcribe:    (blob, lang) => { const f = new FormData(); f.append('audio', blob, 'voice.webm'); f.append('language', lang || 'en'); return Api.request('POST', '/api/transcribe', { form: f, timeout: 60000 }); },
  analyze:       (payload)   => Api.request('POST', '/api/story/analyze', { json: payload, timeout: 60000 }),
  suggest:       (payload)   => Api.request('POST', '/api/story/suggest', { json: payload, timeout: 60000 }),
  continuity:    (payload)   => Api.request('POST', '/api/story/continuity', { json: payload, timeout: 60000 }),
  twist:         (payload)   => Api.request('POST', '/api/story/twist', { json: payload, timeout: 60000 }),
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
const ORIGIN = {
  human:    { tag: '★ HUMAN',    cls: 'human' },
  ai:       { tag: '◆ AI',       cls: 'ai' },
  edited:   { tag: '✎ EDITED',   cls: 'edited' },
  rejected: { tag: '✕ REJECTED', cls: 'rejected' }
};
const LS_KEY = 'storyforge.story.v1', LS_VER = 'storyforge.versions.v1';

function newStory() {
  const mk = (id, type, title, parent) => ({ id, type, title, parent, kids: [], origin: 'human', canon: true, collapsed: false, data: {}, links: [] });
  const nodes = {};
  [['s', 'story', 'Untitled story', null], ['c1', 'chapter', 'Chapter 1', 's'], ['sc1', 'scene', 'Scene 1', 'c1'], ['c2', 'chapter', 'Chapter 2', 's']]
    .forEach(([id, t, ti, p]) => { nodes[id] = mk(id, t, ti, p); if (p) nodes[p].kids.push(id); });
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
    Editor.setHtml(o.h); Tree.render(); Inspector.render(); UI.renderNav(); this.restoring = false;
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
    this.setDirty(false); if (!silent) toast('Story saved locally'); return true;
    /* FUTURE: Api.updateStory(this.s.id, this.s) once the backend exists. */
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
    document.addEventListener('visibilitychange', () => document.hidden ? cancelAnimationFrame(this.raf) : this.loop());
    this.loop();
  },
  size() {
    const d = Math.min(devicePixelRatio || 1, 2); this.w = innerWidth; this.h = innerHeight;
    this.c.width = this.w * d; this.c.height = this.h * d; this.x.setTransform(d, 0, 0, d, 0, 0);
    const n = Math.round(this.w * this.h / 14000);
    this.stars = Array.from({ length: n }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, r: Math.random() * 1.3 + .3, p: Math.random() * 6.28 }));
    this.parts = Array.from({ length: 22 }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, vx: (Math.random() - .5) * .12, vy: -Math.random() * .1 - .02, r: Math.random() * 1.6 + .6 }));
  },
  loop(t = 0) {
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
    if (!still) this.raf = requestAnimationFrame(t2 => this.loop(t2));
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
      this.markEdited(); this.updateEmpty(); this.count(); Store.setDirty(true); commitSoon();
    });
    this.ed.addEventListener('paste', e => {                         // plain text only: never import foreign markup
      e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    document.addEventListener('selectionchange', () => this.onSelection());
    $('#selToolbar').addEventListener('mousedown', e => e.preventDefault());
    $('#selToolbar').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return; const act = b.dataset.act;
      const r = this.range(); if (!r || r.collapsed) return;
      if (act === 'delete') { r.deleteContents(); this.afterEdit(); $('#selToolbar').hidden = true; }
      else Suggestions.request(act === 'suggest' ? 'ai_suggest' : act, { range: r.cloneRange(), text: r.toString() });
    });
    $('#btnDelSentence').onclick = () => this.deleteSentence();
    $('#btnDelLine').onclick = () => this.deleteLine();
    $('#btnRestore').onclick = () => this.restoreOriginal();
    $('#chkMarks').onchange = e => { document.body.classList.toggle('hide-marks', !e.target.checked); Store.s.settings.marks = e.target.checked; };
  },
  html() { return this.ed.innerHTML; },
  setHtml(h) { this.ed.innerHTML = h || ''; this.updateEmpty(); this.count(); },
  text() { return this.ed.innerText.replace(/ /g, ' ').trim(); },
  updateEmpty() { this.ed.classList.toggle('is-empty', !this.ed.textContent.trim() && !this.ed.querySelector('img')); },
  count() { const w = this.text().split(/\s+/).filter(Boolean).length; $('#wordCount').textContent = `${w} word${w === 1 ? '' : 's'}`; },
  afterEdit() { this.updateEmpty(); this.count(); Store.commit(); Store.setDirty(true); },
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
    $('#btnRestore').disabled = !inAi;
  },
  aiSpanAt(n) { const e = n.nodeType === 3 ? n.parentElement : n; return e && e.closest ? e.closest('.ai-text') : null; },
  markEdited() {                                                       // typing inside an AI passage → "human-edited AI"
    const r = this.range(); const sp = r && this.aiSpanAt(r.startContainer);
    if (sp && sp.dataset.origin !== 'edited') sp.dataset.origin = 'edited';
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
  /* Replace/insert text as an AI passage. `original` is retained so the human text can be restored. */
  insertAi(text, { range, original = '', edited = false }) {
    const sp = el('span', { class: 'ai-text', 'data-origin': edited ? 'edited' : 'ai', 'data-original': original }, text);
    let r = range;
    if (!r || !this.ed.contains(r.commonAncestorContainer)) {
      r = document.createRange(); let p = this.ed.lastElementChild;
      if (!p) { p = el('p'); p.append(document.createElement('br')); this.ed.append(p); }
      r.selectNodeContents(p); r.collapse(false);
    }
    r.deleteContents();
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

/* ------------------------------- Tree ------------------------------- */
const Tree = {
  svg: null, g: null, view: { x: 40, y: 20, k: 1 }, pos: {}, W: 176, H: 54, GX: 198, GY: 74,
  init() {
    this.svg = $('#treeSvg');
    let drag = null;
    this.svg.addEventListener('pointerdown', e => { if (e.target.closest('.node')) return; drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y }; this.svg.setPointerCapture(e.pointerId); this.svg.classList.add('dragging'); });
    this.svg.addEventListener('pointermove', e => { if (!drag) return; this.view.x = drag.vx + e.clientX - drag.x; this.view.y = drag.vy + e.clientY - drag.y; this.applyView(); });
    const end = () => { drag = null; this.svg.classList.remove('dragging'); };
    this.svg.addEventListener('pointerup', end); this.svg.addEventListener('pointercancel', end);
    this.svg.addEventListener('wheel', e => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.12 : .89, e.offsetX, e.offsetY); }, { passive: false });
    $('#zoomIn').onclick = () => this.zoom(1.2); $('#zoomOut').onclick = () => this.zoom(.83); $('#zoomFit').onclick = () => this.fit();
    $('#btnExpandAll').onclick = () => { Object.values(Store.s.nodes).forEach(n => (n.collapsed = false)); this.render(); };
    $('#btnAnalyze').onclick = () => Suggestions.analyze();
  },
  zoom(f, cx, cy) {
    const b = this.svg.getBoundingClientRect(); cx ??= b.width / 2; cy ??= b.height / 2;
    const k = Math.max(.25, Math.min(2.5, this.view.k * f)), r = k / this.view.k;
    this.view.x = cx - (cx - this.view.x) * r; this.view.y = cy - (cy - this.view.y) * r; this.view.k = k; this.applyView();
  },
  fit() {
    const b = this.svg.getBoundingClientRect(); const ps = Object.values(this.pos); if (!ps.length || !b.width) return;
    const w = Math.max(...ps.map(p => p.x)) + this.W + 40, h = Math.max(...ps.map(p => p.y)) + this.H + 40;
    const k = Math.max(.6, Math.min(1.2, b.width / w, b.height / h)); this.view = { k, x: 20 * k, y: Math.max(10, (b.height - h * k) / 2) }; this.applyView();
  },
  applyView() { this.g && this.g.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`); },
  layout() {
    this.pos = {}; let row = 0; const N = Store.s.nodes;
    const walk = (id, d) => {
      const n = N[id], kids = n.collapsed ? [] : n.kids;
      if (!kids.length) { this.pos[id] = { x: d * this.GX, y: row++ * this.GY }; return; }
      kids.forEach(k => walk(k, d + 1));
      this.pos[id] = { x: d * this.GX, y: (this.pos[kids[0]].y + this.pos[kids[kids.length - 1]].y) / 2 };
    };
    walk(Store.s.rootId, 0);
  },
  related(id) {                                                         // ids related to a node (parent, kids, links)
    const N = Store.s.nodes, n = N[id], s = new Set([id]); if (!n) return s;
    if (n.parent) s.add(n.parent); n.kids.forEach(k => s.add(k)); n.links.forEach(l => s.add(l));
    Object.values(N).forEach(o => o.links.includes(id) && s.add(o.id)); return s;
  },
  render() {
    if (!Store.s) return; const NS = 'http://www.w3.org/2000/svg', S = Store.s, N = S.nodes;
    const mk = (t, a = {}, txt) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; return e; };
    this.layout(); this.svg.replaceChildren(); this.g = mk('g'); this.svg.append(this.g);
    const rel = this.related(S.selected), hasSel = !!N[S.selected];
    const edges = mk('g'), links = mk('g'), nodes = mk('g'); this.g.append(links, edges, nodes);
    for (const id in this.pos) {                                         // parent→child edges
      const n = N[id], p = this.pos[id];
      if (n.parent && this.pos[n.parent]) {
        const a = this.pos[n.parent], x1 = a.x + this.W, y1 = a.y + this.H / 2, x2 = p.x, y2 = p.y + this.H / 2, mx = (x1 + x2) / 2;
        edges.append(mk('path', { class: 'edge' + (hasSel && rel.has(id) && rel.has(n.parent) && (id === S.selected || n.parent === S.selected) ? ' hl' : ''), d: `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}` }));
      }
    }
    const seen = new Set();                                              // constellation links (non-tree relationships)
    for (const id in this.pos) for (const l of N[id].links) {
      const key = [id, l].sort().join('|'); if (seen.has(key) || !this.pos[l]) continue; seen.add(key);
      const a = this.pos[id], b = this.pos[l], x1 = a.x + this.W / 2, y1 = a.y + this.H, x2 = b.x + this.W / 2, y2 = b.y;
      const hl = id === S.selected || l === S.selected;
      links.append(mk('path', { class: 'rel' + (hl ? ' hl' : ''), d: `M${x1} ${y1}Q${(x1 + x2) / 2 + 60} ${(y1 + y2) / 2} ${x2} ${y2}` }));
    }
    for (const id in this.pos) {
      const n = N[id], p = this.pos[id], T = NODE_TYPES[n.type], O = ORIGIN[n.origin] || ORIGIN.human;
      const g = mk('g', { class: 'node' + (id === S.selected ? ' sel' : '') + (hasSel && !rel.has(id) ? ' dim' : ''), 'data-origin': n.origin, 'data-id': id, transform: `translate(${p.x} ${p.y})`, tabindex: 0, role: 'button', 'aria-label': `${T.label}: ${n.title}. ${O.tag}${n.origin === 'ai' ? (n.canon ? ', accepted' : ', proposed') : ''}` });
      g.append(mk('rect', { class: 'body', width: this.W, height: this.H, rx: 12 }));
      g.append(mk('text', { class: 'gl', x: 12, y: 33 }, T.glyph));
      g.append(mk('text', { class: 'ty', x: 34, y: 18 }, T.label));
      const title = n.title.length > 19 ? n.title.slice(0, 18) + '…' : n.title;
      g.append(mk('text', { class: 'ti', x: 34, y: 34 }, title || '(untitled)'));
      g.append(mk('text', { class: 'og', x: 34, y: 47 }, O.tag + (n.origin === 'ai' ? (n.canon ? ' · CANON' : ' · PROPOSED') : '')));
      if (n.kids.length) { const f = mk('text', { class: 'fold', x: this.W - 16, y: 20 }, n.collapsed ? '▸' : '▾'); f.addEventListener('click', e => { e.stopPropagation(); n.collapsed = !n.collapsed; this.render(); }); g.append(f); }
      const pick = () => UI.select(id, true);
      g.addEventListener('click', pick); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      nodes.append(g);
    }
    this.applyView();
    if (!this._fitted && this.svg.getBoundingClientRect().width) { this._fitted = true; this.fit(); }
  }
};

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
    if (!n) { box.innerHTML = '<p class="empty">Select a node in the Story Tree to inspect it.</p>'; return; }
    const O = ORIGIN[n.origin] || ORIGIN.human, T = NODE_TYPES[n.type];
    box.replaceChildren();
    const touch = debounce(() => Store.commit(), 600);
    const changed = () => { if (n.origin === 'ai') { n.origin = 'edited'; n.canon = true; this.render(); } Store.setDirty(true); touch(); Tree.render(); UI.renderNav(); };
    box.append(el('div', { class: 'insp-head' }, [
      el('h2', { text: `${T.glyph} ${T.label}` }),
      el('span', { class: 'badge ' + O.cls, text: O.tag + (n.origin === 'ai' ? (n.canon ? ' · CANON' : ' · PROPOSED') : '') })
    ]));
    const title = el('input', { value: n.title, 'aria-label': 'Title' }); title.addEventListener('input', () => { n.title = title.value; if (n.id === S.rootId) { S.title = title.value; $('#storyTitle').value = title.value; } changed(); });
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
        el('button', { class: 'btn small primary', text: 'ACCEPT', onclick: () => this.accept(n) }),
        el('button', { class: 'btn small', text: 'EDIT', onclick: () => box.querySelector('textarea')?.focus() }),
        el('button', { class: 'btn small danger', text: 'REJECT', onclick: () => this.reject(n) }),
        el('button', { class: 'btn small', text: 'EXPLORE ALTERNATIVE', onclick: () => Suggestions.twist(n) })
      ]));
    } else if (n.origin === 'ai' && !n.canon) {
      box.append(el('div', { class: 'row' }, [
        el('button', { class: 'btn small primary', text: 'ACCEPT', onclick: () => this.accept(n) }),
        el('button', { class: 'btn small danger', text: 'REJECT', onclick: () => this.reject(n) })
      ]));
    } else if (n.origin === 'rejected') {
      box.append(el('button', { class: 'btn small', text: 'RESTORE AS PROPOSED', onclick: () => { n.origin = 'ai'; n.canon = false; this.after(); } }));
    }
    // relationships (constellation links)
    const rel = el('div', { class: 'chips' });
    n.links.forEach(l => Store.node(l) && rel.append(el('button', { class: 'chip x', title: 'Remove relationship', text: Store.node(l).title || '(untitled)', onclick: () => { n.links = n.links.filter(x => x !== l); this.after(); } })));
    const sel = el('select', { 'aria-label': 'Relate to another node' }, [el('option', { value: '', text: '+ relate to…' }), ...Object.values(S.nodes).filter(o => o.id !== n.id && !n.links.includes(o.id)).map(o => el('option', { value: o.id, text: `${NODE_TYPES[o.type].label} · ${o.title}` }))]);
    sel.onchange = () => { if (sel.value) { n.links.push(sel.value); this.after(); } };
    box.append(el('label', {}, ['Relationships (constellation lines)', rel, sel]));
    if (n.id !== S.rootId) box.append(el('button', { class: 'btn small danger', text: 'DELETE NODE', onclick: () => { if (confirm(`Delete "${n.title}" and everything beneath it?`)) { Store.removeNode(n.id); this.after(); } } }));
  },
  after() { Store.commit(); Store.setDirty(true); Tree.render(); this.render(); UI.renderNav(); },
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
    AI_ACTIONS.forEach(([k, l]) => box.append(el('button', { class: 'btn small', text: l, onclick: () => this.run(k) })));
  },
  context() {
    const S = Store.s; return {
      story_id: S.id, title: S.title, settings: { genre: S.settings.genre, tone: S.settings.tone, pov: S.settings.pov },
      text: Editor.text(), tree: Object.values(S.nodes).map(n => ({ id: n.id, type: n.type, title: n.title, parent: n.parent, origin: n.origin, canon: n.canon, data: n.data, links: n.links })),
      selected_node: S.selected
    };
  },
  notice(msg) { const n = $('#aiStatus'); n.hidden = !msg; n.textContent = msg || ''; },
  offline(err) { this.notice(`The AI backend isn't reachable (${err}). Your story is untouched. Start the FastAPI server at ${Api.base}, or use Settings → Load sample suggestion to preview the interface.`); UI.openSide('ai'); },
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
      title: (rec.sample ? '[SAMPLE — NOT AI] ' : '') + (AI_ACTIONS.find(a => a[0] === rec.kind)?.[1] || rec.kind.replace(/_/g, ' ').toUpperCase()),
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
      el('div', { class: 'kind', text: `◆ ${(s.sample ? 'SAMPLE · ' : '')}${s.kind.replace(/_/g, ' ').toUpperCase()}${pending ? '' : ' · ' + s.status.toUpperCase()}` }),
      el('p', { text: s.text.length > 160 ? s.text.slice(0, 160) + '…' : s.text })
    ]);
    if (pending) c.append(el('div', { class: 'row' }, [el('button', { class: 'btn small primary', text: 'REVIEW', onclick: () => this.review(s) })]));
    else if (s.status === 'rejected') c.append(el('div', { class: 'row' }, [el('button', { class: 'btn small', text: 'RECONSIDER', onclick: () => { s.status = 'pending'; this.render(); this.review(s); } })]));
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
    $('#rvEdit').onclick = () => { edited = true; sug.contentEditable = 'true'; sug.focus(); $('#rvAccept').textContent = 'ACCEPT EDITED'; };
    $('#rvAccept').onclick = () => { const t = sug.innerText.trim(); if (!t) return; dlg.close(); this.cb?.onAccept(t, edited); };
    $('#rvReject').onclick = () => { dlg.close(); this.cb?.onReject(); };
    $('#rvLater').onclick = () => dlg.close();
    this.reset = () => { edited = false; sug.contentEditable = 'false'; $('#rvAccept').textContent = 'ACCEPT'; };
  },
  show({ title, why, original, suggestion, onAccept, onReject }) {
    this.cb = { onAccept, onReject }; this.reset();
    $('#reviewTitle').textContent = title; $('#reviewWhy').textContent = why || '';
    $('#reviewOriginal').textContent = original || '(nothing — this would be new text)'; $('#reviewSuggestion').textContent = suggestion;
    const d = $('#reviewDlg'); if (!d.open) d.showModal();
  }
};

/* ------------------------------- Voice ------------------------------ */
const Voice = {
  state: 'IDLE', rec: null, chunks: [], stream: null, ctx: null, an: null, raf: 0,
  LABELS: { IDLE: 'IDLE · tap to speak', LISTENING: 'Listening… tap to stop', PROCESSING: 'Transcribing…', COMPLETE: 'COMPLETE · review the raw voice', ERROR: 'ERROR' },
  init() {
    $('#mic').onclick = () => (this.state === 'LISTENING' ? this.stop() : this.state === 'PROCESSING' ? null : this.start());
    $('#btnTypeRaw').onclick = () => { this.showRaw(''); $('#rawText').focus(); };
    $('#btnDiscardRaw').onclick = () => { $('#rawBox').hidden = true; $('#rawText').value = ''; this.set('IDLE'); };
    $('#btnUseRaw').onclick = () => { const t = $('#rawText').value.trim(); if (!t) return; Editor.insertHuman(t); $('#rawBox').hidden = true; $('#rawText').value = ''; this.set('IDLE'); toast('Raw text added as your own words'); };
    $('#btnImprove').onclick = async () => {
      const t = $('#rawText').value.trim(); if (!t) return; Suggestions.notice('Improving your raw idea…');
      const res = await Api.suggest({ ...Suggestions.context(), action: 'improve_voice', selection: t });
      if (!res.ok) { Suggestions.offline(res.error); return toast('AI unavailable — your raw text is kept above'); }
      const list = res.data?.suggestions || []; if (!list.length) return toast('No suggestion returned');
      Suggestions.notice(''); $('#rawBox').hidden = true;
      list.forEach(s => Suggestions.add({ kind: 'improve_voice', original: t, text: s.text, why: s.rationale || '', range: Editor.savedRange ? Editor.savedRange.cloneRange() : null }));
    };
  },
  set(s, msg) {
    this.state = s; $('#mic').dataset.state = s; $('#micLabel').textContent = msg || this.LABELS[s];
    $('#levels').classList.toggle('on', s === 'LISTENING'); $('#mic').setAttribute('aria-label', 'Voice input: ' + s.toLowerCase());
  },
  showRaw(t) { $('#rawBox').hidden = false; $('#rawText').value = t; },
  async start() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { this.set('ERROR', 'ERROR · microphone not supported here'); return this.showRaw(''); }
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { this.set('ERROR', 'ERROR · microphone permission denied'); return this.showRaw(''); }
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
    if (res.ok && res.data?.text) { this.showRaw(res.data.text); this.set('COMPLETE'); }
    else { this.set('ERROR', `ERROR · ${res.error || 'no speech detected'} — you can type raw notes instead`); this.showRaw(''); }
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
      el('button', { type: 'button', class: 'btn small', text: 'RESTORE', onclick: () => { this.snapshot('Auto — before restore'); Store.s.nodes = x.nodes; Store.s.selected = Store.s.rootId; Editor.setHtml(x.html); Tree.render(); Inspector.render(); UI.renderNav(); Store.commit(); Store.setDirty(true); toast('Version restored'); $('#versionsDlg').close(); } }),
      el('button', { type: 'button', class: 'btn small danger', text: '✕', 'aria-label': 'Delete version', onclick: () => { lsSet(LS_VER, this.list().filter(y => y.id !== x.id)); this.render(); } })
    ])));
  }
};

/* ------------------------------ Export ------------------------------ */
const Exporter = {
  build(fmt, marks) {
    const S = Store.s, title = S.title || 'Untitled story'; const root = Editor.ed.cloneNode(true);
    root.querySelectorAll('.ai-text').forEach(sp => { if (marks) sp.textContent = fmt === 'html' ? sp.textContent : `⟦AI: ${sp.textContent}⟧`; });
    const paras = [...root.childNodes].map(n => (n.textContent || '').trim()).filter(Boolean);
    if (fmt === 'html') return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:18px/1.8 Georgia,serif;max-width:40em;margin:3em auto;padding:0 1em}${marks ? '.ai{background:#eee4ff}' : ''}</style><h1>${esc(title)}</h1>` +
      [...Editor.ed.childNodes].map(n => `<p>${marks ? n.innerHTML?.replace(/class="ai-text"/g, 'class="ai"') ?? esc(n.textContent) : esc(n.textContent)}</p>`).join('\n');
    return fmt === 'md' ? `# ${title}\n\n${paras.join('\n\n')}\n` : `${title.toUpperCase()}\n\n${paras.join('\n\n')}\n`;
  },
  preview() { const f = $('#expFormat').value; $('#expPreview').textContent = f === 'pdf' ? this.build('txt', $('#expMarks').checked) : this.build(f, $('#expMarks').checked).slice(0, 4000); },
  async download() {
    const f = $('#expFormat').value, marks = $('#expMarks').checked, name = (Store.s.title || 'story').replace(/[^\w\-]+/g, '_'), msg = $('#expMsg'); msg.hidden = true;
    let blob, ext = f;
    if (f === 'pdf') {
      const res = await Api.exportPdf({ story_id: Store.s.id, title: Store.s.title, text: this.build('txt', marks), mark_ai: marks });
      if (!res.ok) { msg.hidden = false; msg.textContent = `PDF export needs the backend (${res.error}). Export Markdown or HTML now, or start the server and try again.`; return; }
      blob = res.data;
    } else blob = new Blob([this.build(f, marks)], { type: f === 'html' ? 'text/html' : 'text/plain' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${name}.${ext}` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
};

/* --------------------------------- UI -------------------------------- */
const UI = {
  init() {
    $('#btnBegin').onclick = () => this.enter(newStory());
    $('#btnContinue').onclick = () => { const s = lsGet(LS_KEY, null); if (s) this.enter(s); };
    $('#btnContinue').disabled = !lsGet(LS_KEY, null);
    $('#btnHome').onclick = () => { if (Store.dirty && !confirm('You have unsaved changes. Leave anyway?')) return; this.leave(); };
    $('#btnSave').onclick = () => Store.save();
    $('#btnUndo').onclick = () => Store.undo(); $('#btnRedo').onclick = () => Store.redo();
    $('#btnVersions').onclick = () => { Versions.render(); $('#versionsDlg').showModal(); };
    $('#btnSnap').onclick = () => { Versions.snapshot($('#verLabel').value.trim()); $('#verLabel').value = ''; };
    $('#btnExport').onclick = () => { $('#expMsg').hidden = true; Exporter.preview(); $('#exportDlg').showModal(); };
    $('#expFormat').onchange = $('#expMarks').onchange = () => Exporter.preview(); $('#btnDoExport').onclick = () => Exporter.download();
    $('#btnSettings').onclick = () => this.openSettings();
    $('#storyTitle').addEventListener('input', e => { const S = Store.s; S.title = e.target.value; S.nodes[S.rootId].title = e.target.value || 'Untitled story'; Store.setDirty(true); Tree.render(); UI.renderNav(); });
    $('#storyTitle').addEventListener('change', () => Store.commit());
    $('#btnAddNode').onclick = () => { const S = Store.s, t = $('#addType').value; const n = Store.addNode(t, `New ${NODE_TYPES[t].label.toLowerCase()}`, S.selected); Inspector.after(); this.select(n.id, true); };
    $$('.tab').forEach(t => t.onclick = () => this.tab(t.dataset.tab));
    $('#btnTreeToggle').onclick = () => this.openSide('tree'); $('#btnAiToggle').onclick = () => this.openSide('ai');
    $('#btnSideClose').onclick = () => this.closePanels(); $('#btnNavToggle').onclick = () => this.togglePanel('#nav'); $('#btnNavClose').onclick = () => this.closePanels();
    $('#scrim').onclick = () => this.closePanels();
    document.addEventListener('keydown', e => {
      if ($('#app').hidden || document.querySelector('dialog[open]')) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); Store.save(); }
      else if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); Store.undo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); Store.redo(); }
      else if (k === 'escape') this.closePanels();
    });
    addEventListener('beforeunload', e => { if (Store.s && Store.dirty) { e.preventDefault(); e.returnValue = ''; } });
    setInterval(() => this.ping(), 20000);
  },
  enter(story) {
    Store.s = story; if (!story.suggestions) story.suggestions = [];
    document.body.classList.remove('view-landing'); $('#landing').hidden = true; $('#app').hidden = false;
    Editor.setHtml(story.html); Store.init(story);
    $('#storyTitle').value = story.title || ''; $('#chkMarks').checked = story.settings.marks !== false; document.body.classList.toggle('hide-marks', story.settings.marks === false);
    Tree._fitted = false; this.select(story.selected || story.rootId, false); Tree.render(); Suggestions.render(); Inspector.render(); this.renderNav(); this.syncUndo(); this.ping();
    requestAnimationFrame(() => Tree.fit()); Editor.ed.focus();
  },
  leave() { if (Store.s) Store.save(true); document.body.classList.add('view-landing'); $('#app').hidden = true; $('#landing').hidden = false; $('#btnContinue').disabled = !lsGet(LS_KEY, null); this.closePanels(); },
  select(id, show) {
    const S = Store.s; if (!S.nodes[id]) return; S.selected = id; Tree.render(); Inspector.render(); this.renderNav();
    if (show) this.openSide('inspect');
  },
  tab(name) {
    $('#side').dataset.tab = name; $$('.tab').forEach(t => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
    $('#panelTree').hidden = name !== 'tree'; $('#panelAi').hidden = name !== 'ai'; $('#panelInspect').hidden = name !== 'inspect';
    if (name === 'tree') requestAnimationFrame(() => { if (!Tree._fitted) Tree.fit(); });
  },
  openSide(tab) { this.tab(tab); if (innerWidth <= 1200) { $('#side').classList.add('open'); $('#scrim').hidden = false; } },
  togglePanel(sel) { const p = $(sel), open = !p.classList.contains('open'); this.closePanels(); if (open) { p.classList.add('open'); $('#scrim').hidden = false; } },
  closePanels() { $('#side').classList.remove('open'); $('#nav').classList.remove('open'); $('#scrim').hidden = true; },
  renderNav() {
    const ul = $('#navList'), S = Store.s; if (!S) return; ul.replaceChildren();
    const walk = (id, d) => {
      const n = S.nodes[id], T = NODE_TYPES[n.type], O = ORIGIN[n.origin] || ORIGIN.human;
      const b = el('button', { class: id === S.selected ? 'sel' : '', style: `padding-left:${8 + d * 14}px`, title: `${T.label} · ${O.tag}`, onclick: () => { this.select(id, true); } }, [el('span', { class: 'g', text: T.glyph }), el('span', { class: 't', text: n.title || '(untitled)' }), el('span', { class: 'muted', text: n.origin === 'human' ? '★' : n.origin === 'ai' ? '◆' : n.origin === 'edited' ? '✎' : '✕' })]);
      ul.append(el('li', {}, b)); n.kids.forEach(k => walk(k, d + 1));
    };
    walk(S.rootId, 0);
  },
  syncUndo() { $('#btnUndo').disabled = Store.undoStack.length < 2; $('#btnRedo').disabled = !Store.redoStack.length; },
  async ping() {
    const p = $('#apiStatus'); if (!p) return; const r = await Api.health();
    p.textContent = r.ok ? '● Backend: online' : '○ Backend: offline'; p.className = 'pill ' + (r.ok ? 'ok' : '');
  },
  openSettings() {
    const s = Store.s.settings; $('#setGenre').value = s.genre; $('#setTone').value = s.tone; $('#setPov').value = s.pov; $('#setLang').value = s.lang; $('#setApi').value = s.api; $('#setMotion').checked = s.reduceMotion;
    $('#settingsDlg').showModal();
  }
};

function wireSettings() {
  const map = { setGenre: 'genre', setTone: 'tone', setPov: 'pov', setLang: 'lang', setMotion: 'reduceMotion' };
  Object.entries(map).forEach(([id, key]) => $('#' + id).addEventListener('change', e => { Store.s.settings[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; Store.setDirty(true); if (key === 'reduceMotion') Sky.loop(); }));
  $('#setApi').addEventListener('change', e => { Store.s.settings.api = e.target.value.trim() || 'http://127.0.0.1:8000'; Api.base = Store.s.settings.api; Store.setDirty(true); UI.ping(); });
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
  Sky.init(); Editor.init(); Tree.init(); Suggestions.init(); Review.init(); Voice.init(); UI.init(); wireSettings();
  Voice.set('IDLE');
  $('#side').dataset.tab = 'tree';
  addEventListener('resize', debounce(() => Store.s && Tree.fit(), 250));
});

// Story Forge Frontend Client Script
let currentStoryId = null;
let currentEntryId = null;
let lastCleanedText = "";

async function init() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    document.getElementById('backend-status').textContent = `● Backend: ${data.status} (Gemini: ${data.gemini_configured ? 'Active' : 'Missing Key'})`;
  } catch (err) {
    document.getElementById('backend-status').textContent = '● Backend: Offline';
  }

  // Create or load active story
  await getOrCreateStory();
  setupEventListeners();
}

async function getOrCreateStory() {
  try {
    const res = await fetch('/api/stories');
    const data = await res.json();
    if (data.stories && data.stories.length > 0) {
      currentStoryId = data.stories[0].id;
    } else {
      const createRes = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'The Wanderer on the Cliff', genre: 'Epic Fantasy' })
      });
      const created = await createRes.json();
      currentStoryId = created.id;
    }
    await refreshStoryView();
  } catch (e) {
    console.error('Error fetching story:', e);
  }
}

async function refreshStoryView() {
  if (!currentStoryId) return;
  const res = await fetch(`/api/stories/${currentStoryId}`);
  const data = await res.json();
  
  document.getElementById('display-canonical').textContent = data.canonical_text || 'No canonical text approved yet.';
  
  if (data.prose_entries && data.prose_entries.length > 0) {
    const latest = data.prose_entries[data.prose_entries.length - 1];
    currentEntryId = latest.id;
    document.getElementById('display-raw').textContent = latest.raw_human_input;
    document.getElementById('display-ai').textContent = latest.ai_interpretation || 'No interpretation yet.';
    
    document.getElementById('btn-accept').disabled = !latest.ai_interpretation;
    document.getElementById('btn-edit').disabled = !latest.ai_interpretation;
    document.getElementById('btn-reject').disabled = !latest.ai_interpretation;
  }

  // Update Graph UI
  if (data.graph) {
    renderGraph(data.graph);
  }
}

function renderGraph(graph) {
  const chars = graph.nodes.filter(n => n.node_type === 'CHARACTER');
  const locs = graph.nodes.filter(n => n.node_type === 'LOCATION');
  const evts = graph.nodes.filter(n => n.node_type === 'EVENT');
  const mysts = graph.nodes.filter(n => n.node_type === 'MYSTERY');

  renderBadgeList('characters-list', chars.map(c => c.label));
  renderBadgeList('locations-list', locs.map(l => l.label));
  renderBadgeList('events-list', evts.map(e => e.label));
  renderBadgeList('mysteries-list', mysts.map(m => m.label));

  const edgeUl = document.getElementById('edges-list');
  edgeUl.innerHTML = '';
  if (graph.edges.length === 0) {
    edgeUl.innerHTML = '<li>No relationships recorded yet.</li>';
  } else {
    graph.edges.forEach(e => {
      const src = graph.nodes.find(n => n.id === e.source_id)?.label || e.source_id;
      const tgt = graph.nodes.find(n => n.id === e.target_id)?.label || e.target_id;
      const li = document.createElement('li');
      li.textContent = `${src} ──[${e.relation_type}]──> ${tgt}`;
      edgeUl.appendChild(li);
    });
  }
}

function renderBadgeList(elemId, items) {
  const el = document.getElementById(elemId);
  el.innerHTML = '';
  if (items.length === 0) {
    el.textContent = 'None';
    return;
  }
  items.forEach(item => {
    const span = document.createElement('span');
    span.className = 'badge';
    span.textContent = item;
    el.appendChild(span);
  });
}

function setupEventListeners() {
  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Microphone speech
  document.getElementById('btn-mic').addEventListener('click', () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      document.getElementById('raw-input').value = transcript;
    };
    recognition.start();
  });

  // Clean / Interpret (Listener)
  document.getElementById('btn-clean').addEventListener('click', async () => {
    const raw = document.getElementById('raw-input').value.trim();
    if (!raw) return;
    
    document.getElementById('display-raw').textContent = raw;
    document.getElementById('display-ai').textContent = 'Listening and cleaning with Gemini...';
    
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_text: raw })
    });
    const data = await res.json();
    lastCleanedText = data.cleaned_transcript;
    document.getElementById('display-ai').textContent = lastCleanedText;

    // Save as new prose entry in story
    const entryRes = await fetch(`/api/story/${currentStoryId}/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_human_input: raw, ai_interpretation: lastCleanedText })
    });
    const entry = await entryRes.json();
    currentEntryId = entry.id;

    document.getElementById('btn-accept').disabled = false;
    document.getElementById('btn-edit').disabled = false;
    document.getElementById('btn-reject').disabled = false;
  });

  // Story Architect Analysis
  document.getElementById('btn-analyze').addEventListener('click', async () => {
    const raw = document.getElementById('raw-input').value.trim() || document.getElementById('display-raw').textContent;
    if (!raw) return;

    const res = await fetch('/api/story/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ story_id: currentStoryId, raw_text: raw })
    });
    const data = await res.json();
    await refreshStoryView();
  });

  // Canon Decisions
  document.getElementById('btn-accept').addEventListener('click', async () => {
    if (!currentEntryId) return;
    await fetch(`/api/story/${currentStoryId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_id: currentEntryId, action: 'accept' })
    });
    await refreshStoryView();
  });

  document.getElementById('btn-edit').addEventListener('click', async () => {
    if (!currentEntryId) return;
    const current = document.getElementById('display-ai').textContent;
    const edited = prompt('Edit prose before approving into canon:', current);
    if (!edited) return;
    await fetch(`/api/story/${currentStoryId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_id: currentEntryId, action: 'edit', revised_text: edited })
    });
    await refreshStoryView();
  });

  document.getElementById('btn-reject').addEventListener('click', async () => {
    if (!currentEntryId) return;
    await fetch(`/api/story/${currentStoryId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_id: currentEntryId, action: 'reject' })
    });
    await refreshStoryView();
  });

  // Continuity Check
  document.getElementById('btn-check-continuity').addEventListener('click', async () => {
    const text = document.getElementById('continuity-input').value.trim();
    if (!text) return;
    const res = await fetch('/api/story/continuity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ story_id: currentStoryId, text_to_check: text })
    });
    const data = await res.json();
    const container = document.getElementById('continuity-results');
    container.innerHTML = '';
    if (data.issues.length === 0) {
      container.innerHTML = '<p style="color: #10b981;">No continuity contradictions detected. Canon is preserved.</p>';
      return;
    }
    data.issues.forEach(iss => {
      const card = document.createElement('div');
      card.className = `issue-card severity-${iss.severity}`;
      card.innerHTML = `<strong>[${iss.severity}] ${iss.issue}</strong><p>${iss.evidence}</p><small style="color: #38bdf8;">Suggested Fix: ${iss.suggested_fix}</small>`;
      container.appendChild(card);
    });
  });

  // Twist Engine
  document.getElementById('btn-generate-twists').addEventListener('click', async () => {
    const container = document.getElementById('twists-results');
    container.innerHTML = 'Synthesizing twists backed by graph mysteries...';
    const res = await fetch('/api/story/twist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ story_id: currentStoryId, count: 2 })
    });
    const data = await res.json();
    container.innerHTML = '';
    data.twists.forEach(tw => {
      const card = document.createElement('div');
      card.className = 'twist-card';
      card.innerHTML = `<h5>${tw.title}</h5><p>${tw.description}</p><div class="reason-box">Why AI suggested: ${tw.reason}</div>`;
      container.appendChild(card);
    });
  });

  // Creative Suggestions
  document.getElementById('btn-get-suggestions').addEventListener('click', async () => {
    const raw = document.getElementById('raw-input').value.trim() || document.getElementById('display-canonical').textContent;
    const container = document.getElementById('creative-results');
    container.innerHTML = 'Brainstorming creative angles...';
    const res = await fetch('/api/story/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ story_id: currentStoryId, current_text: raw })
    });
    const data = await res.json();
    container.innerHTML = '';
    data.suggestions.forEach(s => {
      const card = document.createElement('div');
      card.className = 'suggestion-card';
      card.innerHTML = `<strong>[${s.category.toUpperCase()}] ${s.title}</strong><p>${s.content}</p><small style="color: #94a3b8;">${s.rationale}</small>`;
      container.appendChild(card);
    });
  });

  // Export PDF
  document.getElementById('btn-export-pdf').addEventListener('click', async () => {
    const res = await fetch('/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ story_id: currentStoryId })
    });
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'story_forge_canonical.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

document.addEventListener('DOMContentLoaded', init);

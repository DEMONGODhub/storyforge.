import React, { useState, useEffect } from 'react';
import { 
  BookOpen, Sparkles, ShieldAlert, GitBranch, Mic, Send, CheckCircle2, 
  XCircle, Edit3, Download, RefreshCw, Layers, Database, Cpu, Compass,
  Eye, HelpCircle, FileText, ChevronRight, AlertTriangle, ArrowRight, Play
} from 'lucide-react';

interface Story {
  id: string;
  title: string;
  genre: string;
  synopsis: string;
  created_at: string;
}

interface ProseEntry {
  id: string;
  raw_human_input: string;
  ai_interpretation: string | null;
  user_approved_text: string | null;
  canon_status: string;
  scene_id?: string;
}

interface GraphNode {
  id: string;
  node_type: string;
  label: string;
  properties: Record<string, any>;
  canon_status: string;
}

interface GraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  properties: Record<string, any>;
  canon_status: string;
}

interface ContinuityIssue {
  issue: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  evidence: string;
  suggested_fix: string;
}

interface Twist {
  id: string;
  title: string;
  description: string;
  trigger_events: string[];
  affected_characters: string[];
  revealed_information: string[];
  foreshadowing: string[];
  consequences: string[];
  reason: string;
  canon_status: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'writer' | 'graph' | 'continuity' | 'twists' | 'architecture'>('writer');
  const [story, setStory] = useState<Story | null>(null);
  const [canonicalText, setCanonicalText] = useState<string>('');
  const [proseEntries, setProseEntries] = useState<ProseEntry[]>([]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  
  // Inputs & states
  const [rawInput, setRawInput] = useState<string>('under the blue sky a man with black clock in his back standing on a mountain cliff wispering th name of his parents');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCheckingContinuity, setIsCheckingContinuity] = useState(false);
  const [isGeneratingTwists, setIsGeneratingTwists] = useState(false);
  const [backendHealth, setBackendHealth] = useState<any>(null);
  
  // Continuity & Twists results
  const [continuityInput, setContinuityInput] = useState<string>('The man suddenly walked over to his parents who were sitting next to him on the couch eating grapes and laughing.');
  const [continuityIssues, setContinuityIssues] = useState<ContinuityIssue[]>([]);
  const [continuityChecked, setContinuityChecked] = useState(false);
  const [twists, setTwists] = useState<Twist[]>([]);

  // Active prose entry under review
  const latestEntry = proseEntries.length > 0 ? proseEntries[proseEntries.length - 1] : null;

  useEffect(() => {
    fetchHealth();
    loadOrCreateStory();
  }, []);

  const fetchHealth = async () => {
    try {
      const res = await fetch('/health');
      const data = await res.json();
      setBackendHealth(data);
    } catch {
      setBackendHealth({ status: 'offline' });
    }
  };

  const loadOrCreateStory = async () => {
    try {
      const res = await fetch('/api/stories');
      const data = await res.json();
      if (data.stories && data.stories.length > 0) {
        await fetchStoryDetails(data.stories[0].id);
      } else {
        const createRes = await fetch('/api/stories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'The Whispering Mountain',
            genre: 'Dark Fantasy',
            synopsis: 'A cloaked wanderer carries the grief and secrets of a fallen house.'
          })
        });
        const created = await createRes.json();
        await fetchStoryDetails(created.id);
      }
    } catch (e) {
      console.error('Error loading story:', e);
    }
  };

  const fetchStoryDetails = async (storyId: string) => {
    try {
      const res = await fetch(`/api/stories/${storyId}`);
      const data = await res.json();
      setStory(data.story);
      setCanonicalText(data.canonical_text || '');
      setProseEntries(data.prose_entries || []);
      if (data.graph) {
        setNodes(data.graph.nodes || []);
        setEdges(data.graph.edges || []);
      }
    } catch (e) {
      console.error('Error fetching story details:', e);
    }
  };

  // Step 1: Listener Clean/Interpret
  const handleListenerInterpret = async () => {
    if (!story || !rawInput.trim()) return;
    setIsTranscribing(true);
    try {
      // 1. Transcribe/Clean
      const transRes = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawInput.trim() })
      });
      const transData = await transRes.json();

      // 2. Add entry to story
      await fetch(`/api/story/${story.id}/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_human_input: rawInput.trim(),
          ai_interpretation: transData.cleaned_transcript
        })
      });

      await fetchStoryDetails(story.id);
    } catch (err) {
      console.error(err);
    } finally {
      setIsTranscribing(false);
    }
  };

  // Step 2: Story Architect Extraction
  const handleArchitectAnalyze = async () => {
    if (!story) return;
    const textToAnalyze = latestEntry?.raw_human_input || rawInput;
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/story/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story_id: story.id,
          raw_text: textToAnalyze,
          auto_apply_proposals_to_graph: true
        })
      });
      await res.json();
      await fetchStoryDetails(story.id);
      setActiveTab('graph');
    } catch (err) {
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Step 3: Canon Decisions
  const handleCanonAction = async (action: 'accept' | 'edit' | 'reject') => {
    if (!story || !latestEntry) return;
    let revisedText = undefined;
    if (action === 'edit') {
      const promptRes = window.prompt(
        'Edit prose before approving into canon:',
        latestEntry.ai_interpretation || latestEntry.raw_human_input
      );
      if (!promptRes) return;
      revisedText = promptRes;
    }

    try {
      await fetch(`/api/story/${story.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_id: latestEntry.id,
          action,
          revised_text: revisedText
        })
      });
      await fetchStoryDetails(story.id);
    } catch (err) {
      console.error(err);
    }
  };

  // Step 4: Continuity Verification
  const handleContinuityCheck = async () => {
    if (!story || !continuityInput.trim()) return;
    setIsCheckingContinuity(true);
    setContinuityChecked(true);
    try {
      const res = await fetch('/api/story/continuity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story_id: story.id,
          text_to_check: continuityInput
        })
      });
      const data = await res.json();
      setContinuityIssues(data.issues || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsCheckingContinuity(false);
    }
  };

  // Step 5: Twist Engine
  const handleGenerateTwists = async () => {
    if (!story) return;
    setIsGeneratingTwists(true);
    try {
      const res = await fetch('/api/story/twist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story_id: story.id,
          count: 2
        })
      });
      const data = await res.json();
      setTwists(data.twists || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingTwists(false);
    }
  };

  // Export PDF
  const handleExportPdf = async () => {
    if (!story) return;
    try {
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story_id: story.id, title: story.title })
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${story.title.replace(/\s+/g, '_')}_Canonical.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">Story Forge</h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono">
                AI Orchestration Engine
              </span>
            </div>
            <p className="text-xs text-slate-400">Human-in-the-Loop Canon &amp; Non-Hierarchical Story Graph</p>
          </div>
        </div>

        {/* Backend & Action Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs font-mono">
            <span className={`w-2 h-2 rounded-full ${backendHealth?.status === 'healthy' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            <span>FastAPI: {backendHealth?.status === 'healthy' ? 'ONLINE (Port 8001)' : 'Connecting...'}</span>
            <span className="text-slate-500">|</span>
            <span className="text-cyan-400">Gemini: {backendHealth?.gemini_configured ? 'ACTIVE' : 'READY'}</span>
          </div>
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            Export Canonical PDF
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
        
        {/* Core Principle Banner */}
        <div className="bg-gradient-to-r from-indigo-950/60 via-slate-900 to-cyan-950/60 border border-indigo-900/50 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Governing Canon Principle</p>
              <p className="text-sm text-slate-200 font-medium">
                &ldquo;AI can suggest, but the writer always has final control.&rdquo;
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800">HUMAN = Canonical</span>
            <span>&rarr;</span>
            <span className="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800">AI_PROPOSED = Untrusted</span>
            <span>&rarr;</span>
            <span className="px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800">APPROVED = Canonical</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('writer')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              activeTab === 'writer'
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Edit3 className="w-4 h-4" />
            1. Writer &amp; Canon Control
          </button>
          <button
            onClick={() => setActiveTab('graph')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              activeTab === 'graph'
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <GitBranch className="w-4 h-4" />
            2. Story Graph Topology ({nodes.length} Nodes)
          </button>
          <button
            onClick={() => setActiveTab('continuity')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              activeTab === 'continuity'
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            3. Continuity Keeper
          </button>
          <button
            onClick={() => setActiveTab('twists')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              activeTab === 'twists'
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            4. Twist Engine
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              activeTab === 'architecture'
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Layers className="w-4 h-4" />
            Backend Architecture &amp; API
          </button>
        </div>

        {/* Tab 1: Writer & Triple-Tier Canon */}
        {activeTab === 'writer' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Input Sandbox */}
            <div className="lg:col-span-5 flex flex-col gap-4 bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Mic className="w-4 h-4 text-cyan-400" />
                  Raw Human Input
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Speak into microphone or type raw story idea with speech-recognition phonetic flaws.
                </p>
              </div>

              <textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                rows={4}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 font-mono transition"
                placeholder="Speak or type raw thoughts..."
              />

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleListenerInterpret}
                  disabled={isTranscribing || !rawInput.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-900/20 disabled:opacity-50 transition"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isTranscribing ? 'Listening & Cleaning...' : 'Run Listener (Clean Phonetics)'}
                </button>
                <button
                  onClick={handleArchitectAnalyze}
                  disabled={isAnalyzing || (!latestEntry && !rawInput.trim())}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md shadow-amber-900/20 disabled:opacity-50 transition"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  {isAnalyzing ? 'Extracting...' : 'Story Architect (Extract Entities)'}
                </button>
              </div>

              {/* Sample Input Chips */}
              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider block mb-2">Try Hackathon Brief Example:</span>
                <button
                  onClick={() => setRawInput('under the blue sky a man with black clock in his back standing on a mountain cliff wispering th name of his parents')}
                  className="text-left text-xs bg-slate-800/50 hover:bg-slate-800 p-2 rounded border border-slate-700/50 text-slate-300 font-mono transition"
                >
                  &ldquo;under the blue sky a man with black clock in his back standing on a mountain cliff wispering th name of his parents&rdquo;
                </button>
              </div>
            </div>

            {/* Right: Triple-Tier Canon Inspector */}
            <div className="lg:col-span-7 flex flex-col gap-4 bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  Triple-Layer Canon Inspector
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Guarantees raw human text is never lost, AI suggestions stay unapproved, and the writer controls final canon.
                </p>
              </div>

              {/* Layer 1: Raw Human Input */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tier 1: Raw Human Input (Verbatim)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">NEVER OVERWRITTEN</span>
                </div>
                <p className="text-sm text-slate-300 font-mono bg-slate-900/40 p-2 rounded border border-slate-800/60">
                  {latestEntry?.raw_human_input || rawInput}
                </p>
              </div>

              {/* Layer 2: AI Proposed Interpretation */}
              <div className="bg-slate-950 border border-amber-900/40 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Tier 2: AI Proposed Interpretation
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 font-mono">
                    STATUS: {latestEntry?.canon_status || 'AI_PROPOSED'}
                  </span>
                </div>
                <p className="text-sm text-amber-100 font-serif italic bg-amber-950/10 p-2.5 rounded border border-amber-900/30">
                  {latestEntry?.ai_interpretation || 'Run Listener to generate cleaned interpretation (e.g. correcting "clock" to "cloak").'}
                </p>

                {/* Author Approval Controls */}
                {latestEntry && (
                  <div className="mt-3 flex items-center gap-2 pt-2 border-t border-slate-800">
                    <span className="text-xs text-slate-400 font-medium">Writer Decision:</span>
                    <button
                      onClick={() => handleCanonAction('accept')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Accept as Canon
                    </button>
                    <button
                      onClick={() => handleCanonAction('edit')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit &amp; Approve
                    </button>
                    <button
                      onClick={() => handleCanonAction('reject')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white text-xs font-semibold transition"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                )}
              </div>

              {/* Layer 3: Canonical Story Output */}
              <div className="bg-slate-950 border border-emerald-900/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" />
                    Tier 3: Canonical Story Prose (Author Approved)
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                    CANONICAL
                  </span>
                </div>
                <div className="text-sm text-slate-200 font-serif leading-relaxed bg-emerald-950/10 p-3 rounded border border-emerald-900/30 min-h-[70px]">
                  {canonicalText || (
                    <span className="text-slate-500 italic">No canonical text finalized yet. Accept an AI proposal or add human text to establish canon.</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Story Graph Explorer */}
        {activeTab === 'graph' && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-cyan-400" />
                  Non-Hierarchical Story Graph
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Multi-relational graph storing Characters, Locations, Events, and Mysteries with stable IDs and knowledge state.
                </p>
              </div>
              <button
                onClick={() => fetchStoryDetails(story?.id || '')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh Graph
              </button>
            </div>

            {/* Entity Category Badges */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Characters */}
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Characters</span>
                  <span className="text-xs font-mono px-2 py-0.5 bg-cyan-950 text-cyan-300 rounded border border-cyan-800">
                    {nodes.filter(n => n.node_type === 'CHARACTER').length}
                  </span>
                </div>
                <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                  {nodes.filter(n => n.node_type === 'CHARACTER').map(n => (
                    <div key={n.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                      <div className="flex items-center justify-between">
                        <strong className="text-cyan-300">{n.label}</strong>
                        <span className="text-[10px] font-mono text-slate-500">{n.id}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">Role: {n.properties?.role || 'supporting'}</p>
                      {n.properties?.knowledge && n.properties.knowledge.length > 0 && (
                        <div className="mt-1 pt-1 border-t border-slate-900 text-[10px] text-slate-400">
                          <span className="text-amber-400 font-semibold">Knows:</span> {n.properties.knowledge.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                  {nodes.filter(n => n.node_type === 'CHARACTER').length === 0 && (
                    <span className="text-xs text-slate-500 italic">No characters extracted yet.</span>
                  )}
                </div>
              </div>

              {/* Locations */}
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Locations</span>
                  <span className="text-xs font-mono px-2 py-0.5 bg-emerald-950 text-emerald-300 rounded border border-emerald-800">
                    {nodes.filter(n => n.node_type === 'LOCATION').length}
                  </span>
                </div>
                <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                  {nodes.filter(n => n.node_type === 'LOCATION').map(n => (
                    <div key={n.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                      <div className="flex items-center justify-between">
                        <strong className="text-emerald-300">{n.label}</strong>
                        <span className="text-[10px] font-mono text-slate-500">{n.id}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{n.properties?.description || 'No description'}</p>
                    </div>
                  ))}
                  {nodes.filter(n => n.node_type === 'LOCATION').length === 0 && (
                    <span className="text-xs text-slate-500 italic">No locations extracted yet.</span>
                  )}
                </div>
              </div>

              {/* Events */}
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Events</span>
                  <span className="text-xs font-mono px-2 py-0.5 bg-amber-950 text-amber-300 rounded border border-amber-800">
                    {nodes.filter(n => n.node_type === 'EVENT').length}
                  </span>
                </div>
                <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                  {nodes.filter(n => n.node_type === 'EVENT').map(n => (
                    <div key={n.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                      <div className="flex items-center justify-between">
                        <strong className="text-amber-300">{n.label}</strong>
                        <span className="text-[10px] font-mono text-slate-500">{n.id}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{n.properties?.description}</p>
                    </div>
                  ))}
                  {nodes.filter(n => n.node_type === 'EVENT').length === 0 && (
                    <span className="text-xs text-slate-500 italic">No events recorded yet.</span>
                  )}
                </div>
              </div>

              {/* Mysteries */}
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Mysteries</span>
                  <span className="text-xs font-mono px-2 py-0.5 bg-indigo-950 text-indigo-300 rounded border border-indigo-800">
                    {nodes.filter(n => n.node_type === 'MYSTERY').length}
                  </span>
                </div>
                <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                  {nodes.filter(n => n.node_type === 'MYSTERY').map(n => (
                    <div key={n.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                      <div className="flex items-center justify-between">
                        <strong className="text-indigo-300">{n.label}</strong>
                        <span className="text-[10px] font-mono text-slate-500">{n.id}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{n.properties?.description}</p>
                      {n.properties?.clues && (
                        <div className="mt-1 text-[10px] text-indigo-400">
                          Clues: {n.properties.clues.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                  {nodes.filter(n => n.node_type === 'MYSTERY').length === 0 && (
                    <span className="text-xs text-slate-500 italic">No mysteries logged yet.</span>
                  )}
                </div>
              </div>
            </div>

            {/* Edge Relational Table */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <h3 className="text-sm font-bold text-white mb-3">Multi-Relational Graph Edges</h3>
              <div className="space-y-2">
                {edges.map(e => {
                  const src = nodes.find(n => n.id === e.source_id)?.label || e.source_id;
                  const tgt = nodes.find(n => n.id === e.target_id)?.label || e.target_id;
                  return (
                    <div key={e.id} className="flex items-center justify-between p-2.5 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono">
                      <div className="flex items-center gap-3">
                        <span className="text-cyan-400 font-semibold">{src}</span>
                        <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[11px]">
                          ──[{e.relation_type}]──&gt;
                        </span>
                        <span className="text-emerald-400 font-semibold">{tgt}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">{e.id}</span>
                    </div>
                  );
                })}
                {edges.length === 0 && (
                  <p className="text-xs text-slate-500 italic">No relationships established yet. Run Story Architect to extract narrative connections.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Continuity Keeper */}
        {activeTab === 'continuity' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 flex flex-col gap-4 bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                  Continuity &amp; Knowledge Auditor
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Tests proposed narrative against character memory, timeline consistency, and established location facts.
                </p>
              </div>

              <textarea
                value={continuityInput}
                onChange={(e) => setContinuityInput(e.target.value)}
                rows={5}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-rose-500 font-mono transition"
                placeholder="Paste drafted scene to audit for plot holes..."
              />

              <div className="flex items-center justify-between">
                <button
                  onClick={handleContinuityCheck}
                  disabled={isCheckingContinuity || !continuityInput.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-900/20 disabled:opacity-50 transition"
                >
                  <ShieldAlert className="w-4 h-4" />
                  {isCheckingContinuity ? 'Verifying with Story Graph...' : 'Run Continuity Check'}
                </button>
                <span className="text-[11px] text-slate-400 font-mono">
                  Never modifies canonical prose
                </span>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs text-slate-400 space-y-1">
                <strong className="text-slate-300 block mb-1">Checks Enforced by Backend:</strong>
                <li>Character Knowledge Violations (acting on unknown secrets)</li>
                <li>Location Inconsistencies (teleportation without travel)</li>
                <li>Direct Contradictions with established graph canon</li>
                <li>Physical-state discrepancies (unexplained injury status)</li>
              </div>
            </div>

            {/* Results Column */}
            <div className="lg:col-span-6 flex flex-col gap-4 bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <h3 className="text-sm font-bold text-white">Audit Inspection Results</h3>
              
              {continuityChecked && continuityIssues.length === 0 && !isCheckingContinuity && (
                <div className="p-4 rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" />
                  <div>
                    <strong className="block font-semibold">Canon Preserved: No Contradictions Detected</strong>
                    <span>Draft text respects existing character knowledge and location topology.</span>
                  </div>
                </div>
              )}

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {continuityIssues.map((issue, idx) => (
                  <div key={idx} className="p-3.5 rounded-lg bg-slate-950 border border-rose-900/50 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                        {issue.issue}
                      </span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                        issue.severity === 'HIGH' ? 'bg-rose-950 text-rose-400 border border-rose-800' : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}>
                        {issue.severity}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      <strong className="text-slate-300">Evidence from Graph:</strong> {issue.evidence}
                    </p>
                    <div className="p-2 bg-slate-900 rounded text-xs text-cyan-300 border border-slate-800">
                      <strong>Suggested Fix:</strong> {issue.suggested_fix}
                    </div>
                  </div>
                ))}

                {!continuityChecked && (
                  <p className="text-xs text-slate-500 italic p-4 text-center">Click &apos;Run Continuity Check&apos; to audit the text against graph memory.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Twist Engine */}
        {activeTab === 'twists' && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Twist Engine (Graph Grounded)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Synthesizes high-impact narrative twists derived from mysteries and character secrets. Cites evidence to answer &ldquo;Why did the AI suggest this twist?&rdquo;
                </p>
              </div>
              <button
                onClick={handleGenerateTwists}
                disabled={isGeneratingTwists}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md shadow-amber-900/20 disabled:opacity-50 transition"
              >
                <Sparkles className="w-4 h-4" />
                {isGeneratingTwists ? 'Synthesizing with Gemini...' : 'Synthesize Plot Twists'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {twists.map(tw => (
                <div key={tw.id} className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-bold text-amber-300">{tw.title}</h4>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">{tw.id}</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed font-serif italic mb-3">
                      &ldquo;{tw.description}&rdquo;
                    </p>

                    <div className="space-y-1.5 text-xs text-slate-400">
                      {tw.revealed_information && tw.revealed_information.length > 0 && (
                        <div>
                          <span className="text-slate-300 font-semibold">Reveals:</span> {tw.revealed_information.join(', ')}
                        </div>
                      )}
                      {tw.consequences && tw.consequences.length > 0 && (
                        <div>
                          <span className="text-slate-300 font-semibold">Consequences:</span> {tw.consequences.join(', ')}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-lg border border-amber-900/30 text-xs">
                    <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block mb-1">
                      Why Did the AI Suggest This Twist?
                    </span>
                    <p className="text-slate-300 italic">{tw.reason}</p>
                  </div>
                </div>
              ))}

              {twists.length === 0 && (
                <div className="col-span-2 p-8 text-center bg-slate-900/40 rounded-xl border border-slate-800 text-xs text-slate-500">
                  Click &apos;Synthesize Plot Twists&apos; to generate twists based on story graph mysteries and secrets.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 5: Architecture & API Specs */}
        {activeTab === 'architecture' && (
          <div className="space-y-6">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                <Database className="w-4 h-4 text-cyan-400" />
                Backend Directory &amp; Architecture Map
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Fully decoupled AI orchestration layer with modular roles, SQLite persistence, and strict Pydantic schemas.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <span className="text-cyan-400 font-bold block mb-2">ai/ Orchestration</span>
                  <ul className="space-y-1 text-slate-300">
                    <li>• listener.py (Transcription &amp; clean)</li>
                    <li>• architect.py (Entity extraction)</li>
                    <li>• continuity.py (Contradiction check)</li>
                    <li>• creative.py (Co-author suggestions)</li>
                    <li>• twists.py (Twist engine)</li>
                    <li>• editor.py (Literary styling)</li>
                    <li>• retrieval.py (Gemini embeddings)</li>
                    <li>• gemini_client.py (Google GenAI)</li>
                  </ul>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <span className="text-emerald-400 font-bold block mb-2">story/ Data Model</span>
                  <ul className="space-y-1 text-slate-300">
                    <li>• graph.py (StoryGraph, Nodes, Edges)</li>
                    <li>• canon.py (CanonStatus, CanonRecord)</li>
                    <li>• relationships.py (Character memory)</li>
                    <li>• timeline.py (Events &amp; chronology)</li>
                  </ul>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <span className="text-amber-400 font-bold block mb-2">api/ &amp; export/</span>
                  <ul className="space-y-1 text-slate-300">
                    <li>• api/stories.py (CRUD &amp; canon)</li>
                    <li>• api/audio.py (/api/transcribe)</li>
                    <li>• api/suggestions.py (AI endpoints)</li>
                    <li>• export/pdf.py (Canonical PDF)</li>
                    <li>• export/epub.py (EPUB eBook)</li>
                    <li>• database/database.py (SQLite)</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* API Endpoints Contract */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <h3 className="text-base font-bold text-white mb-3">API Contract Specification</h3>
              <div className="space-y-2 font-mono text-xs">
                {[
                  { method: 'GET', path: '/health', desc: 'Health check verifying SQLite and Gemini API connectivity' },
                  { method: 'POST', path: '/api/stories', desc: 'Create new story with initial StoryGraph container' },
                  { method: 'GET', path: '/api/stories/{story_id}', desc: 'Fetch full story, canonical text, prose entries, and graph' },
                  { method: 'POST', path: '/api/transcribe', desc: 'Listener contract (raw transcript, cleaned transcript, confidence)' },
                  { method: 'POST', path: '/api/story/analyze', desc: 'Story Architect structured entity and mystery extraction' },
                  { method: 'POST', path: '/api/story/continuity', desc: 'Continuity Keeper contradiction and knowledge violation audit' },
                  { method: 'POST', path: '/api/story/twist', desc: 'Twist Engine synthesis with graph-grounded evidence explanation' },
                  { method: 'POST', path: '/api/story/{story_id}/accept', desc: 'Author approval/edit/reject action updating canon status' },
                  { method: 'POST', path: '/api/export/pdf', desc: 'Export canonical story and Dramatis Personae to formatted PDF' }
                ].map((ep, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 bg-slate-950 rounded-lg border border-slate-800">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                        ep.method === 'GET' ? 'bg-sky-950 text-sky-400 border border-sky-800' : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      }`}>
                        {ep.method}
                      </span>
                      <span className="text-slate-200 font-semibold">{ep.path}</span>
                    </div>
                    <span className="text-slate-400 text-[11px] font-sans">{ep.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

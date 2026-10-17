"""Story Forge backend (FastAPI).

Local-only AI: text comes from Ollama, speech-to-text from faster-whisper (optional).
Every AI endpoint only ever returns SUGGESTIONS. Nothing here edits a story: the
frontend shows each suggestion to the author, who accepts, edits or rejects it.

Run (from the StoryForge folder):  python3 -m uvicorn main:app --app-dir backend --port 8000
Settings (environment variables, all optional):
  STORYFORGE_MODEL    Ollama model to use                (default llama3.2:1b)
  (AI engine + API keys are set in the app: click the AI pill. Env fallbacks: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, STORYFORGE_PROVIDER)
  STORYFORGE_WHISPER  faster-whisper size: tiny/base/small (default tiny)
  STORYFORGE_NUM_CTX  context window in tokens           (default 4096)
  OLLAMA_URL          where Ollama listens               (default http://127.0.0.1:11434)
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import tempfile
import threading
import uuid
from pathlib import Path

import httpx
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

OLLAMA = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
MODEL = os.getenv("STORYFORGE_MODEL", "llama3.2:1b")
WHISPER_SIZE = os.getenv("STORYFORGE_WHISPER", "tiny")
NUM_CTX = int(os.getenv("STORYFORGE_NUM_CTX", "4096"))
AI_TIMEOUT = float(os.getenv("STORYFORGE_AI_TIMEOUT", "300"))
DATA = Path(os.getenv("STORYFORGE_DATA", str(Path(__file__).parent / "data"))) / "stories"
ORIGINS = os.getenv("STORYFORGE_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500").split(",")
MAX_STORY_BYTES = 15_000_000
MAX_AUDIO_BYTES = 25_000_000
MAX_TEXT_CHARS = max(1500, NUM_CTX * 2)          # keep the prompt inside the model's window (~4 chars/token, leave room for notes+answer)

app = FastAPI(title="Story Forge backend", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------ helpers
def s(v, n: int = 2000) -> str:
    """Coerce anything to a trimmed string (lists become 'a, b')."""
    if isinstance(v, (list, tuple)):
        v = ", ".join(str(x) for x in v)
    return ("" if v is None else str(v)).strip()[:n]


# ------------------------------------------------------------------ AI engine: local Ollama or a cloud API key
SETTINGS_FILE = DATA.parent / "settings.json"        # holds the chosen engine and any API keys (file mode 0600)
PROVIDERS = {
    "ollama":    {"label": "Ollama (on this computer)", "model": MODEL, "base_url": OLLAMA, "env": None},
    "openai":    {"label": "OpenAI-compatible", "model": "gpt-4o-mini", "base_url": "https://api.openai.com/v1", "env": "OPENAI_API_KEY"},
    "anthropic": {"label": "Anthropic Claude", "model": "claude-haiku-5-5", "base_url": "https://api.anthropic.com", "env": "ANTHROPIC_API_KEY"},
    "gemini":    {"label": "Google Gemini", "model": "gemini-2.5-flash", "base_url": "https://generativelanguage.googleapis.com", "env": "GEMINI_API_KEY"},
}


def load_settings() -> dict:
    try:
        d = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save_settings(d: dict) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(d), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)                              # keys are readable by this user only
    except OSError:
        pass
    tmp.replace(SETTINGS_FILE)


def provider_cfg(prov: str, st: dict) -> dict:
    d = PROVIDERS[prov]
    mine = st.get(prov) if isinstance(st.get(prov), dict) else {}
    key = s(mine.get("api_key"), 400) or (os.getenv(d["env"], "") if d["env"] else "")
    base = OLLAMA if prov == "ollama" else (s(mine.get("base_url"), 200) or d["base_url"]).rstrip("/")
    return {"provider": prov, "label": d["label"], "model": s(mine.get("model"), 100) or d["model"], "base_url": base, "key": key.strip(),
            "from_env": bool(key and not mine.get("api_key"))}


def cfg() -> dict:
    st = load_settings()
    prov = st.get("provider") or os.getenv("STORYFORGE_PROVIDER", "ollama")
    return provider_cfg(prov if prov in PROVIDERS else "ollama", st)


async def ollama_status(model: str = MODEL) -> tuple[bool, str | None]:
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{OLLAMA}/api/tags")
        r.raise_for_status()
        names = {m.get("name", "") for m in r.json().get("models", [])}
    except Exception:
        return False, f"Ollama isn't running at {OLLAMA}. Start it with: ollama serve"
    if model in names or (":" not in model and f"{model}:latest" in names):
        return True, None
    return False, f"The model '{model}' isn't installed. Run: ollama pull {model}"


async def ai_status() -> tuple[dict, bool, str | None]:
    c = cfg()
    if c["provider"] == "ollama":
        ready, detail = await ollama_status(c["model"])
    else:
        ready = bool(c["key"])
        detail = None if ready else f"No {c['label']} API key yet. Click the AI pill at the top to add one, or switch back to Local."
    return c, ready, detail


def parse_json_reply(content: str) -> dict:
    try:
        data = json.loads(content)
    except ValueError:
        m = re.search(r"\{[\s\S]*\}", content or "")
        try:
            data = json.loads(m.group(0)) if m else None
        except ValueError:
            data = None
    if not isinstance(data, dict):
        raise HTTPException(502, "The model gave an unreadable answer. Please try again.")
    return data


async def chat(system: str, user: str, schema: dict) -> dict:
    """One structured call to the chosen engine. Raises HTTPException with a human-readable detail."""
    c = cfg()
    if c["provider"] == "ollama":
        return await chat_ollama(c, system, user, schema)
    if not c["key"]:
        raise HTTPException(503, f"No {c['label']} API key is set. Click the AI pill at the top to add one, or switch back to Local.")
    return await chat_cloud(c, system, user, schema)


async def chat_ollama(c: dict, system: str, user: str, schema: dict) -> dict:
    model = c["model"]
    body = {
        "model": model, "stream": False, "keep_alive": "5m", "format": schema,
        "options": {"temperature": 0.8, "num_ctx": NUM_CTX, "num_predict": 700},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    try:
        async with httpx.AsyncClient(timeout=AI_TIMEOUT) as h:
            r = await h.post(f"{OLLAMA}/api/chat", json=body)
            if r.status_code == 400:                      # older Ollama: no JSON-schema support, fall back to plain JSON mode
                body["format"] = "json"
                r = await h.post(f"{OLLAMA}/api/chat", json=body)
    except httpx.ConnectError:
        raise HTTPException(503, f"Ollama isn't running at {OLLAMA}. Start it with: ollama serve")
    except httpx.TimeoutException:
        raise HTTPException(504, "The model took too long to answer. Try a smaller model (STORYFORGE_MODEL), a shorter passage, or switch to a cloud API key.")
    if r.status_code == 404:
        raise HTTPException(503, f"The model '{model}' isn't installed. Run: ollama pull {model}")
    if r.status_code >= 400:
        raise HTTPException(502, f"Ollama returned an error: {r.text[:200]}")
    return parse_json_reply((r.json().get("message") or {}).get("content", ""))


def cloud_error(r: httpx.Response, c: dict) -> HTTPException:
    if r.status_code in (401, 403):
        return HTTPException(401, f"{c['label']} rejected the API key. Check it in the AI pill at the top.")
    if r.status_code == 404:
        return HTTPException(502, f"{c['label']} doesn't know the model '{c['model']}' (or the base URL is wrong). Check them in the AI pill.")
    if r.status_code == 429:
        return HTTPException(429, f"{c['label']} says you're over the rate limit or out of credit. Try again shortly.")
    return HTTPException(502, f"{c['label']} returned an error ({r.status_code}): {r.text[:200]}")


async def chat_cloud(c: dict, system: str, user: str, schema: dict) -> dict:
    p, key, model, base = c["provider"], c["key"], c["model"], c["base_url"]
    sys2 = system + "\nReply with ONE JSON object only (no markdown), matching this JSON Schema:\n" + json.dumps(schema)
    try:
        async with httpx.AsyncClient(timeout=min(AI_TIMEOUT, 120)) as h:
            if p == "openai":
                body = {"model": model, "temperature": 0.8, "max_tokens": 1500, "response_format": {"type": "json_object"},
                        "messages": [{"role": "system", "content": sys2}, {"role": "user", "content": user}]}
                hd = {"Authorization": f"Bearer {key}"}
                r = await h.post(f"{base}/chat/completions", headers=hd, json=body)
                if r.status_code == 400 and "response_format" in r.text:   # some compatible servers lack JSON mode
                    body.pop("response_format")
                    r = await h.post(f"{base}/chat/completions", headers=hd, json=body)
            elif p == "anthropic":
                r = await h.post(f"{base}/v1/messages", headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                                 json={"model": model, "max_tokens": 1500, "temperature": 0.8, "system": sys2,
                                       "messages": [{"role": "user", "content": user}]})
            else:
                r = await h.post(f"{base}/v1beta/models/{model}:generateContent", headers={"x-goog-api-key": key},
                                 json={"systemInstruction": {"parts": [{"text": sys2}]},
                                       "contents": [{"role": "user", "parts": [{"text": user}]}],
                                       "generationConfig": {"temperature": 0.8, "maxOutputTokens": 1500, "responseMimeType": "application/json"}})
    except httpx.TimeoutException:
        raise HTTPException(504, f"{c['label']} took too long to answer. Please try again.")
    except httpx.HTTPError:
        raise HTTPException(503, f"Couldn't reach {c['label']} ({base}). Check your internet connection and the base URL.")
    if r.status_code >= 400:
        raise cloud_error(r, c)
    try:
        j = r.json()
        if p == "openai":
            content = j["choices"][0]["message"]["content"]
        elif p == "anthropic":
            content = "".join(b.get("text", "") for b in j["content"] if isinstance(b, dict))
        else:
            content = "".join(x.get("text", "") for x in j["candidates"][0]["content"]["parts"])
    except (KeyError, IndexError, TypeError, ValueError):
        raise HTTPException(502, f"{c['label']} sent a reply this app couldn't read. Please try again.")
    return parse_json_reply(content)


SYSTEM = (
    "You are a writing partner inside Story Forge, a tool where a human is the author. "
    "You only SUGGEST; the author decides what is kept. Match the author's language, script, voice, tone and point of view. "
    "Never put commentary, markdown or headings inside story text. Reply ONLY with JSON in the requested shape."
)


def tree_notes(tree) -> list[dict]:
    """Story notes the AI may treat as established: human-approved only (never rejected or still-proposed AI ideas)."""
    out = []
    for n in tree if isinstance(tree, list) else []:
        if not isinstance(n, dict) or n.get("type") == "story" or n.get("origin") == "rejected":
            continue
        if n.get("origin") == "ai" and not n.get("canon"):
            continue
        out.append(n)
    return out[:40]


def context_block(p: dict) -> str:
    st = p.get("settings") if isinstance(p.get("settings"), dict) else {}
    lines = [f"BOOK TITLE: {s(p.get('title'), 120) or 'Untitled'}"]
    meta = [f"{k}: {s(st.get(k), 60)}" for k in ("genre", "tone", "pov") if st.get(k)]
    if meta:
        lines.append("STYLE — " + "; ".join(meta))
    notes = []
    for n in tree_notes(p.get("tree")):
        d = n.get("data") if isinstance(n.get("data"), dict) else {}
        desc = s(d.get("description") or d.get("notes") or "", 160)
        notes.append(f"- [{s(n.get('type'), 12)}] {s(n.get('title'), 80)}" + (f": {desc}" if desc else ""))
    if notes:
        lines.append("STORY NOTES (established by the author):\n" + "\n".join(notes)[:1800])
    text = s(p.get("text"), 2_000_000)
    if text:
        lines.append("STORY SO FAR (end of text):\n" + text[-MAX_TEXT_CHARS:])
    return "\n\n".join(lines)


# ------------------------------------------------------------------ health
@app.get("/health")
async def health():
    c, ready, detail = await ai_status()
    stt = importlib.util.find_spec("faster_whisper") is not None
    return {
        "status": "ok",
        "ai": {"ready": ready, "provider": c["provider"], "label": c["label"], "model": c["model"], "detail": detail},
        "transcribe": {"ready": stt, "model": WHISPER_SIZE,
                       "detail": None if stt else "Install with: python3 -m pip install faster-whisper --break-system-packages"},
    }


# ------------------------------------------------------------------ AI engine settings
@app.get("/api/settings")
def get_settings():
    st = load_settings()
    active = cfg()["provider"]
    out = {"provider": active, "last_cloud": st.get("last_cloud") if st.get("last_cloud") in PROVIDERS else "openai", "providers": {}}
    for name, d in PROVIDERS.items():
        c = provider_cfg(name, st)
        out["providers"][name] = {"label": d["label"], "model": c["model"], "default_model": d["model"], "base_url": c["base_url"],
                                  "has_key": bool(c["key"]), "key_hint": c["key"][-4:] if len(c["key"]) >= 8 else "", "from_env": c["from_env"]}
    return out


@app.put("/api/settings")
def put_settings(p: dict = Body(...)):
    prov = p.get("provider")
    if prov not in PROVIDERS:
        raise HTTPException(400, "Unknown AI engine.")
    st = load_settings()
    mine = st.get(prov) if isinstance(st.get(prov), dict) else {}
    if prov != "ollama":
        if "model" in p:
            mine["model"] = s(p.get("model"), 100)
        if "base_url" in p:
            u = s(p.get("base_url"), 200)
            if u and not re.match(r"^https?://[^\s]+$", u):
                raise HTTPException(422, "The base URL must start with https:// (or http://).")
            mine["base_url"] = u
        key = s(p.get("api_key"), 400)
        if key:
            if re.search(r"\s", key):
                raise HTTPException(422, "That API key contains spaces or line breaks. Paste just the key.")
            mine["api_key"] = key
        if p.get("clear_key"):
            mine.pop("api_key", None)
        st["last_cloud"] = prov
    elif "model" in p:
        mine["model"] = s(p.get("model"), 100)
    st[prov] = mine
    st["provider"] = prov
    save_settings(st)
    return {"saved": True, "provider": prov}


@app.post("/api/settings/test")
async def test_settings():
    """One tiny real call to the active engine, so the author knows it works before writing."""
    c, ready, detail = await ai_status()
    if not ready:
        raise HTTPException(503, detail or "The AI engine isn't ready.")
    await chat("Reply with JSON only.", 'Return {"ok": true}.', {"type": "object", "properties": {"ok": {"type": "boolean"}}})
    return {"ok": True, "provider": c["provider"], "model": c["model"]}


# ------------------------------------------------------------------ stories (plain JSON files)
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def story_path(story_id: str) -> Path:
    if not ID_RE.match(story_id or ""):
        raise HTTPException(400, "That story id isn't valid.")
    return DATA / f"{story_id}.json"


def write_story(story_id: str, payload: dict) -> dict:
    raw = json.dumps(payload, ensure_ascii=False)
    if len(raw.encode()) > MAX_STORY_BYTES:
        raise HTTPException(413, "That story is too large to store.")
    path = story_path(story_id)
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(raw, encoding="utf-8")
    tmp.replace(path)                                    # atomic: a crash never leaves a half-written story
    return {"id": story_id, "saved": True}


@app.post("/api/stories")
def create_story(payload: dict = Body(...)):
    inner = payload.get("story") if isinstance(payload.get("story"), dict) else payload
    story_id = s(inner.get("id") or payload.get("id"), 64) or uuid.uuid4().hex[:12]
    return write_story(story_id, payload)


@app.get("/api/stories/{story_id}")
def get_story(story_id: str):
    path = story_path(story_id)
    if not path.exists():
        raise HTTPException(404, "No story with that id is stored on the backend.")
    return json.loads(path.read_text(encoding="utf-8"))


@app.put("/api/story/{story_id}")
def put_story(story_id: str, payload: dict = Body(...)):
    return write_story(story_id, payload)                # upsert


# ------------------------------------------------------------------ suggestions
ACTIONS = {
    "rewrite": ("Rewrite the selected passage so it reads better, keeping its meaning, facts and the author's voice.", True),
    "expand": ("Expand the selected passage with more vivid detail and depth. Keep its meaning and voice; add nothing that contradicts the story.", True),
    "shorten": ("Shorten the selected passage, keeping the essential meaning and the author's voice.", True),
    "improve_description": ("Improve the descriptive quality of the selected passage: sharper imagery and word choice, same facts.", True),
    "improve_voice": ("The text is a raw voice transcript of the author's spoken idea and may lack punctuation or contain filler. Turn it into clean story prose that keeps every idea the author expressed and adds no new plot facts.", True),
    "ai_suggest": ("Offer one improved alternative to the selected passage, keeping the author's intent.", True),
    "continue_scene": ("Write the next short passage (about 80-150 words) that continues the story from where the text ends. Follow established facts, tone and point of view.", False),
    "dialogue": ("Write a short piece of dialogue (4-8 lines) that fits the current moment and the characters in the notes.", False),
    "atmosphere": ("Write 2-3 sentences of atmosphere (setting, light, sound, mood) that could be added at the current moment.", False),
    "character_reaction": ("Suggest how the main character in this moment would react, as 2-4 sentences of story prose.", False),
    "foreshadowing": ("Suggest a subtle piece of foreshadowing (1-3 sentences of story prose) that hints at what the story notes imply.", False),
}
SUGGEST_SCHEMA = {"type": "object", "required": ["suggestions"], "properties": {"suggestions": {"type": "array", "items": {
    "type": "object", "required": ["text", "rationale"], "properties": {"text": {"type": "string"}, "rationale": {"type": "string"}}}}}}


@app.post("/api/story/suggest")
async def suggest(p: dict = Body(...)):
    action = s(p.get("action"), 40) or "ai_suggest"
    if action not in ACTIONS:
        raise HTTPException(400, f"Unknown action '{action}'.")
    instruction, needs_selection = ACTIONS[action]
    selection = s(p.get("selection"), 6000)
    if needs_selection and not selection:
        raise HTTPException(400, "Select the passage you want changed first, then try again.")
    if not selection and not s(p.get("text"), 50):
        raise HTTPException(400, "Write a few sentences first so the AI has something to work from.")
    user = (context_block(p) + (f"\n\nSELECTED PASSAGE:\n{selection}" if selection else "") + f"\n\nTASK: {instruction}\n"
            'Return JSON: {"suggestions":[{"text":"the suggested text","rationale":"one short sentence on what you did and why"}]} with exactly one suggestion.')
    data = await chat(SYSTEM, user, SUGGEST_SCHEMA)
    for item in data.get("suggestions") or []:
        text = s(item.get("text") if isinstance(item, dict) else item, 8000)
        if text:
            return {"suggestions": [{"id": uuid.uuid4().hex[:10], "text": text,
                                     "rationale": s(item.get("rationale"), 300) if isinstance(item, dict) else ""}]}
    raise HTTPException(502, "The model returned no usable suggestion. Please try again.")


# ------------------------------------------------------------------ analyze: propose story-graph nodes from the text
NODE_TYPES = {"character", "location", "event", "mystery", "idea"}
ANALYZE_SCHEMA = {"type": "object", "required": ["nodes"], "properties": {"nodes": {"type": "array", "items": {
    "type": "object", "required": ["type", "title", "description"],
    "properties": {"type": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}, "role": {"type": "string"}}}}}}


@app.post("/api/story/analyze")
async def analyze(p: dict = Body(...)):
    if len(s(p.get("text"), 10_000)) < 40:
        raise HTTPException(400, "Write a little more of the story first, then analyze it.")
    user = (context_block(p) + "\n\nTASK: Read the story and list the characters, locations, key events and mysteries that appear IN THE TEXT. "
            "Only include things actually present; never invent. Use type = character | location | event | mystery | idea. "
            'Return JSON: {"nodes":[{"type":"character","title":"short name","description":"one sentence from the text","role":"only for characters"}]} with at most 10 nodes.')
    data = await chat(SYSTEM, user, ANALYZE_SCHEMA)
    have = {s(n.get("title"), 120).lower() for n in (p.get("tree") if isinstance(p.get("tree"), list) else []) if isinstance(n, dict)}
    nodes = []
    for n in data.get("nodes") or []:
        if not isinstance(n, dict):
            continue
        kind, title = s(n.get("type"), 20).lower(), s(n.get("title"), 120)
        if kind not in NODE_TYPES or not title or title.lower() in have:
            continue
        have.add(title.lower())
        d = {"description": s(n.get("description"), 600)}
        if kind == "character" and n.get("role"):
            d["role"] = s(n.get("role"), 80)
        nodes.append({"type": kind, "title": title, "parent_id": None, "data": d, "links": []})
    return {"nodes": nodes[:10]}


# ------------------------------------------------------------------ continuity
CONT_SCHEMA = {"type": "object", "required": ["conflicts"], "properties": {"conflicts": {"type": "array", "items": {
    "type": "object", "required": ["issue", "detail"], "properties": {
        "issue": {"type": "string"}, "detail": {"type": "string"}, "node_ids": {"type": "array", "items": {"type": "string"}}}}}}}


@app.post("/api/story/continuity")
async def continuity(p: dict = Body(...)):
    if len(s(p.get("text"), 10_000)) < 40:
        raise HTTPException(400, "Write a little more of the story first.")
    ids = {s(n.get("id"), 24) for n in tree_notes(p.get("tree")) if isinstance(n, dict)}
    listing = "\n".join(f"- id={s(n.get('id'), 24)} {s(n.get('title'), 80)}" for n in tree_notes(p.get("tree")))
    user = (context_block(p) + (f"\n\nNOTE IDS:\n{listing}" if listing else "") +
            "\n\nTASK: Find CLEAR contradictions inside the story text, or between the text and the story notes (names, ages, places, timeline, who knows what). "
            "Report only real contradictions you can point to; if there are none, return an empty list. "
            'Return JSON: {"conflicts":[{"issue":"short title","detail":"what contradicts what","node_ids":["ids of related notes, if any"]}]}')
    data = await chat(SYSTEM, user, CONT_SCHEMA)
    out = []
    for c in data.get("conflicts") or []:
        if isinstance(c, dict) and s(c.get("issue"), 160):
            out.append({"issue": s(c.get("issue"), 160), "detail": s(c.get("detail"), 600),
                        "node_ids": [i for i in (c.get("node_ids") or []) if isinstance(i, str) and i in ids]})
    return {"conflicts": out[:8]}


# ------------------------------------------------------------------ twist
TWIST_KEYS = ["title", "description", "why", "related", "foreshadowing", "affected", "consequences", "compatibility"]
TWIST_SCHEMA = {"type": "object", "required": ["twist"], "properties": {"twist": {
    "type": "object", "required": ["title", "description"], "properties": {k: {"type": "string"} for k in TWIST_KEYS}}}}


@app.post("/api/story/twist")
async def twist(p: dict = Body(...)):
    if len(s(p.get("text"), 10_000)) < 40:
        raise HTTPException(400, "Write a little more of the story first so a twist can fit it.")
    alt = p.get("alternative_to") if isinstance(p.get("alternative_to"), dict) else None
    avoid = f"\nThe author already has this twist and wants a DIFFERENT one: {s(alt.get('title'), 120)} — {s((alt.get('data') or {}).get('description'), 300)}" if alt else ""
    user = (context_block(p) + avoid + "\n\nTASK: Propose one plot twist that fits this story and its established notes. Explain it for the author. "
            'Return JSON: {"twist":{"title":"short title","description":"the twist, 2-3 sentences","why":"why it fits this story","related":"characters involved",'
            '"foreshadowing":"how earlier scenes could hint at it","affected":"events it changes","consequences":"what may follow","compatibility":"how well it fits the story so far"}}')
    data = await chat(SYSTEM, user, TWIST_SCHEMA)
    t = data.get("twist") if isinstance(data.get("twist"), dict) else {}
    out = {k: s(t.get(k), 800) for k in TWIST_KEYS}
    if not out["title"] or not out["description"]:
        raise HTTPException(502, "The model returned an incomplete twist. Please try again.")
    return {"twist": out}


# ------------------------------------------------------------------ speech to text (optional, local)
_whisper = None
_wlock = threading.Lock()


def load_audio(path: str):
    """16 kHz mono float32. Uses faster-whisper's decoder, with a fallback for older PyAV builds that
    reject its `metadata_errors` argument (the 'open() got an unexpected keyword argument' crash)."""
    from faster_whisper.audio import decode_audio
    try:
        return decode_audio(path, sampling_rate=16000)
    except TypeError:
        import av
        import numpy as np
        rs = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
        parts = []

        def take(out):
            for f in (out if isinstance(out, list) else [out]):
                if f is not None:
                    parts.append(f.to_ndarray().reshape(-1))
        with av.open(path) as ct:
            for frame in ct.decode(audio=0):
                take(rs.resample(frame))
        take(rs.resample(None))
        if not parts:
            raise ValueError("no audio could be decoded from that recording")
        return np.concatenate(parts).astype(np.float32) / 32768.0


@app.post("/api/transcribe")
def transcribe(audio: UploadFile = File(...), language: str = Form("en")):
    global _whisper
    if importlib.util.find_spec("faster_whisper") is None:
        raise HTTPException(501, "Speech-to-text isn't installed. Run: python3 -m pip install faster-whisper --break-system-packages")
    data = audio.file.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "That recording is too long. Try a shorter one.")
    if len(data) < 500:
        raise HTTPException(422, "That recording was empty. Try again.")
    with _wlock:                                        # load the model once, on first use
        if _whisper is None:
            from faster_whisper import WhisperModel
            try:
                _whisper = WhisperModel(WHISPER_SIZE, device="cpu", compute_type="int8")
            except Exception as e:
                raise HTTPException(503, f"Could not load the '{WHISPER_SIZE}' speech model (the first run downloads it, so it needs internet): {e}")
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(data)
        path = f.name
    try:
        segments, info = _whisper.transcribe(load_audio(path), language=None if language in ("", "auto") else language, vad_filter=True, beam_size=1)
        text = " ".join(x.text.strip() for x in segments).strip()
    except Exception as e:
        raise HTTPException(500, f"Transcription failed: {e}")
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    if not text:
        raise HTTPException(422, "No speech detected. Try again a little closer to the microphone.")
    return {"text": text, "language": getattr(info, "language", language)}


# ------------------------------------------------------------------ PDF
FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu", "/Library/Fonts", "C:/Windows/Fonts"]


def find_font(*names: str) -> str | None:
    for d in FONT_DIRS:
        for n in names:
            if (Path(d) / n).exists():
                return str(Path(d) / n)
    return None


@app.post("/api/export/pdf")
def export_pdf(p: dict = Body(...)):
    try:
        from fpdf import FPDF
    except ImportError:
        raise HTTPException(501, "PDF export isn't installed. Run: python3 -m pip install fpdf2 --break-system-packages")
    title = s(p.get("title"), 200) or "Untitled story"
    blocks = p.get("blocks")
    if not isinstance(blocks, list):                      # plain-text fallback: paragraphs split on blank lines
        blocks = [{"kind": "p", "text": t} for t in re.split(r"\n\s*\n", s(p.get("text"), 5_000_000)) if t.strip()]
    reg, bold = find_font("DejaVuSerif.ttf"), find_font("DejaVuSerif-Bold.ttf")
    pdf = FPDF(format="A5")
    pdf.set_margins(20, 22, 20)
    pdf.set_auto_page_break(True, 20)
    unicode_ok = bool(reg and bold)
    if unicode_ok:
        pdf.add_font("Body", "", reg)
        pdf.add_font("Body", "B", bold)
        family = "Body"
    else:
        family = "Times"

    def clean(t: str) -> str:
        t = t.replace("⟦AI: ", "[AI: ").replace("⟧", "]")
        return t if unicode_ok else t.encode("latin-1", "replace").decode("latin-1")

    pdf.add_page()
    pdf.set_y(70)
    pdf.set_font(family, "B", 24)
    pdf.multi_cell(0, 11, clean(title), align="C", new_x="LMARGIN", new_y="NEXT")
    started = False
    for b in blocks:
        if not isinstance(b, dict) or not s(b.get("text"), 100000):
            continue
        kind, text = s(b.get("kind"), 10), clean(s(b.get("text"), 100000))
        if kind == "chapter":
            pdf.add_page()
            pdf.set_font(family, "B", 18)
            pdf.multi_cell(0, 9, text, new_x="LMARGIN", new_y="NEXT")
            pdf.ln(5)
        else:
            if not started:
                pdf.add_page()
            if kind == "scene":
                pdf.ln(4)
            pdf.set_font(family, "", 11)
            pdf.multi_cell(0, 6.2, text, new_x="LMARGIN", new_y="NEXT")
            pdf.ln(2.5)
        started = True
    name = re.sub(r"[^\w\-]+", "_", title).strip("_") or "story"
    return Response(bytes(pdf.output()), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})

# Story Forge

**Where human imagination meets AI.** An AI-assisted storytelling app where *you* are always the author. The AI only suggests; nothing is ever overwritten silently, and every line is marked as human-written or AI-made.

## Features
- Write in a clean "paper" editor. Type `#` on a new line to make a **chapter** or **scene** (or `Ctrl+Alt+1` / `2` / `0`).
- **Story graph** built from your chapters, scenes and notes (characters, events, twists…), with human / AI origin shown on every node.
- **AI suggestions** with a side-by-side compare: Rewrite, Shorten, Improve voice, Continue scene, Plot twist, Find continuity conflicts, Analyze story into notes.
- **Voice input** (speech-to-text, English / Hindi / auto) via faster-whisper.
- **Choose your AI:** local Ollama (private, free) or your own API key (OpenAI-compatible, Anthropic Claude, Google Gemini). Switch by clicking the AI pill at the top.
- Save / import `.storyforge.json`, Markdown and HTML; export PDF. Works offline for writing; AI features need the backend.

## Requirements
- Linux, macOS or Windows with **Python 3.10+**
- For local AI: [Ollama](https://ollama.com). A small model such as `llama3.2:1b` runs on 2 GB RAM machines (slowly).
- Optional: a Chrome-based browser for the microphone.

## Quick start
```bash
git clone https://github.com/DEMONGODhub/storyforge..git && cd storyforge
python3 -m pip install -r backend/requirements.txt --break-system-packages   # drop the flag inside a venv
ollama pull llama3.2:1b                                                       # only for local AI
chmod +x run.sh && ./run.sh
```
Open **http://127.0.0.1:5500** (the backend is on :8000; `:8000/health` shows its status. `{"detail":"Not Found"}` at :8000 is normal).

## How to use
1. Click **Begin**, give the story a title, and write.
2. Shape the book: on a new line type `#`, pick *Chapter* or *Scene*. Click a chapter or scene in the left map to jump to it. The graph appears once you have at least one.
3. Select some text and use the floating toolbar (Rewrite, Shorten, …). A **Compare** window shows your original and the AI's suggestion. **Accept**, **Edit then accept**, or **Reject**. Only Accept changes your story, and Restore brings the original back.
4. Use the **AI** tab for twists, continuity checks and more. AI ideas appear as *proposed* nodes in the graph; accept or reject them in **Details**.
5. **Save** often. The story is kept in the browser and copied to `backend/data/stories/`. **Export** to download a `.storyforge.json`, Markdown, HTML or PDF; **More → Import** loads it back with the graph.

### Choosing the AI
Click the pill (**● AI online · Local**). Pick **Local** (Ollama) or **Cloud**, paste your key, choose the model, press **Test it**, then **Save & use this**. Keys are stored in `backend/data/settings.json` (owner-only) and never shown again. With Cloud, the passage you ask about is sent to that provider.
Env fallbacks: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `STORYFORGE_PROVIDER`.

### Voice input
```bash
python3 -m pip install faster-whisper --break-system-packages
```
Tap the mic, speak a full sentence, tap again. The first use downloads the speech model (needs internet). If decoding fails with `metadata_errors`, update PyAV: `python3 -m pip install -U av --break-system-packages`.

## Configuration (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `STORYFORGE_MODEL` | `llama3.2:1b` | Ollama model |
| `STORYFORGE_WHISPER` | `tiny` | Whisper size (`tiny`, `base`, `small`) |
| `STORYFORGE_NUM_CTX` | `4096` | Ollama context window |
| `STORYFORGE_AI_TIMEOUT` | `300` | seconds to wait for the AI |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | where Ollama listens |
| `STORYFORGE_DATA` | `backend/data` | stories + settings folder |
| `STORYFORGE_ORIGINS` | `http://127.0.0.1:5500,http://localhost:5500` | allowed web origins |

## Troubleshooting
- **AI pill says "AI not ready":** hover it for the exact fix (`ollama serve`, `ollama pull <model>`, or add an API key).
- **Backend crashes on `websockets` import:** `run.sh` already starts uvicorn with `--ws none`.
- **Slow answers on a weak PC:** use a smaller model, a shorter selection, or switch to a cloud key.

## Project layout
```
frontend/   index.html, style.css, app.js, assets/   (vanilla JS, no build step)
backend/    main.py (FastAPI), requirements.txt
run.sh      starts both servers
```
Back up `backend/data/`; don't commit it (it contains your stories and API keys).

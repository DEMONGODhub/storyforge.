#!/usr/bin/env bash
# One command starts everything:   ./run.sh      (stop with Ctrl+C)
#   frontend  http://127.0.0.1:5500      backend  http://127.0.0.1:8000
# The AI needs Ollama running with a model:   ollama serve   and   ollama pull llama3.2:1b
# Pick another model:   STORYFORGE_MODEL=qwen2.5:3b ./run.sh
cd "$(dirname "$0")" || exit 1
python3 -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 --ws none &
API=$!
trap 'kill $API 2>/dev/null' EXIT INT TERM
echo "Story Forge → open http://127.0.0.1:5500"
python3 -m http.server 5500 --bind 127.0.0.1 --directory frontend

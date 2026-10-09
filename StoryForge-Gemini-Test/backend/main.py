"""Story Forge AI Backend - FastAPI Application.

AI Orchestration Layer for Human-in-the-Loop Storytelling:
- Listener / Transcription (ai/listener.py)
- Story Architect (ai/architect.py)
- Continuity Keeper (ai/continuity.py)
- Creative Co-Author (ai/creative.py)
- Twist Engine (ai/twists.py)
- Literary Editor (ai/editor.py)
- Semantic Memory Retrieval (ai/retrieval.py)
- Story Graph (story/graph.py)
- Canon & Origin Tracking (story/canon.py)
- SQLite Persistence (database/database.py)
- Book Engine (export/pdf.py, export/epub.py)
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.config import settings
from backend.database.database import db
from backend.ai.gemini_client import GeminiAPIError

from backend.api.stories import router as stories_router
from backend.api.audio import router as audio_router
from backend.api.suggestions import router as suggestions_router
from backend.api.export import router as export_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ensure database schema is initialized
    db.init_db()
    yield
    # Shutdown logic if needed


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AI Orchestration Layer and Story Graph Engine for Story Forge",
    lifespan=lifespan
)

# Enable CORS for browser frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(GeminiAPIError)
async def gemini_api_error_handler(request: Request, exc: GeminiAPIError):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "GeminiAPIError",
            "message": exc.message,
            "details": exc.details
        }
    )


# Root & Health Check Endpoints
@app.get("/")
def get_root():
    return {
        "app": "Story Forge AI Backend",
        "version": settings.APP_VERSION,
        "purpose": "AI-assisted storytelling architecture preserving human canon control",
        "core_principle": "AI can suggest, but the writer always has final control.",
        "endpoints": [
            "GET /health",
            "POST /api/stories",
            "GET /api/stories/{story_id}",
            "PUT /api/story/{story_id}",
            "POST /api/transcribe",
            "POST /api/story/analyze",
            "POST /api/story/suggest",
            "POST /api/story/continuity",
            "POST /api/story/twist",
            "POST /api/export/pdf",
            "POST /api/export/epub"
        ]
    }


@app.get("/health")
def get_health():
    key_configured = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip() and settings.GEMINI_API_KEY != "MY_GEMINI_API_KEY")
    return {
        "status": "healthy",
        "service": "story-forge-ai",
        "database": "sqlite_connected",
        "gemini_configured": key_configured,
        "model_primary": settings.MODEL_FLASH,
        "model_transcribe": settings.MODEL_TRANSCRIBE
    }


# Include Routers
app.include_router(stories_router)
app.include_router(audio_router)
app.include_router(suggestions_router)
app.include_router(export_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=True)

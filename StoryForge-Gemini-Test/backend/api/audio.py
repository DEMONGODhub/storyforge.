"""Audio & Transcription API Router.

Implements POST /api/transcribe contract.
Returns raw transcript, cleaned interpretation, and status.
Guarantees AI-proposed interpretation is never silently inserted into canon.
"""

import base64
from typing import Optional
from fastapi import APIRouter, Request, File, UploadFile, Form, HTTPException, status
from pydantic import BaseModel
import json

from backend.ai.listener import listener_service
from backend.ai.gemini_client import GeminiAPIError

router = APIRouter(tags=["Audio"])


class TranscribeJsonRequest(BaseModel):
    audio_base64: Optional[str] = None
    mime_type: Optional[str] = "audio/webm"
    raw_text: Optional[str] = None


@router.post("/api/transcribe")
async def transcribe_audio(request: Request):
    """
    Accepts speech input via either:
    1. application/json: { "audio_base64": "...", "raw_text": "...", "mime_type": "..." }
    2. multipart/form-data: file upload (audio) or form text field 'raw_text'
    Returns:
    - raw_transcript
    - cleaned_transcript
    - confidence
    - status
    - canon_status: AI_PROPOSED
    """
    audio_bytes: Optional[bytes] = None
    mime_type: str = "audio/webm"
    preliminary_text: Optional[str] = None

    content_type = request.headers.get("content-type", "")

    if "application/json" in content_type:
        try:
            body = await request.json()
            preliminary_text = body.get("raw_text")
            b64_audio = body.get("audio_base64")
            if b64_audio:
                audio_bytes = base64.b64decode(b64_audio)
                mime_type = body.get("mime_type", "audio/webm")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON payload: {str(e)}")
    elif "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        form = await request.form()
        preliminary_text = form.get("raw_text")
        uploaded = form.get("file")
        if uploaded and hasattr(uploaded, "read"):
            audio_bytes = await uploaded.read()
            mime_type = getattr(uploaded, "content_type", "audio/webm") or "audio/webm"
    else:
        # Try JSON parse fallback
        try:
            body = await request.json()
            preliminary_text = body.get("raw_text")
            b64_audio = body.get("audio_base64")
            if b64_audio:
                audio_bytes = base64.b64decode(b64_audio)
                mime_type = body.get("mime_type", "audio/webm")
        except Exception:
            pass

    if not audio_bytes and not preliminary_text:
        raise HTTPException(
            status_code=400,
            detail="Either an audio file, base64 audio, or preliminary raw text must be provided."
        )

    try:
        result = listener_service.process_transcription(
            audio_bytes=audio_bytes,
            mime_type=mime_type,
            preliminary_raw_text=preliminary_text
        )
        return {
            "raw_transcript": result.raw_transcript,
            "cleaned_transcript": result.cleaned_transcript,
            "confidence": result.confidence,
            "status": result.status,
            "canon_status": result.canon_status.value
        }
    except GeminiAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

"""Literary Editor AI Module.

Purpose:
Polishes prose cadence, imagery, voice consistency, and readability while preserving
the writer's distinct voice.

Every proposed edit is marked with canon_status: AI_PROPOSED.
"""

from typing import List, Optional
from pydantic import BaseModel, Field
from backend.story.canon import CanonStatus
from .gemini_client import ai_client, GeminiAPIError
from backend.config import settings


class StyleImprovement(BaseModel):
    category: str  # pacing, sensory, voice, clarity, diction
    original_phrase: str
    suggested_revision: str
    explanation: str


class PolishReport(BaseModel):
    original_text: str
    polished_text: str
    improvements: List[StyleImprovement] = Field(default_factory=list)
    pacing_critique: str = ""
    sensory_score: float = 0.85
    canon_status: CanonStatus = CanonStatus.AI_PROPOSED


class LiteraryEditor:
    def __init__(self):
        self.client = ai_client

    def polish(self, text: str, style_tone: Optional[str] = "literary speculative") -> PolishReport:
        if not text or not text.strip():
            raise GeminiAPIError("Text for literary editor cannot be empty", status_code=400)

        prompt = f"""
You are the Literary Editor in Story Forge.
Polishing Goal: Elevate the author's prose in the '{style_tone}' aesthetic while strictly honoring their core narrative meaning.
Do NOT erase their style. Offer tactile precision, rhythm, and clarity.

INPUT TEXT:
\"\"\"{text}\"\"\"

Generate JSON:
{{
  "polished_text": "Enhanced version of the prose...",
  "pacing_critique": "Assessment of sentence cadence and narrative velocity...",
  "sensory_score": 0.88,
  "improvements": [
    {{
      "category": "sensory",
      "original_phrase": "original text snippet",
      "suggested_revision": "polished text snippet",
      "explanation": "Why this enhances authorial impact."
    }}
  ]
}}
"""
        try:
            data = self.client.generate_json(prompt=prompt, model=settings.MODEL_FLASH)
            return PolishReport(
                original_text=text,
                polished_text=data.get("polished_text", text),
                improvements=[StyleImprovement(**i) for i in data.get("improvements", [])],
                pacing_critique=data.get("pacing_critique", "Balanced cadence."),
                sensory_score=float(data.get("sensory_score", 0.85)),
                canon_status=CanonStatus.AI_PROPOSED
            )
        except GeminiAPIError as e:
            raise e
        except Exception as e:
            raise GeminiAPIError(f"Literary Editor polish failed: {str(e)}", status_code=500)


literary_editor = LiteraryEditor()

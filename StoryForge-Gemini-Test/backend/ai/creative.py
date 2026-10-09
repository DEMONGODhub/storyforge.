"""Creative Co-Author AI Module.

Purpose:
Suggests narrative enhancements while respecting writer control:
- Sensory descriptions
- Dialogue alternatives
- Emotional reactions
- Atmospheric tone
- Scene ideas
- Subtle foreshadowing
- Alternate narrative possibilities

Every suggestion is tagged with canon_status: AI_PROPOSED.
The author explicitly decides whether to accept, edit, or reject.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from backend.story.canon import CanonStatus
from backend.story.graph import StoryGraph
from .gemini_client import ai_client, GeminiAPIError
from backend.config import settings


class CreativeSuggestionItem(BaseModel):
    id: str
    category: str  # description, dialogue, emotional_reaction, atmosphere, scene_idea, foreshadowing, alternate_branch
    title: str
    content: str
    rationale: str
    canon_status: CanonStatus = CanonStatus.AI_PROPOSED


class CreativeCoAuthorReport(BaseModel):
    story_id: str
    context_text: str
    suggestions: List[CreativeSuggestionItem] = Field(default_factory=list)


class CreativeCoAuthor:
    def __init__(self):
        self.client = ai_client

    def brainstorm(
        self,
        story_id: str,
        current_text: str,
        focus_prompt: Optional[str] = None,
        graph: Optional[StoryGraph] = None
    ) -> CreativeCoAuthorReport:
        """Generates collaborative writing suggestions tailored to the active scene."""
        if not current_text or not current_text.strip():
            raise GeminiAPIError("Current text context is required for creative suggestions", status_code=400)

        graph_summary = graph.to_summary_dict() if graph else {}

        system_instruction = (
            "You are the Creative Co-Author in Story Forge. Your role is not to replace the author's voice, "
            "but to inspire, enrich, and offer evocative storytelling options. "
            "You generate distinct creative options: rich sensory descriptions, poignant dialogue beats, "
            "visceral emotional beats, atmosphere, foreshadowing clues, and branch alternatives. "
            "Each suggestion must be tagged as AI_PROPOSED. The writer always holds the final brush."
        )

        focus_instruction = f"FOCUS GOAL: {focus_prompt}" if focus_prompt else "Provide a balanced variety of creative expansions."

        prompt = f"""
CURRENT SCENE PROSE / IDEA:
\"\"\"{current_text}\"\"\"

STORY CONTEXT:
{graph_summary}

{focus_instruction}

Generate a JSON object containing a list of creative suggestions:
{{
  "suggestions": [
    {{
      "id": "sugg_001",
      "category": "description",
      "title": "Mountain Gale Sensory Texture",
      "content": "The wind tore at the coarse weave of the woolen cloak, whipping salt and frost across the granite crag until his knuckles cracked white against the stone.",
      "rationale": "Amplifies the sensory isolation and heightens tactile reality of the cliff."
    }},
    {{
      "id": "sugg_002",
      "category": "foreshadowing",
      "title": "Faint Sigil on the Mountain Face",
      "content": "Beneath the creeping lichen near his boots, ancient grooves etched into the basalt matched the amulet hidden against his ribs.",
      "rationale": "Plants early visual evidence connecting Arin's ancestry to the mountain sanctuary."
    }},
    {{
      "id": "sugg_003",
      "category": "dialogue",
      "title": "Subdued Whisper to the Wind",
      "content": "'Elian. Mara. If you are anywhere in this mist, witness what I have become.'",
      "rationale": "Names the parents and articulates internal conflict without exposition."
    }}
  ]
}}
Respond with valid JSON only.
"""

        try:
            data = self.client.generate_json(
                prompt=prompt,
                system_instruction=system_instruction,
                model=settings.MODEL_FLASH
            )
            raw_items = data.get("suggestions", [])
            suggestions = [CreativeSuggestionItem(**item) for item in raw_items]
            return CreativeCoAuthorReport(
                story_id=story_id,
                context_text=current_text,
                suggestions=suggestions
            )
        except GeminiAPIError as e:
            raise e
        except Exception as e:
            raise GeminiAPIError(f"Creative Co-Author generation failed: {str(e)}", status_code=500)


creative_coauthor = CreativeCoAuthor()

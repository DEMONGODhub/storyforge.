"""Twist Engine AI Module.

Purpose:
Generates high-impact, logically grounded narrative plot twists based on:
- Existing mysteries
- Character secrets & private knowledge
- Foreshadowing clues
- Unresolved events
- Relational tensions
- Story themes

Each twist structure explains:
- id
- title
- description
- trigger_events
- affected_characters
- revealed_information
- foreshadowing
- consequences
- alternative_outcomes
- reason: Clear explanation of WHY the AI suggested this twist backed by story graph evidence.

Tagged with canon_status: AI_PROPOSED.
"""

from typing import List, Optional
from pydantic import BaseModel, Field
from backend.story.canon import CanonStatus
from backend.story.graph import StoryGraph
from .gemini_client import ai_client, GeminiAPIError
from backend.config import settings


class TwistProposal(BaseModel):
    id: str
    title: str
    description: str
    trigger_events: List[str] = Field(default_factory=list)
    affected_characters: List[str] = Field(default_factory=list)
    revealed_information: List[str] = Field(default_factory=list)
    foreshadowing: List[str] = Field(default_factory=list)
    consequences: List[str] = Field(default_factory=list)
    alternative_outcomes: List[str] = Field(default_factory=list)
    reason: str  # Answers: "Why did the AI suggest this twist?" with story graph evidence
    canon_status: CanonStatus = CanonStatus.AI_PROPOSED


class TwistReport(BaseModel):
    story_id: str
    theme: Optional[str] = None
    twists: List[TwistProposal] = Field(default_factory=list)


class TwistEngine:
    def __init__(self):
        self.client = ai_client

    def generate_twists(
        self,
        story_id: str,
        graph: Optional[StoryGraph] = None,
        theme: Optional[str] = None,
        count: int = 3
    ) -> TwistReport:
        """
        Synthesizes narrative twists by crossing mysteries, secret motives, and thematic threads.
        Always grounds suggestions in graph evidence.
        """
        graph_summary = graph.to_summary_dict() if graph else {
            "mysteries": [],
            "characters": [],
            "relationships": []
        }

        system_instruction = (
            "You are the Twist Engine in Story Forge. Your mission is to surprise the audience "
            "while delighting them with inevitable narrative logic. Great twists are not random; "
            "they re-contextualize existing clues, character secrets, and mysteries. "
            "Crucially, you must explain 'Why did the AI suggest this twist?' by citing specific "
            "mysteries, character relationships, and clues present in the story graph."
        )

        theme_note = f"Story Theme Focus: {theme}" if theme else "Theme: The complexity of truth and memory."

        prompt = f"""
STORY GRAPH KNOWLEDGE BASE:
{graph_summary}

{theme_note}
TARGET NUMBER OF TWISTS: {count}

Generate a JSON object with a 'twists' array containing {count} distinct plot twists:
{{
  "twists": [
    {{
      "id": "twist_001",
      "title": "The Whispered Names Belong to His Captors, Not Parents",
      "description": "Arin is not in mourning for loving parents; he is reciting the names of the imperial wardens who stole his identity as a childhood oath of vengeance.",
      "trigger_events": ["Arrival at the ruined fortress", "Discovery of the forged birth seal"],
      "affected_characters": ["Arin", "The Grand Warden"],
      "revealed_information": ["Arin's biological lineage was erased by decree"],
      "foreshadowing": ["He grips his cloak like armor rather than comfort", "His tone is rigid rather than tearful"],
      "consequences": ["Transforms Arin from a melancholic wanderer into a targeted insurgent"],
      "alternative_outcomes": ["He forgives the dying warden", "He discovers he is the warden's rightful heir"],
      "reason": "Derived from the mystery 'Fate of the Parents' and the secret that Arin is concealing an outlaw crest. This explains why he hides on a desolate mountain cliff whispering names in solitude."
    }}
  ]
}}
Respond with pure JSON only.
"""

        try:
            data = self.client.generate_json(
                prompt=prompt,
                system_instruction=system_instruction,
                model=settings.MODEL_FLASH
            )
            raw_twists = data.get("twists", [])
            twists = [TwistProposal(**item) for item in raw_twists]
            return TwistReport(
                story_id=story_id,
                theme=theme,
                twists=twists
            )
        except GeminiAPIError as e:
            raise e
        except Exception as e:
            raise GeminiAPIError(f"Twist Engine generation failed: {str(e)}", status_code=500)


twist_engine = TwistEngine()

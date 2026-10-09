"""Story Architect AI Module.

Purpose:
Extracts structured narrative topology from raw story input and existing graph context.
Outputs:
- characters (name, role, traits, goals, secrets, knowledge)
- locations
- events
- relationships
- timeline information
- mysteries
- ideas
- possible conflicts
- unresolved questions

All suggestions are strictly tagged with canon_status: AI_PROPOSED.
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from backend.story.canon import CanonStatus
from backend.story.graph import StoryGraph, GraphNode, GraphEdge, NodeType, EdgeType
from .gemini_client import ai_client, GeminiAPIError
from backend.config import settings


class CharacterExtraction(BaseModel):
    id: Optional[str] = None
    name: str
    role: str = "supporting"
    traits: List[str] = Field(default_factory=list)
    goals: List[str] = Field(default_factory=list)
    secrets: List[str] = Field(default_factory=list)
    knowledge: List[str] = Field(default_factory=list)
    emotional_state: Dict[str, Any] = Field(default_factory=dict)
    physical_state: Dict[str, Any] = Field(default_factory=dict)


class LocationExtraction(BaseModel):
    id: Optional[str] = None
    name: str
    description: str = ""


class EventExtraction(BaseModel):
    id: Optional[str] = None
    title: str
    description: str
    time: Optional[str] = None
    characters: List[str] = Field(default_factory=list)
    location: Optional[str] = None
    causes: List[str] = Field(default_factory=list)
    consequences: List[str] = Field(default_factory=list)


class RelationshipExtraction(BaseModel):
    source_name: str
    relation_type: str  # APPEARS_IN, OCCURS_AT, KNOWS, RELATED_TO, LOVES, HATES, FEARS, etc.
    target_name: str
    notes: Optional[str] = None


class MysteryExtraction(BaseModel):
    id: Optional[str] = None
    title: str
    description: str = ""
    clues: List[str] = Field(default_factory=list)
    unresolved: bool = True


class ArchitectAnalysisResult(BaseModel):
    """Structured response from Story Architect."""
    raw_input: str
    scene_id: Optional[str] = None
    characters: List[CharacterExtraction] = Field(default_factory=list)
    locations: List[LocationExtraction] = Field(default_factory=list)
    events: List[EventExtraction] = Field(default_factory=list)
    relationships: List[RelationshipExtraction] = Field(default_factory=list)
    timeline_information: List[str] = Field(default_factory=list)
    mysteries: List[MysteryExtraction] = Field(default_factory=list)
    ideas: List[str] = Field(default_factory=list)
    possible_conflicts: List[str] = Field(default_factory=list)
    unresolved_questions: List[str] = Field(default_factory=list)
    canon_status: CanonStatus = CanonStatus.AI_PROPOSED


class StoryArchitect:
    def __init__(self):
        self.client = ai_client

    def analyze_input(
        self,
        raw_text: str,
        current_graph: Optional[StoryGraph] = None,
        scene_id: Optional[str] = None
    ) -> ArchitectAnalysisResult:
        """
        Analyzes raw human input against the current graph context.
        Generates structured entities, relationships, mysteries, and questions.
        """
        if not raw_text or not raw_text.strip():
            raise GeminiAPIError("Raw text input cannot be empty", status_code=400)

        graph_summary = current_graph.to_summary_dict() if current_graph else {}

        system_instruction = (
            "You are the Story Architect for Story Forge. Your role is to analyze a writer's raw story fragment, "
            "decompose it into narrative primitives, and extract structured story graph elements. "
            "You must output valid JSON matching the requested schema. "
            "Never invent canonical facts outside the author's input; deduce character state, locations, "
            "events, relationships, mysteries, possible conflicts, and questions that naturally arise."
        )

        prompt = f"""
WRITER RAW INPUT:
"{raw_text}"

CURRENT STORY GRAPH CONTEXT:
{graph_summary}

CURRENT SCENE ID: {scene_id or 'scene_001'}

Extract structured information into a single JSON object with these exact keys:
{{
  "characters": [
    {{
      "name": "Arin",
      "role": "protagonist",
      "traits": ["somber", "cloaked"],
      "goals": ["commune with deceased parents"],
      "secrets": ["carrying an ancestral artifact"],
      "knowledge": ["location of the mountain cliff", "names of parents"],
      "emotional_state": {{"mood": "grief-stricken", "intensity": 0.8}},
      "physical_state": {{"health": "intact", "appearance": "black cloak"}}
    }}
  ],
  "locations": [
    {{
      "name": "Mountain Cliff",
      "description": "A sheer precipice under a vast blue sky."
    }}
  ],
  "events": [
    {{
      "title": "Whispering at the Cliff",
      "description": "A man in a black cloak stands on a mountain precipice, whispering his parents' names.",
      "time": "Day, clear sky",
      "characters": ["Arin"],
      "location": "Mountain Cliff",
      "causes": ["desire to remember parents"],
      "consequences": ["unsettled mountain winds, emotional catharsis"]
    }}
  ],
  "relationships": [
    {{
      "source_name": "Arin",
      "relation_type": "OCCURS_AT",
      "target_name": "Mountain Cliff",
      "notes": "Standing at the edge"
    }}
  ],
  "timeline_information": [
    "Event occurs under daytime blue sky at a high altitude cliff."
  ],
  "mysteries": [
    {{
      "title": "Fate of the Parents",
      "description": "Why is he whispering their names from a cliff? Did they perish or disappear?",
      "clues": ["Names spoken to the wind"],
      "unresolved": true
    }}
  ],
  "ideas": [
    "The wind carries back an echo that wasn't his own voice.",
    "The cloak bears a crest from an ancient fallen house."
  ],
  "possible_conflicts": [
    "A patrol climbs the mountain path, seeking an outlaw matching his description.",
    "The cliff is a sacred boundary where invoking the dead is forbidden."
  ],
  "unresolved_questions": [
    "What drove him to this specific precipice?",
    "What danger forced him into hiding?"
  ]
}}
Respond with pure JSON only.
"""

        data = self.client.generate_json(
            prompt=prompt,
            system_instruction=system_instruction,
            model=settings.MODEL_FLASH
        )

        return ArchitectAnalysisResult(
            raw_input=raw_text,
            scene_id=scene_id,
            characters=[CharacterExtraction(**c) for c in data.get("characters", [])],
            locations=[LocationExtraction(**loc) for loc in data.get("locations", [])],
            events=[EventExtraction(**ev) for ev in data.get("events", [])],
            relationships=[RelationshipExtraction(**rel) for rel in data.get("relationships", [])],
            timeline_information=data.get("timeline_information", []),
            mysteries=[MysteryExtraction(**m) for m in data.get("mysteries", [])],
            ideas=data.get("ideas", []),
            possible_conflicts=data.get("possible_conflicts", []),
            unresolved_questions=data.get("unresolved_questions", []),
            canon_status=CanonStatus.AI_PROPOSED
        )


story_architect = StoryArchitect()

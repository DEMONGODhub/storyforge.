"""Character Memory and Relationships."""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from .canon import CanonStatus


class CharacterRelationship(BaseModel):
    """Directed emotional or social tie between two characters."""
    target_character_id: str
    target_name: Optional[str] = None
    relation_type: str  # e.g., LOVES, HATES, FEARS, RELATED_TO, ALLY, RIVAL
    sentiment: float = 0.0  # -1.0 to 1.0
    notes: Optional[str] = None


class CharacterKnowledgeItem(BaseModel):
    """An atomic fact, secret, or event that this character is aware of."""
    id: str
    fact: str
    learned_in_scene: Optional[str] = None
    source_character_id: Optional[str] = None
    is_secret: bool = False
    confidence: float = 1.0


class CharacterState(BaseModel):
    """Structured character memory with knowledge tracking."""
    id: str
    name: str
    role: str = "supporting"  # protagonist, antagonist, supporting, etc.
    traits: List[str] = Field(default_factory=list)
    goals: List[str] = Field(default_factory=list)
    secrets: List[str] = Field(default_factory=list)
    knowledge: List[str] = Field(default_factory=list)  # Facts known to this character
    relationships: List[CharacterRelationship] = Field(default_factory=list)
    emotional_state: Dict[str, Any] = Field(default_factory=dict)
    physical_state: Dict[str, Any] = Field(default_factory=dict)
    history: List[str] = Field(default_factory=list)
    first_appearance: Optional[str] = None
    canon_status: CanonStatus = CanonStatus.HUMAN

    def knows(self, fact_phrase: str) -> bool:
        """Check if character is aware of a piece of information."""
        phrase_lower = fact_phrase.lower()
        return any(phrase_lower in k.lower() or k.lower() in phrase_lower for k in self.knowledge)

    def add_knowledge(self, fact: str) -> None:
        """Add a learned fact to character memory."""
        if fact not in self.knowledge:
            self.knowledge.append(fact)

"""Event Model and Timeline Engine."""

from typing import List, Optional
from pydantic import BaseModel, Field
from .canon import CanonStatus


class Event(BaseModel):
    """An event within the story universe connected to graph relationships."""
    id: str
    title: str
    description: str
    characters: List[str] = Field(default_factory=list)  # character IDs
    location: Optional[str] = None  # location ID
    time: Optional[str] = None  # timeline point, e.g. "Day 1, Sunset"
    sequence_order: int = 0
    causes: List[str] = Field(default_factory=list)  # IDs of events or actions that caused this
    consequences: List[str] = Field(default_factory=list)  # IDs of results or subsequent events
    related_mysteries: List[str] = Field(default_factory=list)  # Mystery IDs
    canon_status: CanonStatus = CanonStatus.HUMAN


class Timeline(BaseModel):
    """Chronological collection of events."""
    events: List[Event] = Field(default_factory=list)

    def add_event(self, event: Event) -> None:
        self.events.append(event)
        self.events.sort(key=lambda e: e.sequence_order)

    def get_ordered_events(self) -> List[Event]:
        return sorted(self.events, key=lambda e: e.sequence_order)

    def get_events_for_character(self, character_id: str) -> List[Event]:
        return [e for e in self.events if character_id in e.characters]

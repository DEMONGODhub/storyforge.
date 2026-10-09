"""Database Schema and DTO Models."""

from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from backend.story.canon import CanonStatus
from backend.story.graph import NodeType, EdgeType


class StoryModel(BaseModel):
    id: str
    title: str = "Untitled Story"
    genre: Optional[str] = "Fiction"
    synopsis: Optional[str] = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    meta: Dict[str, Any] = Field(default_factory=dict)


class ProseEntryModel(BaseModel):
    id: str
    story_id: str
    scene_id: Optional[str] = "scene_001"
    sequence_index: int = 0
    raw_human_input: str
    ai_interpretation: Optional[str] = None
    user_approved_text: Optional[str] = None
    canon_status: CanonStatus = CanonStatus.HUMAN
    history: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class StoryNodeModel(BaseModel):
    id: str
    story_id: str
    node_type: NodeType
    label: str
    properties: Dict[str, Any] = Field(default_factory=dict)
    canon_status: CanonStatus = CanonStatus.HUMAN
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class StoryEdgeModel(BaseModel):
    id: str
    story_id: str
    source_id: str
    target_id: str
    relation_type: EdgeType
    properties: Dict[str, Any] = Field(default_factory=dict)
    canon_status: CanonStatus = CanonStatus.HUMAN
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class SuggestionRecord(BaseModel):
    id: str
    story_id: str
    role: str  # architect, creative, twists, continuity, editor
    suggestion_type: str
    content: Dict[str, Any]
    canon_status: CanonStatus = CanonStatus.AI_PROPOSED
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

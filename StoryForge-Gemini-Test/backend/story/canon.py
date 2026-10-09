"""Canon Model and Origin Tracking.

Core principle: 'AI can suggest, but the writer always has final control.'
The AI must NOT silently replace the user's original text.
Preserves:
1. Raw human input
2. AI interpretation
3. User-approved version
"""

from enum import Enum
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from pydantic import BaseModel, Field


class CanonStatus(str, Enum):
    """Origin and canonical validation status of any piece of story content."""
    HUMAN = "HUMAN"                    # Canonical by default (direct author input)
    AI_PROPOSED = "AI_PROPOSED"        # NOT canonical (suggestions from any AI role)
    HUMAN_ACCEPTED = "HUMAN_ACCEPTED"  # Canonical (author accepted AI proposal as-is)
    HUMAN_EDITED = "HUMAN_EDITED"      # Canonical (author modified the suggestion)
    REJECTED = "REJECTED"              # NOT canonical (author rejected suggestion)


def is_canonical(status: CanonStatus) -> bool:
    """Returns True if the content is approved canonical content by the writer."""
    return status in (
        CanonStatus.HUMAN,
        CanonStatus.HUMAN_ACCEPTED,
        CanonStatus.HUMAN_EDITED
    )


class CanonAuditEntry(BaseModel):
    """Audit entry documenting changes to story content."""
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    action: str  # e.g., "created", "ai_interpreted", "accepted", "edited", "rejected"
    author: str  # "human" or "ai:<role>"
    previous_text: Optional[str] = None
    new_text: Optional[str] = None
    notes: Optional[str] = None


class CanonRecord(BaseModel):
    """
    Complete triple-layer representation of a story segment.
    Guarantees raw human text is never lost and AI proposals are clearly isolated.
    """
    id: str
    story_id: str
    scene_id: Optional[str] = None
    sequence_index: int = 0
    
    # Layer 1: Raw human text (verbatim voice or typed input)
    raw_human_input: str
    
    # Layer 2: AI interpretation / cleaned prose
    ai_interpretation: Optional[str] = None
    
    # Layer 3: Final user-approved canonical prose
    user_approved_text: Optional[str] = None
    
    # Canonical status
    canon_status: CanonStatus = CanonStatus.HUMAN
    
    # Audit history
    history: List[CanonAuditEntry] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def get_canonical_text(self) -> str:
        """Returns the current canonical text based on writer approval."""
        if self.canon_status in (CanonStatus.HUMAN_ACCEPTED, CanonStatus.HUMAN_EDITED):
            return self.user_approved_text or self.ai_interpretation or self.raw_human_input
        # Default fallback to human original
        return self.raw_human_input

    def accept_ai_interpretation(self) -> None:
        """Writer accepts the AI proposal without changes."""
        self.user_approved_text = self.ai_interpretation or self.raw_human_input
        self.canon_status = CanonStatus.HUMAN_ACCEPTED
        self.updated_at = datetime.now(timezone.utc).isoformat()
        self.history.append(
            CanonAuditEntry(
                action="accepted",
                author="human",
                previous_text=self.raw_human_input,
                new_text=self.user_approved_text,
                notes="Author accepted AI interpretation"
            )
        )

    def edit_and_approve(self, revised_text: str) -> None:
        """Writer modifies the prose and approves it as canonical."""
        prev = self.user_approved_text or self.ai_interpretation or self.raw_human_input
        self.user_approved_text = revised_text
        self.canon_status = CanonStatus.HUMAN_EDITED
        self.updated_at = datetime.now(timezone.utc).isoformat()
        self.history.append(
            CanonAuditEntry(
                action="edited",
                author="human",
                previous_text=prev,
                new_text=revised_text,
                notes="Author edited and finalized prose"
            )
        )

    def reject_proposal(self) -> None:
        """Writer rejects the AI proposal, reverting to original human text."""
        self.canon_status = CanonStatus.REJECTED
        self.updated_at = datetime.now(timezone.utc).isoformat()
        self.history.append(
            CanonAuditEntry(
                action="rejected",
                author="human",
                previous_text=self.ai_interpretation,
                new_text=self.raw_human_input,
                notes="Author rejected AI proposal; kept raw human input"
            )
        )

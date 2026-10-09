"""Continuity Keeper AI Module.

Purpose:
Detects plot holes, logic discrepancies, and canonical violations:
- Contradictions
- Character knowledge violations (e.g. acting on secrets before learning them)
- Timeline and chronology flaws
- Location & teleportation inconsistencies
- Relationship status violations
- Physical-state inconsistencies (e.g., wounded leg suddenly sprinting)

Returns:
- issue
- severity (HIGH, MEDIUM, LOW)
- evidence
- suggested_fix

Does NOT automatically alter canonical story content.
"""

from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field
from backend.story.canon import CanonStatus
from backend.story.graph import StoryGraph
from .gemini_client import ai_client, GeminiAPIError
from backend.config import settings


class SeverityLevel(str, Enum):
    HIGH = "HIGH"        # Direct factual contradiction or impossible state
    MEDIUM = "MEDIUM"    # Missing justification or suspicious leap
    LOW = "LOW"          # Minor style or atmospheric discrepancy


class ContinuityIssue(BaseModel):
    issue: str
    severity: SeverityLevel
    evidence: str
    suggested_fix: str
    category: str = "general"  # knowledge, timeline, location, relationship, physical, contradiction
    canon_status: CanonStatus = CanonStatus.AI_PROPOSED


class ContinuityReport(BaseModel):
    story_id: str
    analyzed_text: str
    issues_found: int
    issues: List[ContinuityIssue] = Field(default_factory=list)
    status: str = "OK"  # "OK" or "ISSUES_DETECTED"


class ContinuityKeeper:
    def __init__(self):
        self.client = ai_client

    def verify_continuity(
        self,
        story_id: str,
        text_to_check: str,
        graph: Optional[StoryGraph] = None
    ) -> ContinuityReport:
        """Checks narrative continuity against the canonical story graph."""
        if not text_to_check or not text_to_check.strip():
            raise GeminiAPIError("Text to check cannot be empty", status_code=400)

        # Build context of existing characters and their known facts
        graph_summary = graph.to_summary_dict() if graph else {"characters": [], "locations": [], "events": []}

        system_instruction = (
            "You are the Continuity Keeper in the Story Forge architecture. "
            "Your solemn duty is to protect the integrity of the story world without restricting authorial creativity. "
            "You rigorously check whether the proposed text violates established story facts, specifically:\n"
            "1. CHARACTER KNOWLEDGE VIOLATIONS: If character A does not know secret X according to character memory, "
            "they MUST NOT mention, react to, or exploit secret X.\n"
            "2. TIMELINE DISCREPANCIES: Events occurring out of causal order.\n"
            "3. LOCATION INCONSISTENCIES: Impossible travel or sudden teleportation.\n"
            "4. PHYSICAL-STATE DISCREPANCIES: Healed injuries or altered items without explanation.\n"
            "5. DIRECT CONTRADICTIONS: Facts conflicting with established canon.\n\n"
            "If no issues exist, return an empty array for 'issues'. "
            "Return valid JSON only matching the schema."
        )

        prompt = f"""
NEW DRAFT TEXT TO AUDIT:
\"\"\"{text_to_check}\"\"\"

ESTABLISHED STORY GRAPH CONTEXT (CANONICAL STATE):
{graph_summary}

Analyze the draft against established canon. Return a JSON object with:
{{
  "issues": [
    {{
      "issue": "Arin acts on knowledge of the traitor's identity before uncovering the encrypted message.",
      "severity": "HIGH",
      "category": "knowledge",
      "evidence": "Character memory for Arin shows knowledge does not include the traitor's name, but in the draft he confronts Marcus directly.",
      "suggested_fix": "Introduce a discovery beat where Arin intercepts Marcus's seal first, or have Arin act on vague suspicion rather than explicit certainty."
    }}
  ]
}}
"""

        try:
            data = self.client.generate_json(
                prompt=prompt,
                system_instruction=system_instruction,
                model=settings.MODEL_FLASH
            )
            raw_issues = data.get("issues", [])
            issues = [ContinuityIssue(**item) for item in raw_issues]
            return ContinuityReport(
                story_id=story_id,
                analyzed_text=text_to_check,
                issues_found=len(issues),
                issues=issues,
                status="ISSUES_DETECTED" if issues else "OK"
            )
        except GeminiAPIError as e:
            raise e
        except Exception as e:
            raise GeminiAPIError(f"Continuity Keeper check failed: {str(e)}", status_code=500)


continuity_keeper = ContinuityKeeper()

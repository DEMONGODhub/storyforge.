"""AI Suggestions API Router.

Implements:
- POST /api/story/analyze     (Story Architect)
- POST /api/story/suggest     (Creative Co-Author)
- POST /api/story/continuity  (Continuity Keeper)
- POST /api/story/twist       (Twist Engine)
"""

import uuid
from typing import Optional, List
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.database.database import db
from backend.database.models import SuggestionRecord
from backend.story.canon import CanonStatus
from backend.story.graph import GraphNode, GraphEdge, NodeType, EdgeType
from backend.ai.architect import story_architect
from backend.ai.creative import creative_coauthor
from backend.ai.continuity import continuity_keeper
from backend.ai.twists import twist_engine
from backend.ai.gemini_client import GeminiAPIError

router = APIRouter(tags=["AI Orchestration"])


class AnalyzeRequest(BaseModel):
    story_id: str
    raw_text: str
    scene_id: Optional[str] = "scene_001"
    auto_apply_proposals_to_graph: bool = True


class SuggestRequest(BaseModel):
    story_id: str
    current_text: str
    focus_prompt: Optional[str] = None


class ContinuityRequest(BaseModel):
    story_id: str
    text_to_check: str


class TwistRequest(BaseModel):
    story_id: str
    theme: Optional[str] = None
    count: int = 3


@router.post("/api/story/analyze")
def analyze_story(req: AnalyzeRequest):
    """
    Story Architect: Deconstructs raw human input into structured narrative entities:
    characters, locations, events, relationships, timeline, mysteries, ideas, questions.
    All outputs tagged AI_PROPOSED.
    """
    story = db.get_story(req.story_id)
    if not story:
        raise HTTPException(status_code=404, detail=f"Story '{req.story_id}' not found.")

    graph = db.load_graph(req.story_id)

    try:
        analysis = story_architect.analyze_input(
            raw_text=req.raw_text,
            current_graph=graph,
            scene_id=req.scene_id
        )

        # Optionally add proposals to graph as AI_PROPOSED nodes
        if req.auto_apply_proposals_to_graph:
            # Add character proposals
            for c in analysis.characters:
                cid = c.id or graph.generate_id("character")
                c.id = cid
                graph.add_node(GraphNode(
                    id=cid,
                    node_type=NodeType.CHARACTER,
                    label=c.name,
                    properties={
                        "role": c.role,
                        "traits": c.traits,
                        "goals": c.goals,
                        "secrets": c.secrets,
                        "knowledge": c.knowledge,
                        "emotional_state": c.emotional_state,
                        "physical_state": c.physical_state
                    },
                    canon_status=CanonStatus.AI_PROPOSED
                ))

            # Add location proposals
            for loc in analysis.locations:
                lid = loc.id or graph.generate_id("location")
                loc.id = lid
                graph.add_node(GraphNode(
                    id=lid,
                    node_type=NodeType.LOCATION,
                    label=loc.name,
                    properties={"description": loc.description},
                    canon_status=CanonStatus.AI_PROPOSED
                ))

            # Add event proposals
            for ev in analysis.events:
                eid = ev.id or graph.generate_id("event")
                ev.id = eid
                graph.add_node(GraphNode(
                    id=eid,
                    node_type=NodeType.EVENT,
                    label=ev.title,
                    properties={
                        "description": ev.description,
                        "time": ev.time,
                        "characters": ev.characters,
                        "causes": ev.causes,
                        "consequences": ev.consequences
                    },
                    canon_status=CanonStatus.AI_PROPOSED
                ))

            # Add mystery proposals
            for m in analysis.mysteries:
                mid = m.id or graph.generate_id("mystery")
                m.id = mid
                graph.add_node(GraphNode(
                    id=mid,
                    node_type=NodeType.MYSTERY,
                    label=m.title,
                    properties={"description": m.description, "clues": m.clues, "unresolved": m.unresolved},
                    canon_status=CanonStatus.AI_PROPOSED
                ))

            # Add relationship proposals
            for rel in analysis.relationships:
                # Find matching nodes
                src = next((n.id for n in graph.nodes.values() if n.label.lower() == rel.source_name.lower()), None)
                tgt = next((n.id for n in graph.nodes.values() if n.label.lower() == rel.target_name.lower()), None)
                if src and tgt:
                    try:
                        rtype = EdgeType(rel.relation_type)
                    except ValueError:
                        rtype = EdgeType.RELATED_TO
                    graph.add_edge(GraphEdge(
                        id=f"edge_{len(graph.edges) + 1:03d}",
                        source_id=src,
                        target_id=tgt,
                        relation_type=rtype,
                        properties={"notes": rel.notes or ""},
                        canon_status=CanonStatus.AI_PROPOSED
                    ))

            db.save_graph(graph)

        # Audit suggestion in database
        db.save_suggestion(SuggestionRecord(
            id=f"sugg_{uuid.uuid4().hex[:8]}",
            story_id=req.story_id,
            role="architect",
            suggestion_type="narrative_analysis",
            content=analysis.model_dump(),
            canon_status=CanonStatus.AI_PROPOSED
        ))

        return analysis.model_dump()

    except GeminiAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Story analysis failed: {str(e)}")


@router.post("/api/story/suggest")
def get_creative_suggestions(req: SuggestRequest):
    """
    Creative Co-Author: Generates multi-angle storytelling ideas, descriptions,
    dialogue beats, and foreshadowing options marked AI_PROPOSED.
    """
    story = db.get_story(req.story_id)
    if not story:
        raise HTTPException(status_code=404, detail=f"Story '{req.story_id}' not found.")

    graph = db.load_graph(req.story_id)

    try:
        report = creative_coauthor.brainstorm(
            story_id=req.story_id,
            current_text=req.current_text,
            focus_prompt=req.focus_prompt,
            graph=graph
        )

        db.save_suggestion(SuggestionRecord(
            id=f"sugg_{uuid.uuid4().hex[:8]}",
            story_id=req.story_id,
            role="creative",
            suggestion_type="coauthor_ideas",
            content=report.model_dump(),
            canon_status=CanonStatus.AI_PROPOSED
        ))

        return report.model_dump()
    except GeminiAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Creative suggestion failed: {str(e)}")


@router.post("/api/story/continuity")
def check_continuity(req: ContinuityRequest):
    """
    Continuity Keeper: Checks draft text against established canonical story facts.
    Detects contradictions, character knowledge violations, and timeline problems.
    Does NOT alter canonical content.
    """
    story = db.get_story(req.story_id)
    if not story:
        raise HTTPException(status_code=404, detail=f"Story '{req.story_id}' not found.")

    graph = db.load_graph(req.story_id)

    try:
        report = continuity_keeper.verify_continuity(
            story_id=req.story_id,
            text_to_check=req.text_to_check,
            graph=graph
        )
        return report.model_dump()
    except GeminiAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Continuity check failed: {str(e)}")


@router.post("/api/story/twist")
def generate_twists(req: TwistRequest):
    """
    Twist Engine: Proposes grounded plot twists derived from story mysteries,
    character secrets, and foreshadowing. Answers 'Why did the AI suggest this twist?'
    with evidence from the story graph.
    """
    story = db.get_story(req.story_id)
    if not story:
        raise HTTPException(status_code=404, detail=f"Story '{req.story_id}' not found.")

    graph = db.load_graph(req.story_id)

    try:
        report = twist_engine.generate_twists(
            story_id=req.story_id,
            graph=graph,
            theme=req.theme,
            count=req.count
        )

        db.save_suggestion(SuggestionRecord(
            id=f"sugg_{uuid.uuid4().hex[:8]}",
            story_id=req.story_id,
            role="twists",
            suggestion_type="plot_twists",
            content=report.model_dump(),
            canon_status=CanonStatus.AI_PROPOSED
        ))

        return report.model_dump()
    except GeminiAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Twist generation failed: {str(e)}")

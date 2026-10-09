"""Stories & Story Graph API Router.

Implements:
- POST /api/stories
- GET /api/stories/{story_id}
- PUT /api/story/{story_id}
- Canon approval and prose entry tracking
"""

import uuid
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.database.database import db
from backend.database.models import StoryModel, ProseEntryModel
from backend.story.canon import CanonStatus, is_canonical
from backend.story.graph import GraphNode, GraphEdge, NodeType, EdgeType

router = APIRouter(tags=["Stories"])


class CreateStoryRequest(BaseModel):
    title: str = "Untitled Story"
    genre: Optional[str] = "Fiction"
    synopsis: Optional[str] = ""
    initial_text: Optional[str] = None


class UpdateStoryRequest(BaseModel):
    title: Optional[str] = None
    genre: Optional[str] = None
    synopsis: Optional[str] = None


class AddProseRequest(BaseModel):
    raw_human_input: str
    scene_id: Optional[str] = "scene_001"
    ai_interpretation: Optional[str] = None


class CanonActionRequest(BaseModel):
    entry_id: str
    action: str  # "accept", "edit", "reject"
    revised_text: Optional[str] = None


class AddNodeRequest(BaseModel):
    id: Optional[str] = None
    node_type: NodeType
    label: str
    properties: Dict[str, Any] = Field(default_factory=dict)
    canon_status: CanonStatus = CanonStatus.HUMAN


class AddEdgeRequest(BaseModel):
    id: Optional[str] = None
    source_id: str
    target_id: str
    relation_type: EdgeType
    properties: Dict[str, Any] = Field(default_factory=dict)
    canon_status: CanonStatus = CanonStatus.HUMAN


@router.post("/api/stories", status_code=status.HTTP_201_CREATED)
def create_story(req: CreateStoryRequest):
    """Creates a new story container with an initial graph."""
    story_id = f"story_{uuid.uuid4().hex[:8]}"
    story = db.create_story(
        story_id=story_id,
        title=req.title,
        genre=req.genre or "Fiction",
        synopsis=req.synopsis or ""
    )

    # Initialize basic graph
    graph = db.load_graph(story_id)
    graph.add_node(
        GraphNode(
            id=f"scene_001",
            node_type=NodeType.SCENE,
            label="Scene 1",
            properties={"summary": "Opening scene"},
            canon_status=CanonStatus.HUMAN
        )
    )
    db.save_graph(graph)

    # If initial text provided
    if req.initial_text:
        entry = ProseEntryModel(
            id=f"entry_{uuid.uuid4().hex[:8]}",
            story_id=story_id,
            scene_id="scene_001",
            sequence_index=1,
            raw_human_input=req.initial_text,
            canon_status=CanonStatus.HUMAN
        )
        db.add_prose_entry(entry)

    return {
        "id": story.id,
        "title": story.title,
        "genre": story.genre,
        "synopsis": story.synopsis,
        "created_at": story.created_at,
        "updated_at": story.updated_at
    }


@router.get("/api/stories")
def list_stories():
    """Lists all stories in the database."""
    stories = db.list_stories()
    return {"stories": stories, "count": len(stories)}


@router.get("/api/stories/{story_id}")
def get_story(story_id: str):
    """Retrieves full story details, canonical text, prose segments, and story graph."""
    story = db.get_story(story_id)
    if not story:
        raise HTTPException(status_code=404, detail=f"Story with ID '{story_id}' not found.")

    prose_entries = db.get_prose_entries(story_id)
    graph = db.load_graph(story_id)

    # Calculate assembled canonical text
    canonical_paragraphs = []
    for entry in prose_entries:
        if is_canonical(entry.canon_status):
            if entry.canon_status in (CanonStatus.HUMAN_ACCEPTED, CanonStatus.HUMAN_EDITED):
                text = entry.user_approved_text or entry.ai_interpretation or entry.raw_human_input
            else:
                text = entry.raw_human_input
            if text:
                canonical_paragraphs.append(text)
    canonical_text = "\n\n".join(canonical_paragraphs)

    return {
        "story": story,
        "canonical_text": canonical_text,
        "prose_entries": prose_entries,
        "graph": {
            "story_id": graph.story_id,
            "nodes": [n.model_dump() for n in graph.nodes.values()],
            "edges": [e.model_dump() for e in graph.edges.values()]
        }
    }


@router.put("/api/story/{story_id}")
def update_story(story_id: str, req: UpdateStoryRequest):
    """Updates story metadata."""
    updated = db.update_story(
        story_id=story_id,
        title=req.title,
        synopsis=req.synopsis,
        genre=req.genre
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Story with ID '{story_id}' not found.")
    return updated


@router.post("/api/story/{story_id}/entry")
def add_prose_entry(story_id: str, req: AddProseRequest):
    """Adds a new raw human input prose entry."""
    story = db.get_story(story_id)
    if not story:
        raise HTTPException(status_code=404, detail=f"Story '{story_id}' not found.")

    existing = db.get_prose_entries(story_id)
    seq = len(existing) + 1

    entry = ProseEntryModel(
        id=f"entry_{uuid.uuid4().hex[:8]}",
        story_id=story_id,
        scene_id=req.scene_id or "scene_001",
        sequence_index=seq,
        raw_human_input=req.raw_human_input,
        ai_interpretation=req.ai_interpretation,
        canon_status=CanonStatus.HUMAN
    )
    saved = db.add_prose_entry(entry)
    return saved


@router.post("/api/story/{story_id}/accept")
def handle_canon_action(story_id: str, req: CanonActionRequest):
    """
    Applies writer's final decision to an AI-proposed text segment:
    - 'accept': Marks HUMAN_ACCEPTED
    - 'edit': Marks HUMAN_EDITED with revised_text
    - 'reject': Marks REJECTED, falls back to raw human input
    """
    if req.action == "accept":
        updated = db.update_prose_status(req.entry_id, CanonStatus.HUMAN_ACCEPTED)
    elif req.action == "edit":
        if not req.revised_text:
            raise HTTPException(status_code=400, detail="Revised text must be provided for 'edit' action.")
        updated = db.update_prose_status(req.entry_id, CanonStatus.HUMAN_EDITED, user_approved_text=req.revised_text)
    elif req.action == "reject":
        updated = db.update_prose_status(req.entry_id, CanonStatus.REJECTED)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action '{req.action}'. Must be accept, edit, or reject.")

    if not updated:
        raise HTTPException(status_code=404, detail=f"Entry with ID '{req.entry_id}' not found.")
    return updated


@router.post("/api/story/{story_id}/node")
def add_graph_node(story_id: str, req: AddNodeRequest):
    """Adds or updates a node in the Story Graph."""
    graph = db.load_graph(story_id)
    node_id = req.id or graph.generate_id(req.node_type.value.lower())
    node = GraphNode(
        id=node_id,
        node_type=req.node_type,
        label=req.label,
        properties=req.properties,
        canon_status=req.canon_status
    )
    graph.add_node(node)
    db.save_graph(graph)
    return node


@router.post("/api/story/{story_id}/edge")
def add_graph_edge(story_id: str, req: AddEdgeRequest):
    """Adds or updates an edge in the Story Graph."""
    graph = db.load_graph(story_id)
    edge_id = req.id or f"edge_{len(graph.edges) + 1:03d}"
    edge = GraphEdge(
        id=edge_id,
        source_id=req.source_id,
        target_id=req.target_id,
        relation_type=req.relation_type,
        properties=req.properties,
        canon_status=req.canon_status
    )
    graph.add_edge(edge)
    db.save_graph(graph)
    return edge

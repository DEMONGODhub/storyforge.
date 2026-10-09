"""Comprehensive Test Suite for Story Forge AI Backend."""

import os
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = str(Path(__file__).parent.parent)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import pytest
from fastapi.testclient import TestClient

# Ensure test DB
os.environ["DATABASE_PATH"] = ":memory:"
os.environ["GEMINI_API_KEY"] = "test_key_for_mock_validation"

from main import app
from backend.story.canon import CanonStatus, is_canonical, CanonRecord
from backend.story.graph import StoryGraph, GraphNode, GraphEdge, NodeType, EdgeType
from backend.export.pdf import generate_pdf
from backend.export.epub import generate_epub

client = TestClient(app)


def test_root_and_health():
    res = client.get("/")
    assert res.status_code == 200
    assert "Story Forge" in res.json()["app"]

    res_health = client.get("/health")
    assert res_health.status_code == 200
    assert res_health.json()["status"] == "healthy"
    assert res_health.json()["database"] == "sqlite_connected"


def test_canon_status_rules():
    assert is_canonical(CanonStatus.HUMAN) is True
    assert is_canonical(CanonStatus.HUMAN_ACCEPTED) is True
    assert is_canonical(CanonStatus.HUMAN_EDITED) is True
    assert is_canonical(CanonStatus.AI_PROPOSED) is False
    assert is_canonical(CanonStatus.REJECTED) is False


def test_canon_record_lifecycle():
    record = CanonRecord(
        id="entry_001",
        story_id="story_001",
        raw_human_input="under the blue sky a man with black clock standing on cliff",
        ai_interpretation="Under the blue sky, a man in a black cloak stood on the mountain cliff.",
        canon_status=CanonStatus.HUMAN
    )
    # Default canonical text is raw human input until approved
    assert "clock" in record.get_canonical_text()

    # Accept AI interpretation
    record.accept_ai_interpretation()
    assert record.canon_status == CanonStatus.HUMAN_ACCEPTED
    assert "cloak" in record.get_canonical_text()

    # Edit and approve
    record.edit_and_approve("Under an azure sky, Lord Arin stood upon the precipice.")
    assert record.canon_status == CanonStatus.HUMAN_EDITED
    assert "Lord Arin" in record.get_canonical_text()

    # Rejection returns to human raw text
    record.reject_proposal()
    assert record.canon_status == CanonStatus.REJECTED
    assert "clock" in record.get_canonical_text()


def test_story_graph_nodes_edges():
    graph = StoryGraph(story_id="story_test")
    
    char_id = graph.generate_id("character")
    assert char_id == "character_001"
    
    char_node = GraphNode(
        id=char_id,
        node_type=NodeType.CHARACTER,
        label="Arin",
        properties={"role": "protagonist", "knowledge": ["Cliff location"]},
        canon_status=CanonStatus.HUMAN
    )
    graph.add_node(char_node)

    loc_id = graph.generate_id("location")
    assert loc_id == "location_001"
    loc_node = GraphNode(
        id=loc_id,
        node_type=NodeType.LOCATION,
        label="Eagle's Crest",
        canon_status=CanonStatus.HUMAN
    )
    graph.add_node(loc_node)

    edge = GraphEdge(
        id="edge_001",
        source_id=char_id,
        target_id=loc_id,
        relation_type=EdgeType.OCCURS_AT,
        canon_status=CanonStatus.HUMAN
    )
    graph.add_edge(edge)

    assert len(graph.nodes) == 2
    assert len(graph.edges) == 1
    assert len(graph.get_characters()) == 1
    assert len(graph.get_locations()) == 1


def test_story_crud_api():
    # Create story
    res = client.post("/api/stories", json={
        "title": "Chronicles of the Wind",
        "genre": "Epic Fantasy",
        "synopsis": "A wandering outcast seeks the truth of his ancestors.",
        "initial_text": "He held the blade against the cold gale."
    })
    assert res.status_code == 201
    story_data = res.json()
    story_id = story_data["id"]
    assert story_data["title"] == "Chronicles of the Wind"

    # Get story
    res_get = client.get(f"/api/stories/{story_id}")
    assert res_get.status_code == 200
    data = res_get.json()
    assert len(data["prose_entries"]) == 1
    assert data["prose_entries"][0]["raw_human_input"] == "He held the blade against the cold gale."
    assert "blade" in data["canonical_text"]

    # Update story
    res_put = client.put(f"/api/story/{story_id}", json={
        "title": "Chronicles of the High Wind"
    })
    assert res_put.status_code == 200
    assert res_put.json()["title"] == "Chronicles of the High Wind"


def test_canon_approval_api():
    # Create story
    res = client.post("/api/stories", json={"title": "Test Canon"})
    story_id = res.json()["id"]

    # Add prose entry
    res_entry = client.post(f"/api/story/{story_id}/entry", json={
        "raw_human_input": "man with black clock on cliff",
        "ai_interpretation": "A man in a black cloak stood upon the cliff."
    })
    assert res_entry.status_code == 200
    entry_id = res_entry.json()["id"]

    # Accept proposal
    res_accept = client.post(f"/api/story/{story_id}/accept", json={
        "entry_id": entry_id,
        "action": "accept"
    })
    assert res_accept.status_code == 200
    assert res_accept.json()["canon_status"] == "HUMAN_ACCEPTED"

    # Verify story canonical text now has accepted prose
    res_story = client.get(f"/api/stories/{story_id}")
    assert "cloak" in res_story.json()["canonical_text"]


def test_pdf_and_epub_export():
    prose = [
        {
            "raw_human_input": "Raw draft 1",
            "user_approved_text": "The mountain winds wailed as night descended.",
            "canon_status": "HUMAN_ACCEPTED"
        },
        {
            "raw_human_input": "Unapproved AI snippet",
            "ai_interpretation": "Should not appear in export",
            "canon_status": "AI_PROPOSED"
        }
    ]

    pdf_bytes = generate_pdf("The Lost Peak", prose)
    assert len(pdf_bytes) > 100
    assert b"%PDF" in pdf_bytes

    epub_bytes = generate_epub("The Lost Peak", prose)
    assert len(epub_bytes) > 100
    assert b"mimetype" in epub_bytes


def test_gemini_missing_key_error_handling(monkeypatch):
    from ai.gemini_client import GeminiClient, GeminiAPIError
    c = GeminiClient()
    monkeypatch.setattr(c, "api_key", "")
    from config import settings
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")

    with pytest.raises(GeminiAPIError) as exc_info:
        c.generate_content("hello")
    assert "GEMINI_API_KEY" in str(exc_info.value)
    assert exc_info.value.status_code == 401


def test_architect_schema_validation():
    from ai.architect import ArchitectAnalysisResult, CharacterExtraction, LocationExtraction, EventExtraction
    res = ArchitectAnalysisResult(
        raw_input="a man with black cloak on a cliff",
        characters=[
            CharacterExtraction(
                name="Arin",
                role="protagonist",
                traits=["somber"],
                knowledge=["Cliff secrets"]
            )
        ],
        locations=[LocationExtraction(name="High Cliff", description="Windswept precipice")],
        events=[EventExtraction(title="Vow on the Cliff", description="Whispering names", characters=["Arin"])]
    )
    dumped = res.model_dump()
    assert dumped["canon_status"] == "AI_PROPOSED"
    assert len(dumped["characters"]) == 1
    assert dumped["characters"][0]["name"] == "Arin"


def test_twist_schema_and_reason_explanation():
    from ai.twists import TwistReport, TwistProposal
    proposal = TwistProposal(
        id="twist_001",
        title="The Whispered Names Belong to His Captors",
        description="The parents were never killed; they were the executioners.",
        affected_characters=["Arin"],
        reason="Derived from mystery 'Fate of the Parents' where grave sites were empty."
    )
    report = TwistReport(story_id="s1", twists=[proposal])
    assert report.twists[0].canon_status == "AI_PROPOSED"
    assert "mystery" in report.twists[0].reason


def test_memory_retrieval_cosine():
    from ai.retrieval import cosine_similarity, MemoryRetrievalEngine
    v1 = [1.0, 0.0, 0.0]
    v2 = [1.0, 0.0, 0.0]
    v3 = [0.0, 1.0, 0.0]
    assert cosine_similarity(v1, v2) == 1.0
    assert cosine_similarity(v1, v3) == 0.0


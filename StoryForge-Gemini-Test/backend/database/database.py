"""SQLite Persistence Layer for Story Forge.

Modular database engine that isolates SQL queries and manages
stories, graph nodes/edges, prose segments, and AI suggestions.
"""

import sqlite3
import json
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone

from backend.config import settings
from backend.story.canon import CanonStatus, CanonRecord, CanonAuditEntry
from backend.story.graph import StoryGraph, GraphNode, GraphEdge, NodeType, EdgeType
from .models import StoryModel, ProseEntryModel, SuggestionRecord


class Database:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or settings.DATABASE_PATH
        self._shared_conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._shared_conn = sqlite3.connect(":memory:", check_same_thread=False)
            self._shared_conn.row_factory = sqlite3.Row
            self._shared_conn.execute("PRAGMA foreign_keys = ON;")
        else:
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    def get_connection(self) -> sqlite3.Connection:
        if self._shared_conn is not None:
            return self._shared_conn
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def init_db(self) -> None:
        """Create tables and indexes if they don't already exist."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Stories table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS stories (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    genre TEXT,
                    synopsis TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    meta_json TEXT NOT NULL DEFAULT '{}'
                );
            """)

            # Prose Entries (Canonical multi-tier human/AI text tracking)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS prose_entries (
                    id TEXT PRIMARY KEY,
                    story_id TEXT NOT NULL,
                    scene_id TEXT,
                    sequence_index INTEGER NOT NULL DEFAULT 0,
                    raw_human_input TEXT NOT NULL,
                    ai_interpretation TEXT,
                    user_approved_text TEXT,
                    canon_status TEXT NOT NULL,
                    history_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE
                );
            """)

            # Story Graph Nodes
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS story_nodes (
                    id TEXT NOT NULL,
                    story_id TEXT NOT NULL,
                    node_type TEXT NOT NULL,
                    label TEXT NOT NULL,
                    properties_json TEXT NOT NULL DEFAULT '{}',
                    canon_status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (id, story_id),
                    FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE
                );
            """)

            # Story Graph Edges
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS story_edges (
                    id TEXT NOT NULL,
                    story_id TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    relation_type TEXT NOT NULL,
                    properties_json TEXT NOT NULL DEFAULT '{}',
                    canon_status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (id, story_id),
                    FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE
                );
            """)

            # AI Suggestions Audit Log
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS suggestions (
                    id TEXT PRIMARY KEY,
                    story_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    suggestion_type TEXT NOT NULL,
                    content_json TEXT NOT NULL,
                    canon_status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE
                );
            """)

            # Indexes
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_prose_story ON prose_entries(story_id, sequence_index);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_story ON story_nodes(story_id);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_edges_story ON story_edges(story_id);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sugg_story ON suggestions(story_id);")
            conn.commit()

    # Story CRUD
    def create_story(self, story_id: str, title: str, genre: str = "Fiction", synopsis: str = "") -> StoryModel:
        now = datetime.now(timezone.utc).isoformat()
        with self.get_connection() as conn:
            conn.execute(
                """
                INSERT INTO stories (id, title, genre, synopsis, created_at, updated_at, meta_json)
                VALUES (?, ?, ?, ?, ?, ?, '{}')
                """,
                (story_id, title, genre, synopsis, now, now)
            )
            conn.commit()
        return StoryModel(id=story_id, title=title, genre=genre, synopsis=synopsis, created_at=now, updated_at=now)

    def get_story(self, story_id: str) -> Optional[StoryModel]:
        with self.get_connection() as conn:
            row = conn.execute("SELECT * FROM stories WHERE id = ?", (story_id,)).fetchone()
            if not row:
                return None
            return StoryModel(
                id=row["id"],
                title=row["title"],
                genre=row["genre"],
                synopsis=row["synopsis"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                meta=json.loads(row["meta_json"]) if row["meta_json"] else {}
            )

    def update_story(self, story_id: str, title: Optional[str] = None, synopsis: Optional[str] = None, genre: Optional[str] = None) -> Optional[StoryModel]:
        story = self.get_story(story_id)
        if not story:
            return None
        new_title = title if title is not None else story.title
        new_synopsis = synopsis if synopsis is not None else story.synopsis
        new_genre = genre if genre is not None else story.genre
        now = datetime.now(timezone.utc).isoformat()

        with self.get_connection() as conn:
            conn.execute(
                "UPDATE stories SET title = ?, synopsis = ?, genre = ?, updated_at = ? WHERE id = ?",
                (new_title, new_synopsis, new_genre, now, story_id)
            )
            conn.commit()
        return self.get_story(story_id)

    def list_stories(self) -> List[StoryModel]:
        with self.get_connection() as conn:
            rows = conn.execute("SELECT * FROM stories ORDER BY updated_at DESC").fetchall()
            return [
                StoryModel(
                    id=r["id"],
                    title=r["title"],
                    genre=r["genre"],
                    synopsis=r["synopsis"],
                    created_at=r["created_at"],
                    updated_at=r["updated_at"],
                    meta=json.loads(r["meta_json"]) if r["meta_json"] else {}
                )
                for r in rows
            ]

    # Prose entries CRUD
    def add_prose_entry(self, entry: ProseEntryModel) -> ProseEntryModel:
        with self.get_connection() as conn:
            conn.execute(
                """
                INSERT INTO prose_entries (
                    id, story_id, scene_id, sequence_index,
                    raw_human_input, ai_interpretation, user_approved_text,
                    canon_status, history_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry.id, entry.story_id, entry.scene_id, entry.sequence_index,
                    entry.raw_human_input, entry.ai_interpretation, entry.user_approved_text,
                    entry.canon_status.value, json.dumps(entry.history),
                    entry.created_at, entry.updated_at
                )
            )
            conn.commit()
        return entry

    def get_prose_entries(self, story_id: str) -> List[ProseEntryModel]:
        with self.get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM prose_entries WHERE story_id = ? ORDER BY sequence_index ASC, created_at ASC",
                (story_id,)
            ).fetchall()
            return [
                ProseEntryModel(
                    id=r["id"],
                    story_id=r["story_id"],
                    scene_id=r["scene_id"],
                    sequence_index=r["sequence_index"],
                    raw_human_input=r["raw_human_input"],
                    ai_interpretation=r["ai_interpretation"],
                    user_approved_text=r["user_approved_text"],
                    canon_status=CanonStatus(r["canon_status"]),
                    history=json.loads(r["history_json"]) if r["history_json"] else [],
                    created_at=r["created_at"],
                    updated_at=r["updated_at"]
                )
                for r in rows
            ]

    def update_prose_status(
        self,
        entry_id: str,
        status: CanonStatus,
        user_approved_text: Optional[str] = None
    ) -> Optional[ProseEntryModel]:
        now = datetime.now(timezone.utc).isoformat()
        with self.get_connection() as conn:
            row = conn.execute("SELECT * FROM prose_entries WHERE id = ?", (entry_id,)).fetchone()
            if not row:
                return None

            final_approved = user_approved_text
            if status == CanonStatus.HUMAN_ACCEPTED and final_approved is None and row["ai_interpretation"]:
                final_approved = row["ai_interpretation"]

            history = json.loads(row["history_json"]) if row["history_json"] else []
            history.append({
                "timestamp": now,
                "action": "status_update",
                "new_status": status.value,
                "user_approved_text": final_approved
            })

            conn.execute(
                """
                UPDATE prose_entries
                SET canon_status = ?, user_approved_text = COALESCE(?, user_approved_text),
                    history_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (status.value, final_approved, json.dumps(history), now, entry_id)
            )
            conn.commit()
            
        with self.get_connection() as conn:
            updated = conn.execute("SELECT * FROM prose_entries WHERE id = ?", (entry_id,)).fetchone()
            return ProseEntryModel(
                id=updated["id"],
                story_id=updated["story_id"],
                scene_id=updated["scene_id"],
                sequence_index=updated["sequence_index"],
                raw_human_input=updated["raw_human_input"],
                ai_interpretation=updated["ai_interpretation"],
                user_approved_text=updated["user_approved_text"],
                canon_status=CanonStatus(updated["canon_status"]),
                history=json.loads(updated["history_json"]),
                created_at=updated["created_at"],
                updated_at=updated["updated_at"]
            )

    # Graph Persistence
    def save_graph(self, graph: StoryGraph) -> None:
        """Persist or sync entire StoryGraph to SQLite."""
        now = datetime.now(timezone.utc).isoformat()
        with self.get_connection() as conn:
            for node in graph.nodes.values():
                conn.execute(
                    """
                    INSERT INTO story_nodes (id, story_id, node_type, label, properties_json, canon_status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id, story_id) DO UPDATE SET
                        label=excluded.label,
                        properties_json=excluded.properties_json,
                        canon_status=excluded.canon_status,
                        updated_at=excluded.updated_at
                    """,
                    (
                        node.id, graph.story_id, node.node_type.value, node.label,
                        json.dumps(node.properties), node.canon_status.value,
                        now, now
                    )
                )

            for edge in graph.edges.values():
                conn.execute(
                    """
                    INSERT INTO story_edges (id, story_id, source_id, target_id, relation_type, properties_json, canon_status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id, story_id) DO UPDATE SET
                        source_id=excluded.source_id,
                        target_id=excluded.target_id,
                        relation_type=excluded.relation_type,
                        properties_json=excluded.properties_json,
                        canon_status=excluded.canon_status
                    """,
                    (
                        edge.id, graph.story_id, edge.source_id, edge.target_id,
                        edge.relation_type.value, json.dumps(edge.properties), edge.canon_status.value,
                        now
                    )
                )
            conn.commit()

    def load_graph(self, story_id: str) -> StoryGraph:
        """Load full StoryGraph from SQLite."""
        graph = StoryGraph(story_id=story_id)
        with self.get_connection() as conn:
            node_rows = conn.execute("SELECT * FROM story_nodes WHERE story_id = ?", (story_id,)).fetchall()
            for r in node_rows:
                graph.nodes[r["id"]] = GraphNode(
                    id=r["id"],
                    node_type=NodeType(r["node_type"]),
                    label=r["label"],
                    properties=json.loads(r["properties_json"]) if r["properties_json"] else {},
                    canon_status=CanonStatus(r["canon_status"])
                )

            edge_rows = conn.execute("SELECT * FROM story_edges WHERE story_id = ?", (story_id,)).fetchall()
            for r in edge_rows:
                graph.edges[r["id"]] = GraphEdge(
                    id=r["id"],
                    source_id=r["source_id"],
                    target_id=r["target_id"],
                    relation_type=EdgeType(r["relation_type"]),
                    properties=json.loads(r["properties_json"]) if r["properties_json"] else {},
                    canon_status=CanonStatus(r["canon_status"])
                )
        return graph

    # Suggestions CRUD
    def save_suggestion(self, suggestion: SuggestionRecord) -> SuggestionRecord:
        with self.get_connection() as conn:
            conn.execute(
                """
                INSERT INTO suggestions (id, story_id, role, suggestion_type, content_json, canon_status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    suggestion.id, suggestion.story_id, suggestion.role,
                    suggestion.suggestion_type, json.dumps(suggestion.content),
                    suggestion.canon_status.value, suggestion.created_at
                )
            )
            conn.commit()
        return suggestion

    def get_suggestions(self, story_id: str, role: Optional[str] = None) -> List[SuggestionRecord]:
        with self.get_connection() as conn:
            if role:
                rows = conn.execute(
                    "SELECT * FROM suggestions WHERE story_id = ? AND role = ? ORDER BY created_at DESC",
                    (story_id, role)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM suggestions WHERE story_id = ? ORDER BY created_at DESC",
                    (story_id,)
                ).fetchall()

            return [
                SuggestionRecord(
                    id=r["id"],
                    story_id=r["story_id"],
                    role=r["role"],
                    suggestion_type=r["suggestion_type"],
                    content=json.loads(r["content_json"]),
                    canon_status=CanonStatus(r["canon_status"]),
                    created_at=r["created_at"]
                )
                for r in rows
            ]

# Global database instance
db = Database()

"""Story Graph Engine.

Implements a non-hierarchical, multi-relational graph data model.
Nodes: STORY, CHAPTER, SCENE, CHARACTER, LOCATION, EVENT, MYSTERY, TWIST, IDEA.
Edges: APPEARS_IN, OCCURS_AT, CAUSES, LEADS_TO, KNOWS, RELATED_TO, LOVES, HATES, FEARS,
       REVEALS, FORESHADOWS, CONTRADICTS, DEPENDS_ON.
"""

from enum import Enum
from typing import Dict, List, Optional, Any, Set
from pydantic import BaseModel, Field
from .canon import CanonStatus, is_canonical


class NodeType(str, Enum):
    STORY = "STORY"
    CHAPTER = "CHAPTER"
    SCENE = "SCENE"
    CHARACTER = "CHARACTER"
    LOCATION = "LOCATION"
    EVENT = "EVENT"
    MYSTERY = "MYSTERY"
    TWIST = "TWIST"
    IDEA = "IDEA"


class EdgeType(str, Enum):
    APPEARS_IN = "APPEARS_IN"
    OCCURS_AT = "OCCURS_AT"
    CAUSES = "CAUSES"
    LEADS_TO = "LEADS_TO"
    KNOWS = "KNOWS"
    RELATED_TO = "RELATED_TO"
    LOVES = "LOVES"
    HATES = "HATES"
    FEARS = "FEARS"
    REVEALS = "REVEALS"
    FORESHADOWS = "FORESHADOWS"
    CONTRADICTS = "CONTRADICTS"
    DEPENDS_ON = "DEPENDS_ON"


class GraphNode(BaseModel):
    """An entity within the story graph with a stable ID and canon status."""
    id: str  # e.g., character_001, location_001, event_001
    node_type: NodeType
    label: str
    properties: Dict[str, Any] = Field(default_factory=dict)
    canon_status: CanonStatus = CanonStatus.HUMAN


class GraphEdge(BaseModel):
    """A directional relationship between two story entities."""
    id: str  # e.g., edge_001
    source_id: str
    target_id: str
    relation_type: EdgeType
    properties: Dict[str, Any] = Field(default_factory=dict)
    canon_status: CanonStatus = CanonStatus.HUMAN


class StoryGraph(BaseModel):
    """
    In-memory graph of story entities and relationships.
    Provides query methods for continuity checking, twist generation, and context retrieval.
    """
    story_id: str
    nodes: Dict[str, GraphNode] = Field(default_factory=dict)
    edges: Dict[str, GraphEdge] = Field(default_factory=dict)

    # Counter state for stable IDs
    _counters: Dict[str, int] = {}

    def generate_id(self, prefix: str) -> str:
        """Generates a stable sequential ID like character_001, event_002."""
        current = 1
        existing_nums = [
            int(nid.split("_")[-1])
            for nid in self.nodes.keys()
            if nid.startswith(f"{prefix}_") and nid.split("_")[-1].isdigit()
        ]
        if existing_nums:
            current = max(existing_nums) + 1
        return f"{prefix}_{current:03d}"

    def add_node(self, node: GraphNode) -> GraphNode:
        self.nodes[node.id] = node
        return node

    def get_node(self, node_id: str) -> Optional[GraphNode]:
        return self.nodes.get(node_id)

    def remove_node(self, node_id: str) -> bool:
        if node_id in self.nodes:
            del self.nodes[node_id]
            # Remove all dangling edges
            edge_ids_to_del = [
                eid for eid, edge in self.edges.items()
                if edge.source_id == node_id or edge.target_id == node_id
            ]
            for eid in edge_ids_to_del:
                del self.edges[eid]
            return True
        return False

    def add_edge(self, edge: GraphEdge) -> GraphEdge:
        self.edges[edge.id] = edge
        return edge

    def get_edges(
        self,
        source_id: Optional[str] = None,
        target_id: Optional[str] = None,
        relation_type: Optional[EdgeType] = None
    ) -> List[GraphEdge]:
        """Query edges matching optional filters."""
        results = []
        for edge in self.edges.values():
            if source_id and edge.source_id != source_id:
                continue
            if target_id and edge.target_id != target_id:
                continue
            if relation_type and edge.relation_type != relation_type:
                continue
            results.append(edge)
        return results

    def get_neighbors(self, node_id: str, direction: str = "both") -> List[GraphNode]:
        """Get connected neighboring nodes."""
        neighbor_ids: Set[str] = set()
        for edge in self.edges.values():
            if direction in ("out", "both") and edge.source_id == node_id:
                neighbor_ids.add(edge.target_id)
            if direction in ("in", "both") and edge.target_id == node_id:
                neighbor_ids.add(edge.source_id)
        return [self.nodes[nid] for nid in neighbor_ids if nid in self.nodes]

    def get_characters(self, canonical_only: bool = False) -> List[GraphNode]:
        return [
            n for n in self.nodes.values()
            if n.node_type == NodeType.CHARACTER and (not canonical_only or is_canonical(n.canon_status))
        ]

    def get_locations(self, canonical_only: bool = False) -> List[GraphNode]:
        return [
            n for n in self.nodes.values()
            if n.node_type == NodeType.LOCATION and (not canonical_only or is_canonical(n.canon_status))
        ]

    def get_events(self, canonical_only: bool = False) -> List[GraphNode]:
        return [
            n for n in self.nodes.values()
            if n.node_type == NodeType.EVENT and (not canonical_only or is_canonical(n.canon_status))
        ]

    def get_mysteries(self, canonical_only: bool = False) -> List[GraphNode]:
        return [
            n for n in self.nodes.values()
            if n.node_type == NodeType.MYSTERY and (not canonical_only or is_canonical(n.canon_status))
        ]

    def get_character_knowledge(self, character_id: str) -> List[str]:
        """Returns all facts and secrets directly known or linked to this character."""
        char_node = self.get_node(character_id)
        if not char_node:
            return []
        
        knowledge = list(char_node.properties.get("knowledge", []))
        # Add facts connected via KNOWS edges
        for edge in self.get_edges(source_id=character_id, relation_type=EdgeType.KNOWS):
            target = self.get_node(edge.target_id)
            if target:
                knowledge.append(f"Knows {target.label}: {target.properties.get('description', '')}")
        return knowledge

    def get_canonical_subgraph(self) -> "StoryGraph":
        """Returns a subgraph with only human or accepted canonical nodes and edges."""
        canonical_nodes = {
            nid: n for nid, n in self.nodes.items()
            if is_canonical(n.canon_status)
        }
        canonical_edges = {
            eid: e for eid, e in self.edges.items()
            if is_canonical(e.canon_status) and e.source_id in canonical_nodes and e.target_id in canonical_nodes
        }
        sub = StoryGraph(story_id=self.story_id)
        sub.nodes = canonical_nodes
        sub.edges = canonical_edges
        return sub

    def to_summary_dict(self) -> Dict[str, Any]:
        """Compact summary of entities for LLM prompt context."""
        return {
            "characters": [
                {
                    "id": n.id,
                    "name": n.label,
                    "role": n.properties.get("role", "supporting"),
                    "knowledge": n.properties.get("knowledge", []),
                    "secrets": n.properties.get("secrets", []),
                    "traits": n.properties.get("traits", [])
                }
                for n in self.get_characters()
            ],
            "locations": [
                {
                    "id": n.id,
                    "name": n.label,
                    "description": n.properties.get("description", "")
                }
                for n in self.get_locations()
            ],
            "events": [
                {
                    "id": n.id,
                    "title": n.label,
                    "description": n.properties.get("description", ""),
                    "time": n.properties.get("time", "")
                }
                for n in self.get_events()
            ],
            "mysteries": [
                {
                    "id": n.id,
                    "title": n.label,
                    "clues": n.properties.get("clues", []),
                    "unresolved": n.properties.get("unresolved", True)
                }
                for n in self.get_mysteries()
            ],
            "relationships": [
                {
                    "source": self.nodes[e.source_id].label if e.source_id in self.nodes else e.source_id,
                    "relation": e.relation_type.value,
                    "target": self.nodes[e.target_id].label if e.target_id in self.nodes else e.target_id
                }
                for e in self.edges.values()
            ]
        }

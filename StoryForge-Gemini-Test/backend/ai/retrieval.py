"""Memory and Semantic Retrieval Engine.

Uses Gemini embeddings (gemini-embedding-2-preview) to index and retrieve:
- Previous scenes
- Character knowledge & secrets
- Key events & timeline beats
- Foreshadowing clues
- Unresolved mysteries

Prevents context window flooding by selectively retrieving top-K relevant narrative context.
"""

import math
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from .gemini_client import ai_client, GeminiAPIError


class MemoryItem(BaseModel):
    id: str
    item_type: str  # scene, character, event, mystery, clue
    content: str
    metadata: Dict[str, Any] = {}
    embedding: Optional[List[float]] = None


def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Computes cosine similarity between two float vectors."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    mag1 = math.sqrt(sum(a * a for a in v1))
    mag2 = math.sqrt(sum(b * b for b in v2))
    if mag1 == 0.0 or mag2 == 0.0:
        return 0.0
    return dot / (mag1 * mag2)


class MemoryRetrievalEngine:
    def __init__(self):
        self.client = ai_client
        self._index: Dict[str, MemoryItem] = {}

    def index_text(
        self,
        item_id: str,
        item_type: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> MemoryItem:
        """Embeds text and adds it to the semantic retrieval memory."""
        try:
            emb = self.client.generate_embedding(content)
        except Exception:
            emb = None

        item = MemoryItem(
            id=item_id,
            item_type=item_type,
            content=content,
            metadata=metadata or {},
            embedding=emb
        )
        self._index[item_id] = item
        return item

    def search_context(self, query: str, top_k: int = 5) -> List[MemoryItem]:
        """Retrieves top-K most semantically relevant story memories."""
        if not self._index:
            return []

        try:
            query_emb = self.client.generate_embedding(query)
        except Exception:
            # Fallback keyword match if embeddings are unavailable
            query_lower = query.lower()
            return sorted(
                self._index.values(),
                key=lambda item: sum(w in item.content.lower() for w in query_lower.split()),
                reverse=True
            )[:top_k]

        scored: List[tuple[float, MemoryItem]] = []
        for item in self._index.values():
            if item.embedding:
                score = cosine_similarity(query_emb, item.embedding)
                scored.append((score, item))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [item for _, item in scored[:top_k]]


memory_retrieval = MemoryRetrievalEngine()

"""Export API Router.

Implements POST /api/export/pdf and POST /api/export/epub.
Filters and compiles only canonical author-approved content.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from backend.database.database import db
from backend.export.pdf import generate_pdf
from backend.export.epub import generate_epub

router = APIRouter(tags=["Export"])


class ExportRequest(BaseModel):
    story_id: str
    title: Optional[str] = None
    author: Optional[str] = "Story Forge Writer"


@router.post("/api/export/pdf")
def export_story_pdf(req: ExportRequest):
    """Generates and downloads a PDF of the canonical story."""
    story = db.get_story(req.story_id)
    if not story:
        raise HTTPException(status_code=404, detail=f"Story '{req.story_id}' not found.")

    entries = db.get_prose_entries(req.story_id)
    graph = db.load_graph(req.story_id)

    prose_segments = [e.model_dump() for e in entries]
    story_title = req.title or story.title

    pdf_bytes = generate_pdf(
        title=story_title,
        prose_segments=prose_segments,
        graph=graph,
        author_name=req.author or "Story Forge Writer"
    )

    clean_filename = "".join(c for c in story_title if c.isalnum() or c in (" ", "_", "-")).rstrip()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{clean_filename or "story"}.pdf"'
        }
    )


@router.post("/api/export/epub")
def export_story_epub(req: ExportRequest):
    """Generates and downloads an EPUB eBook of the canonical story."""
    story = db.get_story(req.story_id)
    if not story:
        raise HTTPException(status_code=404, detail=f"Story '{req.story_id}' not found.")

    entries = db.get_prose_entries(req.story_id)
    graph = db.load_graph(req.story_id)

    prose_segments = [e.model_dump() for e in entries]
    story_title = req.title or story.title

    epub_bytes = generate_epub(
        title=story_title,
        prose_segments=prose_segments,
        graph=graph,
        author_name=req.author or "Story Forge Writer"
    )

    clean_filename = "".join(c for c in story_title if c.isalnum() or c in (" ", "_", "-")).rstrip()
    return Response(
        content=epub_bytes,
        media_type="application/epub+zip",
        headers={
            "Content-Disposition": f'attachment; filename="{clean_filename or "story"}.epub"'
        }
    )

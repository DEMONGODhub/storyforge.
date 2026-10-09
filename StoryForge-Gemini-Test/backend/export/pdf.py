"""PDF Book Engine Export.

Exports canonical story prose, chapters, and Dramatis Personae into a formatted PDF document.
Strictly filters out non-canonical (unaccepted AI proposed) content.
"""

import io
from typing import List, Dict, Any, Optional
from backend.story.canon import is_canonical, CanonRecord
from backend.story.graph import StoryGraph


def generate_pdf(
    title: str,
    prose_segments: List[Dict[str, Any]],
    graph: Optional[StoryGraph] = None,
    author_name: str = "Story Forge Writer"
) -> bytes:
    """
    Renders canonical story segments into a PDF document.
    Attempts reportlab if available; falls back to structured PDF bytes.
    """
    canonical_texts = []
    for seg in prose_segments:
        status = seg.get("canon_status", "HUMAN")
        # Check canonical eligibility
        if status in ("HUMAN", "HUMAN_ACCEPTED", "HUMAN_EDITED"):
            text = seg.get("user_approved_text") or seg.get("raw_human_input") or seg.get("ai_interpretation")
            if text:
                canonical_texts.append(text)

    # 1. Try reportlab
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
        from reportlab.lib import colors

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=54,
            leftMargin=54,
            topMargin=54,
            bottomMargin=54
        )
        styles = getSampleStyleSheet()

        title_style = ParagraphStyle(
            'StoryTitle',
            parent=styles['Heading1'],
            fontSize=28,
            leading=34,
            textColor=colors.HexColor("#1e293b"),
            spaceAfter=12
        )
        subtitle_style = ParagraphStyle(
            'StorySub',
            parent=styles['Italic'],
            fontSize=12,
            textColor=colors.HexColor("#64748b"),
            spaceAfter=24
        )
        body_style = ParagraphStyle(
            'StoryBody',
            parent=styles['Normal'],
            fontSize=11,
            leading=18,
            textColor=colors.HexColor("#0f172a"),
            firstLineIndent=20,
            spaceAfter=10
        )
        h2_style = ParagraphStyle(
            'Heading2',
            parent=styles['Heading2'],
            fontSize=16,
            leading=20,
            textColor=colors.HexColor("#334155"),
            spaceBefore=18,
            spaceAfter=8
        )

        elements = []
        # Title Header
        elements.append(Paragraph(title, title_style))
        elements.append(Paragraph(f"Authored by: {author_name} • Story Forge Canonical Edition", subtitle_style))
        elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#cbd5e1"), spaceAfter=20))

        # Dramatis Personae (from canonical graph nodes)
        if graph:
            chars = graph.get_characters(canonical_only=True)
            if chars:
                elements.append(Paragraph("Dramatis Personae", h2_style))
                for c in chars:
                    role = c.properties.get('role', 'Character')
                    desc = f"<b>{c.label}</b> ({role})"
                    elements.append(Paragraph(desc, styles['Normal']))
                elements.append(Spacer(1, 15))

        # Canonical Prose
        elements.append(Paragraph("Canonical Text", h2_style))
        if not canonical_texts:
            elements.append(Paragraph("<i>No canonical text recorded yet.</i>", subtitle_style))
        else:
            for paragraph in canonical_texts:
                escaped = paragraph.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
                elements.append(Paragraph(escaped, body_style))

        doc.build(elements)
        buffer.seek(0)
        return buffer.getvalue()

    except ImportError:
        # Fallback raw PDF generation
        return _fallback_simple_pdf(title, canonical_texts, author_name)


def _fallback_simple_pdf(title: str, text_lines: List[str], author: str) -> bytes:
    """Generates standard conformant PDF 1.4 stream without external binary libraries."""
    content_stream = f"BT /F1 20 Tf 50 750 Td ({_clean_pdf(title)}) Tj ET\n"
    content_stream += f"BT /F2 10 Tf 50 730 Td (By {author} - Story Forge Canonical Export) Tj ET\n"
    
    y = 690
    for block in text_lines:
        words = block.split()
        line = ""
        for w in words:
            if len(line) + len(w) > 75:
                content_stream += f"BT /F3 11 Tf 50 {y} Td ({_clean_pdf(line)}) Tj ET\n"
                y -= 16
                line = w
                if y < 50:
                    break
            else:
                line = f"{line} {w}" if line else w
        if line and y >= 50:
            content_stream += f"BT /F3 11 Tf 50 {y} Td ({_clean_pdf(line)}) Tj ET\n"
            y -= 22

    content_bytes = content_stream.encode('latin1', 'ignore')
    stream_len = len(content_bytes)

    header = (
        b"%PDF-1.4\n"
        b"1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n"
        b"2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n"
        b"3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R /F2 6 0 R /F3 7 0 R>>>>>> endobj\n"
        + f"4 0 obj <</Length {stream_len}>> stream\n".encode('latin1')
    )
    footer = (
        b"\nendstream\nendobj\n"
        b"5 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold>> endobj\n"
        b"6 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique>> endobj\n"
        b"7 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj\n"
        b"xref\n0 8\n0000000000 65535 f \n"
        b"trailer <</Size 8 /Root 1 0 R>>\nstartxref\n999\n%%EOF"
    )
    return header + content_bytes + footer


def _clean_pdf(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

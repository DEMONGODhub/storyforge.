"""EPUB Book Engine Export.

Generates standard EPUB 3 / XHTML eBook containing only canonical story text and Dramatis Personae.
Strictly ignores unapproved AI proposed snippets.
"""

import io
import zipfile
from typing import List, Dict, Any, Optional
from backend.story.graph import StoryGraph


def generate_epub(
    title: str,
    prose_segments: List[Dict[str, Any]],
    graph: Optional[StoryGraph] = None,
    author_name: str = "Story Forge Writer"
) -> bytes:
    """Creates a standard EPUB 3 zip container."""
    canonical_texts = []
    for seg in prose_segments:
        status = seg.get("canon_status", "HUMAN")
        if status in ("HUMAN", "HUMAN_ACCEPTED", "HUMAN_EDITED"):
            text = seg.get("user_approved_text") or seg.get("raw_human_input") or seg.get("ai_interpretation")
            if text:
                canonical_texts.append(text)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as epub:
        # 1. mimetype (must be uncompressed first file)
        epub.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)

        # 2. META-INF/container.xml
        container_xml = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""
        epub.writestr("META-INF/container.xml", container_xml)

        # 3. HTML Chapter Content
        body_html = f"<h1>{_escape(title)}</h1>\n<p class='byline'>By {_escape(author_name)}</p>\n<hr/>\n"

        if graph:
            chars = graph.get_characters(canonical_only=True)
            if chars:
                body_html += "<h2>Dramatis Personae</h2>\n<ul>\n"
                for c in chars:
                    role = c.properties.get("role", "Character")
                    body_html += f"<li><strong>{_escape(c.label)}</strong> ({_escape(role)})</li>\n"
                body_html += "</ul>\n<hr/>\n"

        body_html += "<h2>Canonical Story</h2>\n"
        if not canonical_texts:
            body_html += "<p><em>No canonical text recorded yet.</em></p>\n"
        else:
            for para in canonical_texts:
                body_html += f"<p>{_escape(para)}</p>\n"

        chapter_xhtml = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>{_escape(title)}</title>
  <style>
    body {{ font-family: serif; margin: 5%; line-height: 1.6; color: #1e293b; }}
    h1 {{ font-size: 2em; margin-bottom: 0.2em; }}
    h2 {{ font-size: 1.3em; margin-top: 1.5em; border-bottom: 1px solid #e2e8f0; }}
    .byline {{ color: #64748b; font-style: italic; }}
    p {{ text-indent: 1.5em; margin: 0.5em 0; }}
  </style>
</head>
<body>
{body_html}
</body>
</html>"""
        epub.writestr("OEBPS/chapter.xhtml", chapter_xhtml)

        # 4. content.opf
        content_opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>{_escape(title)}</dc:title>
    <dc:creator>{_escape(author_name)}</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">story-forge-{abs(hash(title))}</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>"""
        epub.writestr("OEBPS/content.opf", content_opf)

    buffer.seek(0)
    return buffer.getvalue()


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )

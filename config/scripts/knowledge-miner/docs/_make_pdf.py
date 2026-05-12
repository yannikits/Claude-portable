"""Convert Benutzeranleitung.md to PDF using reportlab."""
import re
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Preformatted,
    Table, TableStyle, HRFlowable,
)

MD = Path(__file__).parent / "Benutzeranleitung.md"
OUT = Path(__file__).parent / "Benutzeranleitung.pdf"

styles = getSampleStyleSheet()

H1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=18, spaceAfter=10,
                    textColor=colors.HexColor("#1a1a2e"))
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=14, spaceBefore=14,
                    spaceAfter=6, textColor=colors.HexColor("#16213e"))
H3 = ParagraphStyle("H3", parent=styles["Heading3"], fontSize=11, spaceBefore=8,
                    spaceAfter=4, textColor=colors.HexColor("#0f3460"))
BODY = ParagraphStyle("Body", parent=styles["Normal"], fontSize=9.5, leading=14, spaceAfter=4)
CODE = ParagraphStyle("Code", fontName="Courier", fontSize=8.5, leading=12,
                      backColor=colors.HexColor("#f5f5f5"), leftIndent=12, rightIndent=12,
                      spaceAfter=6, spaceBefore=4)
BULLET = ParagraphStyle("Bullet", parent=BODY, leftIndent=16, bulletIndent=8, spaceAfter=2)


def escape(text: str) -> str:
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", r'<font name="Courier" size="8">\1</font>', text)
    return text


def parse_md(md_text: str):
    story = []
    lines = md_text.splitlines()
    i = 0
    in_code = False
    code_buf = []
    table_buf = []
    in_table = False

    while i < len(lines):
        line = lines[i]

        if line.strip().startswith("```"):
            if not in_code:
                in_code = True
                code_buf = []
            else:
                in_code = False
                story.append(Preformatted("\n".join(code_buf), CODE))
            i += 1
            continue

        if in_code:
            code_buf.append(line)
            i += 1
            continue

        if line.startswith("|"):
            if not in_table:
                in_table = True
                table_buf = []
            cells = [c.strip() for c in line.strip("|").split("|")]
            table_buf.append(cells)
            i += 1
            continue
        else:
            if in_table:
                in_table = False
                rows = [r for r in table_buf if not all(set(c) <= set("-: ") for c in r)]
                if rows:
                    header = rows[0]
                    data_rows = rows[1:]
                    tdata = [[Paragraph(f"<b>{escape(c)}</b>", BODY) for c in header]]
                    for row in data_rows:
                        tdata.append([Paragraph(escape(c), BODY) for c in row])
                    col_w = (A4[0] - 4 * cm) / max(len(header), 1)
                    t = Table(tdata, colWidths=[col_w] * len(header))
                    t.setStyle(TableStyle([
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eaf6")),
                        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
                        ("FONTSIZE", (0, 0), (-1, -1), 9),
                        ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                        ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ]))
                    story.append(t)
                    story.append(Spacer(1, 6))

        stripped = line.strip()

        if not stripped:
            story.append(Spacer(1, 4))
        elif stripped == "---":
            story.append(HRFlowable(width="100%", thickness=0.5,
                                    color=colors.HexColor("#cccccc"), spaceAfter=6))
        elif re.match(r"^# [^#]", stripped):
            story.append(Paragraph(escape(stripped[2:]), H1))
        elif re.match(r"^## [^#]", stripped):
            story.append(Paragraph(escape(stripped[3:]), H2))
        elif re.match(r"^### ", stripped):
            story.append(Paragraph(escape(stripped[4:]), H3))
        elif stripped.startswith("- ") or stripped.startswith("* "):
            story.append(Paragraph(escape(stripped[2:]), BULLET))
        elif re.match(r"^\d+\. ", stripped):
            story.append(Paragraph(escape(stripped), BULLET))
        else:
            story.append(Paragraph(escape(stripped), BODY))

        i += 1

    return story


def main():
    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2.5 * cm, bottomMargin=2 * cm,
        title="Session Knowledge Miner — Benutzeranleitung",
        author="Knowledge Miner",
    )
    story = parse_md(MD.read_text(encoding="utf-8"))
    doc.build(story)
    print(f"PDF erstellt: {OUT}")


if __name__ == "__main__":
    main()

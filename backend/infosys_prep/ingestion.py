"""
ingestion.py  –  First-run paper ingestion pipeline.
Reads papers from /papers folder, parses them, stores in SQLite.
"""
import os
from pathlib import Path
import database as db
from parser import parse_paper

# Map filename → friendly display name
PAPER_META = {
    "Infosys_SE_Mock_Paper (1).pdf": "Paper 1",
    "Infosys_SE_Mock_Paper_2.pdf":   "Paper 2",
    "Infosys_SE_Mock_Paper_3.pdf":   "Paper 3",
    "Infosys_SE_Mock_Paper_4.pdf":   "Paper 4",
    "Infosys_SE_Mock_Paper_5.docx":  "Paper 5",
    "Infosys_SE_Mock_Paper_6.docx":  "Paper 6",
    "Infosys_SE_Mock_Paper_7.docx":  "Paper 7",
}


def get_papers_dir() -> Path:
    """Returns absolute path to the /papers folder."""
    return Path(__file__).resolve().parent.parent / "papers"


def ingest_all(progress_callback=None):
    """
    Parse & store all papers that haven't been ingested yet.
    progress_callback(msg: str) is called for UI updates.
    """
    papers_dir = get_papers_dir()
    if not papers_dir.exists():
        if progress_callback:
            progress_callback("❌ /papers directory not found. Please create it and add your PDFs/DOCXs.")
        return

    for filename, display_name in PAPER_META.items():
        fp = papers_dir / filename
        if not fp.exists():
            if progress_callback:
                progress_callback(f"⚠️  {filename} not found — skipping.")
            continue

        # Check if already ingested
        paper_id = db.upsert_paper(display_name, filename)
        paper    = db.get_paper(paper_id)
        if paper["parsed"]:
            if progress_callback:
                progress_callback(f"✅ {display_name} already ingested ({paper['total_q']} questions).")
            continue

        if progress_callback:
            progress_callback(f"⏳ Parsing {display_name} ({filename}) …")

        try:
            questions = parse_paper(str(fp))
            # Inject paper_id
            for q in questions:
                q["paper_id"] = paper_id
            db.bulk_insert_questions(paper_id, questions)
            db.mark_paper_parsed(paper_id, len(questions))
            if progress_callback:
                progress_callback(
                    f"✅ {display_name} ingested — {len(questions)} questions "
                    f"({sum(1 for q in questions if q['correct_ans'])} with answers)."
                )
        except Exception as e:
            if progress_callback:
                progress_callback(f"❌ Error parsing {display_name}: {e}")

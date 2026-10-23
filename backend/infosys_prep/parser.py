"""
parser.py  –  PDF/DOCX question + answer-key extractor
Handles all 7 Infosys SE Mock papers (4 PDF + 3 DOCX).
"""
import re
from pathlib import Path
import pdfplumber
from docx import Document


# ─── text cleaning ────────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    if not text:
        return ""
    # Normalise unicode punctuation
    for src, dst in [
        ("\u2013", "-"), ("\u2014", "-"), ("\u2212", "-"),
        ("\u2019", "'"), ("\u2018", "'"),
        ("\u201c", '"'), ("\u201d", '"'),
        ("\u00d7", "x"), ("\u00f7", "/"),
        ("\u2264", "<="), ("\u2265", ">="),
        ("\u2260", "!="), ("\u221a", "sqrt"),
    ]:
        text = text.replace(src, dst)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


# ─── answer-key parsing ───────────────────────────────────────────────────────

# Matches   "1. (c) explanation text"    or   "1.(c) explanation"
_EXPL_LINE = re.compile(
    r"^(\d{1,2})\.\s*\(([a-dA-D])\)[\.:\s]+(.+)$"
)
# Matches inline blocks like  "26. (b) 27. (b) 28. (b)"
_INLINE_AK = re.compile(r"(\d{1,2})\.\s*\(([a-dA-D])\)")


def _parse_answer_key(lines: list[str]) -> dict[int, dict]:
    """
    Returns {q_num: {'ans': 'A', 'expl': '...'}}
    Handles both per-line and inline-block answer key formats.
    """
    answers: dict[int, dict] = {}
    pending_num: int | None = None    # for multi-line explanations

    for raw in lines:
        line = _clean(raw)
        if not line:
            continue

        if _SEC_HDR.match(line):
            pending_num = None
            continue

        # Try  "1. (c) explanation …"
        m = _EXPL_LINE.match(line)
        if m:
            q_num = int(m.group(1))
            ans   = m.group(2).upper()
            expl  = m.group(3).strip()
            if q_num not in answers:
                answers[q_num] = {"ans": ans, "expl": expl}
            else:
                if not answers[q_num]["expl"]:
                    answers[q_num]["expl"] = expl
            pending_num = q_num
            continue

        # Continuation of previous explanation (line starts without a Q number)
        if pending_num and not re.match(r"^\d{1,2}\.", line):
            answers[pending_num]["expl"] = (
                answers[pending_num].get("expl", "") + " " + line
            ).strip()
            continue

        # Inline block  "26. (b) 27. (b) 28. (a) …"
        all_matches = _INLINE_AK.findall(line)
        if len(all_matches) >= 2:
            for (q_str, ans_ch) in all_matches:
                q_num = int(q_str)
                if q_num not in answers:
                    answers[q_num] = {"ans": ans_ch.upper(), "expl": ""}
            pending_num = None
            continue

        pending_num = None

    return answers


# ─── answer-key section detection ────────────────────────────────────────────

def _is_ak_start(line: str) -> bool:
    """True when we've hit the answer-key / scoring section."""
    l = line.strip()
    if re.match(r"^(Answer\s*Key|Answers?|Key|Scoring\s*Guide)\s*$", l, re.IGNORECASE):
        return True
    # 3+ inline entries with negligible residue
    matches = _INLINE_AK.findall(l)
    if len(matches) >= 3:
        residue = _INLINE_AK.sub("", l).strip()
        if len(residue) < 20:
            return True
    # Lines like  "1. (c) explanation"  after Q60 marker
    if re.match(r"^1\.\s*\([a-dA-D]\)", l) and "Q1" not in l:
        return True
    return False


# ─── option parsing ───────────────────────────────────────────────────────────

_OPT_RE = re.compile(r"\(([a-dA-D])\)\s*(.+?)(?=\s*\([a-dA-D]\)|$)", re.IGNORECASE)


def _split_options(text: str) -> dict[str, str]:
    opts: dict[str, str] = {}
    for m in _OPT_RE.finditer(text):
        key = m.group(1).upper()
        val = _clean(m.group(2))
        opts[key] = val
    return opts


# ─── question builder ─────────────────────────────────────────────────────────

_Q_START   = re.compile(r"^Q(\d{1,2})\.\s+(.*)", re.DOTALL)
_SEC_HDR   = re.compile(r"^SECTION\s+\d+", re.IGNORECASE)


def _build_questions(raw_lines: list[str], answers: dict) -> list[dict]:
    questions: list[dict] = []
    current_q:   dict | None = None
    opt_text:    str         = ""
    section:     str         = ""

    def flush():
        nonlocal current_q, opt_text
        if current_q is None:
            return
        qn = current_q["q_number"]
        opts = _split_options(opt_text)
        current_q.update({
            "opt_a": opts.get("A", ""),
            "opt_b": opts.get("B", ""),
            "opt_c": opts.get("C", ""),
            "opt_d": opts.get("D", ""),
            "correct_ans": answers.get(qn, {}).get("ans", ""),
            "explanation": answers.get(qn, {}).get("expl", ""),
            "trick": "",
        })
        questions.append(current_q)
        current_q = None
        opt_text  = ""

    for raw in raw_lines:
        line = _clean(raw)
        if not line:
            continue
        if _SEC_HDR.match(line):
            # A section heading can follow the final option without a new
            # question marker. End the previous question before reading the
            # section's passage or questions.
            flush()
            section = line
            continue

        m = _Q_START.match(line)
        if m:
            flush()
            current_q = {
                "q_number": int(m.group(1)),
                "section":  section,
                "question": _clean(m.group(2)),
                "paper_id": None,
            }
            opt_text = ""
            continue

        if current_q is not None:
            has_opts = bool(re.search(r"\([a-dA-D]\)", line))
            if has_opts:
                # Find where options start
                os = re.search(r"\([a-dA-D]\)", line)
                if os:
                    before = line[:os.start()].strip()
                    if before and not opt_text:
                        current_q["question"] = _clean(
                            current_q["question"] + " " + before
                        )
                    opt_text += " " + line[os.start():]
            else:
                if not opt_text:
                    current_q["question"] = _clean(
                        current_q["question"] + " " + line
                    )
                else:
                    opt_text += " " + line

    flush()
    return questions


# ─── PDF reader ───────────────────────────────────────────────────────────────

def parse_pdf(filepath: str) -> list[dict]:
    with pdfplumber.open(filepath) as pdf:
        all_lines: list[str] = []
        for page in pdf.pages:
            text = page.extract_text() or ""
            all_lines.extend(text.splitlines())

    q_lines:  list[str] = []
    ak_lines: list[str] = []
    in_ak = False
    for line in all_lines:
        if not in_ak and _is_ak_start(line):
            in_ak = True
        (ak_lines if in_ak else q_lines).append(line)

    answers = _parse_answer_key(ak_lines)
    return _build_questions(q_lines, answers)


# ─── DOCX reader ─────────────────────────────────────────────────────────────

def parse_docx(filepath: str) -> list[dict]:
    doc = Document(filepath)
    all_lines = [para.text for para in doc.paragraphs]

    q_lines:  list[str] = []
    ak_lines: list[str] = []
    in_ak = False
    for line in all_lines:
        if not in_ak and _is_ak_start(line):
            in_ak = True
        (ak_lines if in_ak else q_lines).append(line)

    answers = _parse_answer_key(ak_lines)
    return _build_questions(q_lines, answers)


# ─── public API ──────────────────────────────────────────────────────────────

def parse_paper(filepath: str) -> list[dict]:
    ext = Path(filepath).suffix.lower()
    if ext == ".pdf":
        return parse_pdf(filepath)
    elif ext in (".docx", ".doc"):
        return parse_docx(filepath)
    raise ValueError(f"Unsupported file type: {ext}")


# ─── quick smoke test ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    fp = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).resolve().parent.parent / "papers" / "Infosys_SE_Mock_Paper (1).pdf")
    qs = parse_paper(fp)
    print(f"Parsed {len(qs)} questions from {fp}")
    ok  = sum(1 for q in qs if q["correct_ans"])
    expl = sum(1 for q in qs if q["explanation"])
    print(f"  With answers: {ok}/{len(qs)}")
    print(f"  With explanations: {expl}/{len(qs)}")
    for q in qs[:5]:
        print(f"\n  Q{q['q_number']}: {q['question'][:70]}")
        print(f"    (a){q['opt_a'][:30]}  (b){q['opt_b'][:30]}")
        print(f"    Ans={q['correct_ans']}  Expl={q['explanation'][:60]}")

"""
scripts/parse_papers.py
Run once from the project root:
    python scripts/parse_papers.py

Reads all 7 Infosys SE Mock Papers from papers/
and writes src/data/papers.json for the Next.js app.
"""
import sys, re, json
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

# ──────────────────────────────────────────────
# Install deps if missing
# ──────────────────────────────────────────────
try:
    import pdfplumber
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "pdfplumber", "python-docx"], check=True)
    import pdfplumber

from docx import Document

# ──────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
PROJECT_DIR  = SCRIPT_DIR.parent
PAPERS_DIR   = PROJECT_DIR.parent.parent / "backend" / "papers"
OUTPUT_FILE  = PROJECT_DIR / "src" / "data" / "papers.json"

PAPER_DEFS = [
    (1, "Infosys_SE_Mock_Paper (1).pdf",  "Paper 1"),
    (2, "Infosys_SE_Mock_Paper_2.pdf",    "Paper 2"),
    (3, "Infosys_SE_Mock_Paper_3.pdf",    "Paper 3"),
    (4, "Infosys_SE_Mock_Paper_4.pdf",    "Paper 4"),
    (5, "Infosys_SE_Mock_Paper_5.docx",   "Paper 5"),
    (6, "Infosys_SE_Mock_Paper_6.docx",   "Paper 6"),
    (7, "Infosys_SE_Mock_Paper_7.docx",   "Paper 7"),
]

# ──────────────────────────────────────────────
# Text helpers
# ──────────────────────────────────────────────
def clean(text: str) -> str:
    if not text:
        return ""
    for src, dst in [
        ("\u2013","-"), ("\u2014","-"), ("\u2212","-"),
        ("\u2019","'"), ("\u2018","'"),
        ("\u201c",'"'), ("\u201d",'"'),
        ("\u00d7","x"), ("\u00f7","/"),
        ("\u2264","<="), ("\u2265",">="),
        ("\u2260","!="), ("\u221a","sqrt"),
        ("\u03c0","pi"), ("\u00b2","^2"),
    ]:
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip()

# ──────────────────────────────────────────────
# Answer-key parsing
# ──────────────────────────────────────────────
_EXPL_LINE  = re.compile(r"^(\d{1,2})\.\s*\(([a-dA-D])\)[\.:\s]+(.+)$")
_INLINE_AK  = re.compile(r"(\d{1,2})\.\s*\(([a-dA-D])\)")

def parse_answer_key(lines: list[str]) -> dict:
    answers = {}
    pending = None
    for raw in lines:
        line = clean(raw)
        if not line:
            continue

        if _SEC_HDR.match(line):
            pending = None
            continue

        m = _EXPL_LINE.match(line)
        if m:
            n, ans, expl = int(m.group(1)), m.group(2).upper(), m.group(3).strip()
            if n not in answers:
                answers[n] = {"ans": ans, "expl": expl}
            elif not answers[n]["expl"]:
                answers[n]["expl"] = expl
            pending = n
            continue
        if pending and not re.match(r"^\d{1,2}\.", line):
            answers[pending]["expl"] = (answers[pending].get("expl","") + " " + line).strip()
            continue
        all_m = _INLINE_AK.findall(line)
        if len(all_m) >= 2:
            for (q_s, a_ch) in all_m:
                q = int(q_s)
                if q not in answers:
                    answers[q] = {"ans": a_ch.upper(), "expl": ""}
            pending = None
            continue
        pending = None
    return answers

# ──────────────────────────────────────────────
# AK-section detector
# ──────────────────────────────────────────────
def is_ak_start(line: str) -> bool:
    l = line.strip()
    if re.match(r"^(Answer\s*Key|Answers?|Key|Scoring\s*Guide)\s*$", l, re.IGNORECASE):
        return True
    matches = _INLINE_AK.findall(l)
    if len(matches) >= 3:
        residue = _INLINE_AK.sub("", l).strip()
        if len(residue) < 20:
            return True
    if re.match(r"^1\.\s*\([a-dA-D]\)", l) and "Q1" not in l:
        return True
    return False

# ──────────────────────────────────────────────
# Option parsing
# ──────────────────────────────────────────────
_OPT_RE = re.compile(r"\(([a-dA-D])\)\s*(.+?)(?=\s*\([a-dA-D]\)|$)", re.IGNORECASE)

def split_options(text: str) -> dict:
    opts = {}
    for m in _OPT_RE.finditer(text):
        opts[m.group(1).upper()] = clean(m.group(2))
    return opts

# ──────────────────────────────────────────────
# Trick generator (rule-based, no LLM)
# ──────────────────────────────────────────────
def make_trick(question: str, section: str) -> str:
    q = question.lower()
    s = (section or "").lower()
    if "conclusion" in q or "statement" in q:
        return "Draw Venn diagrams: All A are B = A inside B circle. Some = overlap. No = no overlap."
    if "data sufficiency" in q:
        return "Try with different numbers (e.g. positive + negative). If different answers → insufficient."
    if "coded" in q or "code" in q and ("written as" in q or "means" in q):
        return "Compare letter-by-letter. Spot the shift/substitution pattern using 1-2 known mappings."
    if "direction" in q or "north" in q or "bearing" in q:
        return "Always draw the path on paper. Clockwise 90° = right turn. Sum vectors for final position."
    if "series" in q or "next term" in q or "sequence" in q:
        return "Check: differences, then differences-of-differences, then ratios, then n² / n³ patterns."
    if "probability" in q:
        return "P(at least one) = 1 - P(none). Use combinations for 'without replacement' problems."
    if "permutation" in q or "arrangement" in q or "ways can" in q:
        return "Permutation (order matters) = nPr. Combination (order ignored) = nCr = nPr/r!"
    if "profit" in q or "discount" in q or "marked" in q:
        return "Discount stacks multiply: 10% + 10% ≠ 20%. Use: SP = MP × (1 - d₁) × (1 - d₂)."
    if "work" in q and ("days" in q or "hours" in q):
        return "Work rate = 1/days. Combined = 1/A + 1/B. LCM method avoids fractions entirely."
    if "train" in q or ("speed" in q and "distance" in q):
        return "Opposite directions: add speeds. Same direction: subtract. Total = sum of lengths."
    if "age" in q:
        return "Let current age = x. 'n years ago' → (x-n), 'n years hence' → (x+n). Set up equation."
    if "compound interest" in q or "simple interest" in q:
        return "SI = P×R×T/100. CI-SI difference for 2 yrs = P(R/100)². For 3 yrs use formula directly."
    if "rectangle" in q or "square" in q and "grid" in q:
        return "Rectangles in m×n grid = C(m+1,2) × C(n+1,2). Squares need a separate count by size."
    if "cube" in q and ("painted" in q or "cut" in q):
        return "3 faces painted = corners (always 8). 2 faces = edges. 1 face = face centres. 0 = inner."
    if "pseudo" in s or "code" in s:
        return "Trace line-by-line with real values. Don't guess — write variable values at each step."
    if "puzzle" in s or "numeric" in s or "matchstick" in q:
        return "Find the rule from given examples before solving. Test your rule on a known entry first."
    if "reading" in q or "passage" in q or "central idea" in q:
        return "The answer is always in the passage text. Avoid options with extreme words (always/never)."
    if "error" in q and ("spotting" in q or "part" in q):
        return "Read each part as a standalone sentence. Check subject-verb agreement and tense consistency."
    if "fill" in q or "blank" in q or "article" in q:
        return "'a' before consonant sound, 'an' before vowel sound. 'the' for specific/known nouns."
    if "grammar" in s or "english" in s:
        return "Say the sentence aloud. Your ear catches subject-verb mismatches and tense errors quickly."
    return "Eliminate obviously wrong options first. Then verify the remaining one against the question."

# ──────────────────────────────────────────────
# Question builder
# ──────────────────────────────────────────────
_Q_START = re.compile(r"^Q(\d{1,2})\.\s+(.*)", re.DOTALL)
_SEC_HDR = re.compile(r"^SECTION\s+\d+", re.IGNORECASE)

def build_questions(raw_lines: list[str], answers: dict, paper_id: int) -> list[dict]:
    questions = []
    cur_q     = None
    opt_text  = ""
    section   = ""
    q_uid     = 0  # running id within paper

    def flush():
        nonlocal cur_q, opt_text, q_uid
        if cur_q is None:
            return
        qn   = cur_q["qNumber"]
        opts = split_options(opt_text)
        ak   = answers.get(qn, {})
        expl = ak.get("expl", "")
        trick = make_trick(cur_q["question"], cur_q["section"])
        q_uid += 1
        questions.append({
            "id":          q_uid,
            "paperId":     paper_id,
            "qNumber":     qn,
            "section":     cur_q["section"],
            "question":    cur_q["question"],
            "optA":        opts.get("A", ""),
            "optB":        opts.get("B", ""),
            "optC":        opts.get("C", ""),
            "optD":        opts.get("D", ""),
            "correctAns":  ak.get("ans", ""),
            "explanation": expl,
            "trick":       trick,
        })
        cur_q    = None
        opt_text = ""

    for raw in raw_lines:
        line = clean(raw)
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
            cur_q = {
                "qNumber": int(m.group(1)),
                "section": section,
                "question": clean(m.group(2)),
            }
            opt_text = ""
            continue
        if cur_q is not None:
            has_opts = bool(re.search(r"\([a-dA-D]\)", line))
            if has_opts:
                os_m = re.search(r"\([a-dA-D]\)", line)
                before = line[:os_m.start()].strip()
                if before and not opt_text:
                    cur_q["question"] = clean(cur_q["question"] + " " + before)
                opt_text += " " + line[os_m.start():]
            else:
                if not opt_text:
                    cur_q["question"] = clean(cur_q["question"] + " " + line)
                else:
                    opt_text += " " + line

    flush()
    return questions

# ──────────────────────────────────────────────
# PDF reader
# ──────────────────────────────────────────────
def parse_pdf(filepath: str, paper_id: int) -> list[dict]:
    with pdfplumber.open(filepath) as pdf:
        all_lines = []
        for page in pdf.pages:
            all_lines.extend((page.extract_text() or "").splitlines())

    q_lines, ak_lines = [], []
    in_ak = False
    for line in all_lines:
        if not in_ak and is_ak_start(line):
            in_ak = True
        (ak_lines if in_ak else q_lines).append(line)

    answers = parse_answer_key(ak_lines)
    return build_questions(q_lines, answers, paper_id)

# ──────────────────────────────────────────────
# DOCX reader
# ──────────────────────────────────────────────
def parse_docx(filepath: str, paper_id: int) -> list[dict]:
    doc = Document(filepath)
    all_lines = [p.text for p in doc.paragraphs]

    q_lines, ak_lines = [], []
    in_ak = False
    for line in all_lines:
        if not in_ak and is_ak_start(line):
            in_ak = True
        (ak_lines if in_ak else q_lines).append(line)

    answers = parse_answer_key(ak_lines)
    return build_questions(q_lines, answers, paper_id)

# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
def main():
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    papers_json = []

    for (paper_id, filename, display_name) in PAPER_DEFS:
        fp = PAPERS_DIR / filename
        if not fp.exists():
            print(f"  ⚠️  {filename} not found at {fp} — skipping.")
            continue

        print(f"Parsing {display_name} ({filename}) …")
        ext = fp.suffix.lower()
        if ext == ".pdf":
            questions = parse_pdf(str(fp), paper_id)
        else:
            questions = parse_docx(str(fp), paper_id)

        n_ans  = sum(1 for q in questions if q["correctAns"])
        n_expl = sum(1 for q in questions if q["explanation"])
        print(f"  -> {len(questions)} questions | {n_ans} with answers | {n_expl} with explanations")

        papers_json.append({
            "id":       paper_id,
            "name":     display_name,
            "filename": filename,
            "totalQ":   len(questions),
            "questions": questions,
        })

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(papers_json, f, ensure_ascii=False, indent=2)

    total_q = sum(p["totalQ"] for p in papers_json)
    print(f"\n✅ Done! {len(papers_json)} papers, {total_q} questions → {OUTPUT_FILE}")

if __name__ == "__main__":
    main()

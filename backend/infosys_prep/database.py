"""
database.py  –  SQLite schema & helpers
"""
import sqlite3, bcrypt, os
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "app.db"


def get_conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_conn()
    c = conn.cursor()

    # ── Users ────────────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT    UNIQUE NOT NULL,
            pw_hash  TEXT    NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created  TEXT    DEFAULT (datetime('now'))
        )
    """)

    # ── Papers ───────────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS papers (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    UNIQUE NOT NULL,
            filename    TEXT    NOT NULL,
            total_q     INTEGER NOT NULL DEFAULT 0,
            parsed      INTEGER NOT NULL DEFAULT 0   -- 0=pending,1=done
        )
    """)

    # ── Questions ────────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS questions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            paper_id     INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            q_number     INTEGER NOT NULL,
            section      TEXT,
            question     TEXT    NOT NULL,
            opt_a        TEXT,
            opt_b        TEXT,
            opt_c        TEXT,
            opt_d        TEXT,
            correct_ans  TEXT    NOT NULL,   -- 'A','B','C','D' or full text
            explanation  TEXT,
            trick        TEXT,
            UNIQUE(paper_id, q_number)
        )
    """)

    # ── Attempts (one per user per paper) ────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS attempts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            paper_id    INTEGER NOT NULL REFERENCES papers(id),
            started_at  TEXT    DEFAULT (datetime('now')),
            finished_at TEXT,
            score       INTEGER,
            total_q     INTEGER,
            status      TEXT    DEFAULT 'in_progress'  -- in_progress / completed
        )
    """)

    # ── Per-question responses ────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS responses (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            attempt_id  INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL REFERENCES questions(id),
            chosen_ans  TEXT,                    -- NULL = skipped
            is_correct  INTEGER,                 -- 1/0/NULL(skip)
            time_spent  INTEGER DEFAULT 0,       -- seconds
            UNIQUE(attempt_id, question_id)
        )
    """)

    conn.commit()
    conn.close()


# ── Auth helpers ──────────────────────────────────────────────────────────────

def create_user(username: str, password: str, is_admin: bool = False) -> bool:
    """Returns True on success, False if username taken."""
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    try:
        conn = get_conn()
        conn.execute(
            "INSERT INTO users (username, pw_hash, is_admin) VALUES (?,?,?)",
            (username, pw_hash, int(is_admin))
        )
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        return False


def verify_user(username: str, password: str):
    """Returns user Row or None."""
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM users WHERE username=?", (username,)
    ).fetchone()
    conn.close()
    if row and bcrypt.checkpw(password.encode(), row["pw_hash"].encode()):
        return row
    return None


def get_user_by_id(user_id: int):
    conn = get_conn()
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    return row


def ensure_admin():
    """Create admin account from .env if not already present."""
    from dotenv import load_dotenv
    load_dotenv()
    admin_user = os.getenv("ADMIN_USERNAME", "admin")
    admin_pass = os.getenv("ADMIN_PASSWORD", "admin123")
    conn = get_conn()
    exists = conn.execute(
        "SELECT id FROM users WHERE username=? AND is_admin=1", (admin_user,)
    ).fetchone()
    conn.close()
    if not exists:
        create_user(admin_user, admin_pass, is_admin=True)


# ── Paper helpers ─────────────────────────────────────────────────────────────

def upsert_paper(name: str, filename: str) -> int:
    conn = get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO papers (name, filename) VALUES (?,?)", (name, filename)
    )
    conn.commit()
    row = conn.execute("SELECT id FROM papers WHERE name=?", (name,)).fetchone()
    conn.close()
    return row["id"]


def mark_paper_parsed(paper_id: int, total_q: int):
    conn = get_conn()
    conn.execute(
        "UPDATE papers SET parsed=1, total_q=? WHERE id=?", (total_q, paper_id)
    )
    conn.commit()
    conn.close()


def get_all_papers():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM papers ORDER BY id").fetchall()
    conn.close()
    return rows


def get_paper(paper_id: int):
    conn = get_conn()
    row = conn.execute("SELECT * FROM papers WHERE id=?", (paper_id,)).fetchone()
    conn.close()
    return row


# ── Question helpers ──────────────────────────────────────────────────────────

def bulk_insert_questions(paper_id: int, questions: list[dict]):
    conn = get_conn()
    conn.execute("DELETE FROM questions WHERE paper_id=?", (paper_id,))
    conn.executemany(
        """INSERT INTO questions
           (paper_id, q_number, section, question, opt_a, opt_b, opt_c, opt_d, correct_ans)
           VALUES (:paper_id,:q_number,:section,:question,:opt_a,:opt_b,:opt_c,:opt_d,:correct_ans)""",
        questions
    )
    conn.commit()
    conn.close()


def get_questions_for_paper(paper_id: int):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM questions WHERE paper_id=? ORDER BY q_number", (paper_id,)
    ).fetchall()
    conn.close()
    return rows


def get_question(q_id: int):
    conn = get_conn()
    row = conn.execute("SELECT * FROM questions WHERE id=?", (q_id,)).fetchone()
    conn.close()
    return row


def update_question(q_id: int, **fields):
    if not fields:
        return
    set_clause = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [q_id]
    conn = get_conn()
    conn.execute(f"UPDATE questions SET {set_clause} WHERE id=?", vals)
    conn.commit()
    conn.close()


def update_explanation(q_id: int, explanation: str, trick: str):
    conn = get_conn()
    conn.execute(
        "UPDATE questions SET explanation=?, trick=? WHERE id=?",
        (explanation, trick, q_id)
    )
    conn.commit()
    conn.close()


# ── Attempt helpers ───────────────────────────────────────────────────────────

def create_attempt(user_id: int, paper_id: int) -> int:
    conn = get_conn()
    c = conn.execute(
        "INSERT INTO attempts (user_id, paper_id, total_q) VALUES (?,?,?)",
        (user_id, paper_id, 0)
    )
    attempt_id = c.lastrowid
    conn.commit()
    conn.close()
    return attempt_id


def finish_attempt(attempt_id: int, score: int, total_q: int):
    conn = get_conn()
    conn.execute(
        """UPDATE attempts SET finished_at=datetime('now'), score=?, total_q=?, status='completed'
           WHERE id=?""",
        (score, total_q, attempt_id)
    )
    conn.commit()
    conn.close()


def get_attempts_for_user_paper(user_id: int, paper_id: int):
    conn = get_conn()
    rows = conn.execute(
        """SELECT * FROM attempts WHERE user_id=? AND paper_id=? ORDER BY started_at DESC""",
        (user_id, paper_id)
    ).fetchall()
    conn.close()
    return rows


def get_attempt(attempt_id: int):
    conn = get_conn()
    row = conn.execute("SELECT * FROM attempts WHERE id=?", (attempt_id,)).fetchone()
    conn.close()
    return row


# ── Response helpers ──────────────────────────────────────────────────────────

def upsert_response(attempt_id: int, question_id: int, chosen_ans, is_correct, time_spent: int = 0):
    conn = get_conn()
    conn.execute(
        """INSERT INTO responses (attempt_id, question_id, chosen_ans, is_correct, time_spent)
           VALUES (?,?,?,?,?)
           ON CONFLICT(attempt_id, question_id) DO UPDATE SET
               chosen_ans=excluded.chosen_ans,
               is_correct=excluded.is_correct,
               time_spent=excluded.time_spent""",
        (attempt_id, question_id, chosen_ans, is_correct, time_spent)
    )
    conn.commit()
    conn.close()


def get_responses_for_attempt(attempt_id: int):
    conn = get_conn()
    rows = conn.execute(
        """SELECT r.*, q.question, q.opt_a, q.opt_b, q.opt_c, q.opt_d,
                  q.correct_ans, q.explanation, q.trick, q.q_number, q.section
           FROM responses r
           JOIN questions q ON q.id = r.question_id
           WHERE r.attempt_id=?
           ORDER BY q.q_number""",
        (attempt_id,)
    ).fetchall()
    conn.close()
    return rows


def get_user_stats(user_id: int):
    """Per-paper stats for a user: attempts count, best score, last status."""
    conn = get_conn()
    rows = conn.execute(
        """SELECT paper_id,
                  COUNT(*) as attempts,
                  MAX(score) as best_score,
                  MAX(total_q) as total_q,
                  MAX(CASE WHEN status='completed' THEN 1 ELSE 0 END) as ever_completed
           FROM attempts
           WHERE user_id=?
           GROUP BY paper_id""",
        (user_id,)
    ).fetchall()
    conn.close()
    return {r["paper_id"]: dict(r) for r in rows}

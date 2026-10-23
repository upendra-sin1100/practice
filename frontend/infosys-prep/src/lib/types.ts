// src/lib/types.ts

export interface Question {
  id: number;
  paperId: number;
  qNumber: number;
  section: string;
  question: string;
  optA: string;
  optB: string;
  optC: string;
  optD: string;
  correctAns: string;  // 'A' | 'B' | 'C' | 'D' | ''
  explanation: string;
  trick: string;
}

export interface Paper {
  id: number;
  name: string;
  filename: string;
  totalQ: number;
  questions: Question[];
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface DBUser {
  id: string;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface CurrentUser {
  id: string;
  username: string;
  isAdmin: boolean;
}

// ── Attempts ─────────────────────────────────────────────────────────────────

export type AnswerMap = Record<number, string | null>;
// questionId (qNumber) → 'A'|'B'|'C'|'D'|null(=skipped)

export interface Attempt {
  id: string;
  userId: string;
  paperId: number;
  paperName: string;
  startedAt: string;       // ISO
  finishedAt?: string;     // ISO
  score: number;           // correct answers
  totalQ: number;
  status: 'in_progress' | 'completed';
  answers: AnswerMap;
}

// ── Admin edits ───────────────────────────────────────────────────────────────

export type QuestionEdit = Partial<
  Pick<Question, 'question' | 'optA' | 'optB' | 'optC' | 'optD' | 'correctAns' | 'explanation' | 'trick'>
>;
export type EditStore = Record<string, QuestionEdit>; // key = `${paperId}_${qNumber}`

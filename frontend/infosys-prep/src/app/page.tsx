"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import papers from "../data/papers.json";
import type { Paper, Question } from "../lib/types";
import { supabase } from "../lib/supabase";

const paperData = papers as Paper[];
const EXAM_SECONDS = 60 * 60;
type Tab = "exam" | "results" | "history";
type SavedAttempt = { id: string; paper_id: number; paper_name: string; score: number; total_questions: number; correct_count: number; wrong_count: number; skipped_count: number; created_at: string; };

export default function Home() {
    const [selectedPaperId, setSelectedPaperId] = useState(paperData[0]?.id ?? 1);
    const [activeTab, setActiveTab] = useState<Tab>("exam");
    const [questionIndex, setQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<number, string>>({});
    const [submitted, setSubmitted] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState(EXAM_SECONDS);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [authMessage, setAuthMessage] = useState("");
    const [saveMessage, setSaveMessage] = useState("");
    const [copied, setCopied] = useState(false);
    const [attempts, setAttempts] = useState<SavedAttempt[]>([]);

    const selectedPaper = paperData.find((paper) => paper.id === selectedPaperId) ?? paperData[0];
    const currentQuestion = selectedPaper?.questions[questionIndex];
    const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;
    const paperAttempts = attempts.filter((attempt) => attempt.paper_id === selectedPaperId);
    const attemptsLeft = Math.max(0, 3 - paperAttempts.length);
    const summary = useMemo(() => {
        const allQuestions = selectedPaper?.questions ?? [];
        const answered = allQuestions.filter((question) => answers[question.id]);
        const correct = answered.filter((question) => answers[question.id] === question.correctAns);
        return { total: allQuestions.length, answered: answered.length, correct: correct.length, wrong: answered.length - correct.length, skipped: allQuestions.length - answered.length };
    }, [answers, selectedPaper]);

    useEffect(() => {
        if (!supabase) return;
        supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUserEmail(session?.user?.email ?? null));
        return () => listener.subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!supabase || !userEmail) {
            setAttempts([]);
            return;
        }
        supabase.from("attempts").select("id,paper_id,paper_name,score,total_questions,correct_count,wrong_count,skipped_count,created_at").order("created_at", { ascending: false }).then(({ data }) => setAttempts((data as SavedAttempt[]) ?? []));
    }, [userEmail, submitted]);

    useEffect(() => {
        if (submitted || activeTab !== "exam" || attemptsLeft === 0) return;
        const timer = window.setInterval(() => setSecondsLeft((current) => {
            if (current <= 1) {
                window.clearInterval(timer);
                setSubmitted(true);
                setActiveTab("results");
                return 0;
            }
            return current - 1;
        }), 1000);
        return () => window.clearInterval(timer);
    }, [activeTab, attemptsLeft, submitted]);

    const timeLabel = `${String(Math.floor(secondsLeft / 3600)).padStart(2, "0")}:${String(Math.floor((secondsLeft % 3600) / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

    function changePaper(paperId: number) {
        setSelectedPaperId(paperId);
        setQuestionIndex(0);
        setAnswers({});
        setSubmitted(false);
        setSecondsLeft(EXAM_SECONDS);
        setSaveMessage("");
        setActiveTab("exam");
    }

    function startNewAttempt() {
        if (attemptsLeft === 0) return;
        setAnswers({});
        setQuestionIndex(0);
        setSubmitted(false);
        setSecondsLeft(EXAM_SECONDS);
        setSaveMessage("");
        setActiveTab("exam");
    }

    function submitPaper() {
        setSubmitted(true);
        setActiveTab("results");
        setSaveMessage("");
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    async function handleAuth() {
        if (!supabase) return setAuthMessage("Supabase environment variables are missing.");
        const result = authMode === "sign-in" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
        setAuthMessage(result.error ? result.error.message : authMode === "sign-up" ? "Account created. Check your email if confirmation is enabled." : "Signed in.");
    }

    async function signOut() {
        await supabase?.auth.signOut();
        setUserEmail(null);
        setAttempts([]);
    }

    async function saveAttempt() {
        if (!supabase || !selectedPaper) return setSaveMessage("Supabase is not configured.");
        if (!userEmail) return setSaveMessage("Sign in above before saving this attempt.");
        if (paperAttempts.length >= 3) return setSaveMessage("You have used all 3 attempts for this paper.");
        const { data } = await supabase.auth.getUser();
        if (!data.user) return setSaveMessage("Sign in above before saving this attempt.");
        const { error } = await supabase.from("attempts").insert({ user_id: data.user.id, paper_id: selectedPaper.id, paper_name: selectedPaper.name, score: summary.correct, total_questions: summary.total, correct_count: summary.correct, wrong_count: summary.wrong, skipped_count: summary.skipped, answers });
        setSaveMessage(error ? error.message : "Attempt saved. You have been credited with one attempt.");
    }

    async function copyResults() {
        if (!selectedPaper) return;
        const text = [`${selectedPaper.name} - Infosys SE Prep`, `Score: ${summary.correct}/${summary.total} | Correct: ${summary.correct} | Wrong: ${summary.wrong} | Skipped: ${summary.skipped}`, "", ...selectedPaper.questions.map((question) => `Q${question.qNumber} [${!answers[question.id] ? "SKIPPED" : answers[question.id] === question.correctAns ? "CORRECT" : "WRONG"}] Your answer: ${answers[question.id] || "-"} | Correct answer: ${question.correctAns || "-"}\nExplanation: ${question.explanation || "Not available"}\nTrick: ${question.trick || "Not available"}`)].join("\n");
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
    }

    async function toggleFullscreen() {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen?.();
            setIsFullscreen(true);
        } else {
            await document.exitFullscreen?.();
            setIsFullscreen(false);
        }
    }

    return <main className={styles.shell}>
        <header className={styles.header}><div className={styles.brand}><span className={styles.brandMark}>IS</span><div><p className={styles.kicker}>CANDIDATE CONSOLE / 2026</p><h1>Infosys SE Prep</h1></div></div><div className={styles.headerRight}><div className={`${styles.timer} ${secondsLeft < 300 ? styles.timerUrgent : ""}`}><span>TIME LEFT</span><strong>{timeLabel}</strong></div>{userEmail ? <div className={styles.account}><span>{userEmail}</span><button onClick={signOut}>Sign out</button></div> : <div className={styles.auth}><input type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} /><input type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} /><button onClick={handleAuth}>{authMode === "sign-in" ? "Sign in" : "Create account"}</button><button className={styles.authSwitch} onClick={() => setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in")}>{authMode === "sign-in" ? "Create account" : "Back to sign in"}</button>{authMessage && <small>{authMessage}</small>}</div>}</div></header>
        <section className={styles.examLayout}>
            <aside className={styles.sidebar} aria-label="Question papers"><div className={styles.sidebarHeading}><p className={styles.label}>PAPERS</p><span>{paperData.length} sets</span></div>{paperData.map((paper) => <button key={paper.id} className={`${styles.paperButton} ${paper.id === selectedPaper?.id ? styles.active : ""}`} onClick={() => changePaper(paper.id)}><span>0{paper.id}</span><strong>{paper.name}</strong><small>{paper.totalQ} questions</small></button>)}</aside>
            <section className={styles.examMain}>{selectedPaper && <><nav className={styles.tabs} aria-label="Exam navigation"><button className={activeTab === "exam" ? styles.tabActive : ""} onClick={() => setActiveTab("exam")}>Exam room</button><button className={activeTab === "results" ? styles.tabActive : ""} onClick={() => submitted && setActiveTab("results")} disabled={!submitted}>Results</button><button className={activeTab === "history" ? styles.tabActive : ""} onClick={() => setActiveTab("history")}>My attempts <span>{paperAttempts.length}/3</span></button><button className={styles.fullscreenButton} onClick={toggleFullscreen}>{isFullscreen ? "Exit full screen" : "Full screen"}</button></nav>
                {activeTab === "exam" && <ExamRoom paper={selectedPaper} question={currentQuestion} questionIndex={questionIndex} answers={answers} submitted={submitted} attemptsLeft={attemptsLeft} onAnswer={(answer) => currentQuestion && setAnswers((current) => ({ ...current, [currentQuestion.id]: answer }))} onJump={setQuestionIndex} onSubmit={submitPaper} />}
                {activeTab === "results" && <Results paper={selectedPaper} answers={answers} summary={summary} copied={copied} saveMessage={saveMessage} onCopy={copyResults} onSave={saveAttempt} onRetry={startNewAttempt} attemptsLeft={attemptsLeft} />}
                {activeTab === "history" && <History attempts={attempts} selectedPaperId={selectedPaper.id} attemptsLeft={attemptsLeft} />}
            </>}</section>
        </section>
    </main>;
}

function ExamRoom({ paper, question, questionIndex, answers, submitted, attemptsLeft, onAnswer, onJump, onSubmit }: { paper: Paper; question?: Question; questionIndex: number; answers: Record<number, string>; submitted: boolean; attemptsLeft: number; onAnswer: (answer: string) => void; onJump: (index: number) => void; onSubmit: () => void }) {
    const sectionNames = [...new Set(paper.questions.map((item) => item.section).filter(Boolean))];
    const options = question ? [["A", question.optA], ["B", question.optB], ["C", question.optC], ["D", question.optD]] : [];
    return <div className={styles.room}><div className={styles.roomTop}><div><p className={styles.kicker}>LIVE ASSESSMENT</p><h2>{paper.name}</h2><p>Attempt {4 - attemptsLeft} of 3 · {paper.totalQ} questions · 60 minutes</p></div><div className={styles.attemptBadge}>{attemptsLeft} attempts left</div></div><div className={styles.progressTrack}><span style={{ width: `${((questionIndex + 1) / paper.questions.length) * 100}%` }} /></div><div className={styles.examGrid}><aside className={styles.navigator}><p className={styles.label}>QUESTION MAP</p><div className={styles.legend}><span className={styles.legendCurrent}>Current</span><span className={styles.legendDone}>Answered</span><span>Open</span></div><div className={styles.numberGrid}>{paper.questions.map((item, index) => <button key={item.id} className={`${index === questionIndex ? styles.numberCurrent : ""} ${answers[item.id] ? styles.numberDone : ""}`} onClick={() => onJump(index)}>{item.qNumber}</button>)}</div></aside><article className={styles.questionStage}>{question && <><div className={styles.questionEyebrow}><span>QUESTION {String(questionIndex + 1).padStart(2, "0")} / {paper.totalQ}</span><span>{question.section || "General"}</span></div><h3>{question.question}</h3><div className={styles.answerGrid}>{options.map(([letter, text]) => text && <button type="button" key={letter} disabled={submitted || attemptsLeft === 0} onClick={() => onAnswer(letter)} className={`${styles.examOption} ${answers[question.id] === letter ? styles.examSelected : ""}`}><b>{letter}</b><span>{text}</span></button>)}</div><div className={styles.questionActions}><button onClick={() => onJump(Math.max(0, questionIndex - 1))} disabled={questionIndex === 0}>← Previous</button><button className={styles.nextButton} onClick={() => onJump(Math.min(paper.questions.length - 1, questionIndex + 1))}>{questionIndex === paper.questions.length - 1 ? "Review last question" : "Next question →"}</button></div></>}</article></div><div className={styles.roomFooter}><span>{Object.keys(answers).length} of {paper.totalQ} answered</span><button className={styles.submitButton} onClick={onSubmit} disabled={submitted || attemptsLeft === 0}>{attemptsLeft === 0 ? "No attempts remaining" : submitted ? "Submitted" : "Submit exam"}</button></div></div>;
}

function Results({ paper, answers, summary, copied, saveMessage, onCopy, onSave, onRetry, attemptsLeft }: { paper: Paper; answers: Record<number, string>; summary: { total: number; answered: number; correct: number; wrong: number; skipped: number }; copied: boolean; saveMessage: string; onCopy: () => void; onSave: () => void; onRetry: () => void; attemptsLeft: number }) {
    return <section className={styles.resultView}><div className={styles.resultHero}><div><p className={styles.kicker}>ASSESSMENT REPORT</p><h2>{summary.correct} <span>/ {summary.total}</span></h2><p>{paper.name} · completed review</p></div><div className={styles.scoreRing}><strong>{Math.round((summary.correct / Math.max(1, summary.total)) * 100)}%</strong><span>score</span></div></div><div className={styles.scoreCards}><div><strong>{summary.correct}</strong><span>Correct</span></div><div><strong>{summary.wrong}</strong><span>Wrong</span></div><div><strong>{summary.skipped}</strong><span>Skipped</span></div><div><strong>{attemptsLeft}</strong><span>Attempts left</span></div></div><div className={styles.resultActions}><button className={styles.primaryButton} onClick={onSave}>Save attempt</button><button className={styles.secondaryButton} onClick={onCopy}>{copied ? "Copied" : "Copy whole result"}</button><button className={styles.secondaryButton} onClick={onRetry} disabled={attemptsLeft === 0}>Try again</button></div>{saveMessage && <p className={styles.saveMessage}>{saveMessage}</p>}<div className={styles.reviewList}>{paper.questions.map((question) => { const answer = answers[question.id]; const status = !answer ? "skipped" : answer === question.correctAns ? "correct" : "wrong"; return <article key={question.id} className={styles.reviewCard}><div className={styles.questionEyebrow}><span>Q{question.qNumber} · {status}</span><span>Your answer: {answer || "-"} · Key: {question.correctAns || "-"}</span></div><h3>{question.question}</h3><p>{question.explanation || "Explanation not available."}</p><small><b>Short trick:</b> {question.trick || "Not available."}</small></article>; })}</div></section>;
}

function History({ attempts, selectedPaperId, attemptsLeft }: { attempts: SavedAttempt[]; selectedPaperId: number; attemptsLeft: number }) {
    const paperAttempts = attempts.filter((attempt) => attempt.paper_id === selectedPaperId);
    return <section className={styles.historyView}><p className={styles.kicker}>PERSONAL PROGRESS</p><h2>My attempts</h2><p className={styles.historyIntro}>Three shots per paper. Your saved results stay tied to your account.</p><div className={styles.attemptMeter}><span style={{ width: `${((3 - attemptsLeft) / 3) * 100}%` }} /></div><p className={styles.meterLabel}>{3 - attemptsLeft} of 3 attempts used for this paper</p>{paperAttempts.length ? paperAttempts.map((attempt, index) => <article className={styles.historyCard} key={attempt.id}><span className={styles.historyIndex}>0{index + 1}</span><div><strong>{attempt.paper_name}</strong><small>{new Date(attempt.created_at).toLocaleString()}</small></div><b>{attempt.score}/{attempt.total_questions}</b></article>) : <div className={styles.empty}>No saved attempts for this paper yet.</div>}</section>;
}

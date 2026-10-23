"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import papers from "../data/papers.json";
import type { Paper, Question } from "../lib/types";
import { supabase } from "../lib/supabase";

const paperData = papers as Paper[];
const EXAM_SECONDS = 60 * 60;
type Tab = "papers" | "practice" | "history" | "results";
type Mode = "paper" | "section" | "shuffle";
type SavedAttempt = { id: string; paper_id: number; paper_name: string; score: number; total_questions: number; correct_count: number; wrong_count: number; skipped_count: number; penalty_count?: number; created_at: string; };

const sectionNames = [...new Set(paperData.flatMap((paper) => paper.questions.map((question) => question.section)).filter(Boolean))];
const sectionStats = sectionNames.map((name) => ({ name, count: paperData.reduce((total, paper) => total + paper.questions.filter((question) => question.section === name).length, 0) }));

export default function Home() {
    const [tab, setTab] = useState<Tab>("papers");
    const [mode, setMode] = useState<Mode>("paper");
    const [selectedPaperId, setSelectedPaperId] = useState(paperData[0]?.id ?? 1);
    const [selectedSection, setSelectedSection] = useState(sectionNames[0] ?? "");
    const [activeQuestions, setActiveQuestions] = useState<Question[]>([]);
    const [activeTitle, setActiveTitle] = useState("");
    const [activePaperId, setActivePaperId] = useState(0);
    const [questionIndex, setQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<number, string>>({});
    const [submitted, setSubmitted] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState(EXAM_SECONDS);
    const [examStarted, setExamStarted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [penalties, setPenalties] = useState(0);
    const [reentryRequired, setReentryRequired] = useState(false);
    const [reentrySeconds, setReentrySeconds] = useState(30);
    const violationActive = useRef(false);
    const [darkMode, setDarkMode] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [authMessage, setAuthMessage] = useState("");
    const [saveMessage, setSaveMessage] = useState("");
    const [copied, setCopied] = useState(false);
    const [attempts, setAttempts] = useState<SavedAttempt[]>([]);

    const selectedPaper = paperData.find((paper) => paper.id === selectedPaperId) ?? paperData[0];
    const currentQuestion = activeQuestions[questionIndex];
    const paperAttempts = attempts.filter((attempt) => attempt.paper_id === selectedPaperId);
    const attemptsLeft = Math.max(0, 3 - paperAttempts.length);
    const summary = useMemo(() => {
        const answered = activeQuestions.filter((question) => answers[question.id]);
        const correct = answered.filter((question) => answers[question.id] === question.correctAns);
        return { total: activeQuestions.length, answered: answered.length, correct: correct.length, wrong: answered.length - correct.length, skipped: activeQuestions.length - answered.length, finalScore: Math.max(0, correct.length - penalties) };
    }, [activeQuestions, answers, penalties]);

    useEffect(() => {
        if (!supabase) return;
        supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUserEmail(session?.user?.email ?? null));
        return () => listener.subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!supabase || !userEmail) { setAttempts([]); return; }
        supabase.from("attempts").select("id,paper_id,paper_name,score,total_questions,correct_count,wrong_count,skipped_count,penalty_count,created_at").order("created_at", { ascending: false }).then(({ data }) => setAttempts((data as SavedAttempt[]) ?? []));
    }, [userEmail, submitted]);

    useEffect(() => {
        if (!examStarted || submitted) return;
        const timer = window.setInterval(() => setSecondsLeft((current) => {
            if (current <= 1) { window.clearInterval(timer); submitExam(); return 0; }
            return current - 1;
        }), 1000);
        return () => window.clearInterval(timer);
    }, [examStarted, submitted]);

    useEffect(() => {
        function onFullscreenChange() {
            const fullscreen = Boolean(document.fullscreenElement);
            setIsFullscreen(fullscreen);
            if (examStarted && !submitted && !fullscreen) registerViolation();
            if (fullscreen && violationActive.current) {
                violationActive.current = false;
                setReentryRequired(false);
                setReentrySeconds(30);
            }
        }
        function onVisibilityChange() { if (examStarted && !submitted && document.visibilityState === "hidden") registerViolation(); }
        function onWindowBlur() { if (examStarted && !submitted) registerViolation(); }
        document.addEventListener("fullscreenchange", onFullscreenChange);
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("blur", onWindowBlur);
        return () => { document.removeEventListener("fullscreenchange", onFullscreenChange); document.removeEventListener("visibilitychange", onVisibilityChange); window.removeEventListener("blur", onWindowBlur); };
    }, [examStarted, submitted]);

    useEffect(() => {
        if (!reentryRequired || submitted) return;
        const timer = window.setInterval(() => setReentrySeconds((current) => {
            if (current <= 1) {
                window.clearInterval(timer);
                setPenalties((value) => value + 1);
                submitExam();
                return 0;
            }
            return current - 1;
        }), 1000);
        return () => window.clearInterval(timer);
    }, [reentryRequired, submitted]);

    const timeLabel = `${String(Math.floor(secondsLeft / 3600)).padStart(2, "0")}:${String(Math.floor((secondsLeft % 3600) / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

    function questionsForSection(section: string) { return paperData.flatMap((paper) => paper.questions.filter((question) => question.section === section)); }
    function shuffled(items: Question[]) { return [...items].sort(() => Math.random() - 0.5); }
    function registerViolation() {
        if (violationActive.current || !examStarted || submitted) return;
        violationActive.current = true;
        setPenalties((current) => current + 1);
        setReentrySeconds(30);
        setReentryRequired(true);
    }

    async function beginExam(nextMode: Mode, paper?: Paper) {
        const questions = nextMode === "paper" ? (paper?.questions ?? []) : nextMode === "section" ? questionsForSection(selectedSection) : shuffled(paperData.flatMap((item) => item.questions));
        if (!questions.length || (nextMode === "paper" && attemptsLeft === 0)) return;
        setMode(nextMode);
        setActiveQuestions(nextMode === "shuffle" ? questions.slice(0, 60) : questions);
        setActiveTitle(nextMode === "paper" ? paper?.name ?? "Paper" : nextMode === "section" ? selectedSection : "Shuffle challenge");
        setActivePaperId(nextMode === "paper" ? paper?.id ?? 0 : 0);
        setAnswers({}); setQuestionIndex(0); setSubmitted(false); setPenalties(0); setReentryRequired(false); setReentrySeconds(30); violationActive.current = false; setSecondsLeft(EXAM_SECONDS); setSaveMessage(""); setTab("practice"); setExamStarted(true);
        try { await document.documentElement.requestFullscreen?.(); } catch { setSaveMessage("Fullscreen was blocked by the browser. You can continue, but leaving the exam will count as a penalty."); }
    }

    function submitExam() { setSubmitted(true); setExamStarted(false); setTab("results"); if (document.fullscreenElement) document.exitFullscreen?.(); }
    function exitExamWithPenalty() { registerViolation(); }
    async function returnToFullscreen() { try { await document.documentElement.requestFullscreen?.(); } catch { setSaveMessage("Use the browser permission prompt to return to fullscreen."); } }
    function resetToDashboard() { setExamStarted(false); setSubmitted(false); setActiveQuestions([]); setAnswers({}); setTab("papers"); if (document.fullscreenElement) document.exitFullscreen?.(); }

    async function handleAuth() {
        if (!supabase) return setAuthMessage("Supabase environment variables are missing.");
        const result = authMode === "sign-in" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
        setAuthMessage(result.error ? result.error.message : authMode === "sign-up" ? "Account created. Check your email if confirmation is enabled." : "Signed in.");
    }
    async function signOut() { await supabase?.auth.signOut(); setUserEmail(null); setAttempts([]); }
    async function saveAttempt() {
        if (!supabase || !activeQuestions.length) return setSaveMessage("Supabase is not configured.");
        if (!userEmail) return setSaveMessage("Sign in above before saving this attempt.");
        if (activePaperId && paperAttempts.length >= 3) return setSaveMessage("You have used all 3 attempts for this paper.");
        const { data } = await supabase.auth.getUser();
        if (!data.user) return setSaveMessage("Sign in above before saving this attempt.");
        const { error } = await supabase.from("attempts").insert({ user_id: data.user.id, paper_id: activePaperId, paper_name: activeTitle, score: summary.finalScore, total_questions: summary.total, correct_count: summary.correct, wrong_count: summary.wrong, skipped_count: summary.skipped, penalty_count: penalties, answers });
        setSaveMessage(error ? error.message : "Attempt saved to your account.");
    }
    async function copyResults() {
        const text = [`${activeTitle} - Infosys SE Prep`, `Score: ${summary.finalScore}/${summary.total} | Penalties: ${penalties}`, "", ...activeQuestions.map((question) => `Q${question.qNumber}: ${question.question}\nYour answer: ${answers[question.id] || "Skipped"}`)].join("\n\n");
        await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1800);
    }

    if (examStarted) return <main className={`${styles.shell} ${darkMode ? styles.dark : ""}`}><ExamShell title={activeTitle} questions={activeQuestions} currentQuestion={currentQuestion} questionIndex={questionIndex} answers={answers} penalties={penalties} reentryRequired={reentryRequired} reentrySeconds={reentrySeconds} onAnswer={(answer) => currentQuestion && setAnswers((current) => ({ ...current, [currentQuestion.id]: answer }))} onJump={setQuestionIndex} onSubmit={submitExam} onExit={exitExamWithPenalty} onReturnFullscreen={returnToFullscreen} /></main>;

    return <main className={`${styles.shell} ${darkMode ? styles.dark : ""}`}>
        <header className={styles.header}><div className={styles.brand}><span className={styles.brandMark}>IS</span><div><p className={styles.kicker}>CANDIDATE CONSOLE / 2026</p><h1>Infosys SE Prep</h1></div></div><div className={styles.headerRight}><button className={styles.themeButton} onClick={() => setDarkMode((value) => !value)}>{darkMode ? "Light mode" : "Dark mode"}</button>{examStarted && <div className={`${styles.timer} ${secondsLeft < 300 ? styles.timerUrgent : ""}`}><span>TIME LEFT</span><strong>{timeLabel}</strong></div>}{userEmail ? <div className={styles.account}><span>{userEmail}</span><button onClick={signOut}>Sign out</button></div> : <div className={styles.auth}><input type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} /><input type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} /><button onClick={handleAuth}>{authMode === "sign-in" ? "Sign in" : "Create account"}</button><button className={styles.authSwitch} onClick={() => setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in")}>{authMode === "sign-in" ? "Create account" : "Back to sign in"}</button>{authMessage && <small>{authMessage}</small>}</div>}</div></header>
        <section className={styles.dashboard}><nav className={styles.tabs}><button className={tab === "papers" ? styles.tabActive : ""} onClick={() => setTab("papers")}>Exam papers</button><button className={tab === "practice" ? styles.tabActive : ""} onClick={() => setTab("practice")}>Practice sets</button><button className={tab === "history" ? styles.tabActive : ""} onClick={() => setTab("history")}>My attempts</button></nav>{tab === "papers" && <PaperDashboard papers={paperData} attempts={attempts} onStart={(paper) => beginExam("paper", paper)} />}{tab === "practice" && <PracticeDashboard onStart={(nextMode, section) => { if (section) setSelectedSection(section); beginExam(nextMode); }} />}{tab === "history" && <History attempts={attempts} />}{tab === "results" && <Results questions={activeQuestions} title={activeTitle} answers={answers} summary={summary} penalties={penalties} copied={copied} saveMessage={saveMessage} onCopy={copyResults} onSave={saveAttempt} onBack={resetToDashboard} />}</section>
    </main>;
}

function PaperDashboard({ papers, attempts, onStart }: { papers: Paper[]; attempts: SavedAttempt[]; onStart: (paper: Paper) => void }) { return <section className={styles.dashboardInner}><div className={styles.dashboardIntro}><div><p className={styles.kicker}>FULL LENGTH ASSESSMENTS</p><h2>Choose your exam paper</h2><p>Start only when you are ready. Each paper has three saved attempts and a timed exam room.</p></div><span className={styles.dashboardCount}>{papers.length} papers</span></div><div className={styles.paperGrid}>{papers.map((paper, index) => { const used = attempts.filter((attempt) => attempt.paper_id === paper.id).length; return <article className={styles.paperCard} key={paper.id}><div className={styles.cardTop}><span className={styles.cardNumber}>0{index + 1}</span><span>{used}/3 attempts</span></div><h3>{paper.name}</h3><p>{paper.totalQ} questions · 60 minutes</p><div className={styles.cardFooter}><span>{used === 3 ? "Completed" : `${3 - used} attempts available`}</span><button onClick={() => onStart(paper)} disabled={used >= 3}>{used >= 3 ? "Limit reached" : "Start exam →"}</button></div></article>; })}</div></section>; }

function PracticeDashboard({ onStart }: { onStart: (mode: Mode, section?: string) => void }) { return <section className={styles.dashboardInner}><div className={styles.dashboardIntro}><div><p className={styles.kicker}>TARGETED PRACTICE / ALL 7 PAPERS</p><h2>Train by problem type</h2><p>Each section card combines every matching question from all seven papers into one timed practice set.</p></div><span className={styles.dashboardCount}>{sectionStats.reduce((total, section) => total + section.count, 0)} questions indexed</span></div><div className={styles.practiceGrid}>{sectionStats.map((section, index) => <article className={styles.practiceCard} key={section.name}><div className={styles.practiceCardTop}><span className={styles.practiceIcon}>{String(index + 1).padStart(2, "0")}</span><span>{section.count} questions</span></div><p className={styles.kicker}>ALL PAPERS COMBINED</p><h3>{section.name.replace(/^SECTION \d+: /, "")}</h3><p>{section.count} matching questions collected from all seven papers. Same timer, navigator, fullscreen rules, and result report.</p><button onClick={() => onStart("section", section.name)}>Start this set →</button></article>)}<article className={`${styles.practiceCard} ${styles.shuffleCard}`}><div className={styles.practiceCardTop}><span className={styles.practiceIcon}>⤨</span><span>60 questions max</span></div><p className={styles.kicker}>RANDOMIZER</p><h3>Shuffle challenge</h3><p>A fresh mixed set sampled from every paper and section with the same timed exam rules.</p><button onClick={() => onStart("shuffle")}>Shuffle and start →</button></article></div></section>; }

function ExamShell({ title, questions, currentQuestion, questionIndex, answers, penalties, reentryRequired, reentrySeconds, onAnswer, onJump, onSubmit, onExit, onReturnFullscreen }: { title: string; questions: Question[]; currentQuestion?: Question; questionIndex: number; answers: Record<number, string>; penalties: number; reentryRequired: boolean; reentrySeconds: number; onAnswer: (answer: string) => void; onJump: (index: number) => void; onSubmit: () => void; onExit: () => void; onReturnFullscreen: () => void }) { const options = currentQuestion ? [["A", currentQuestion.optA], ["B", currentQuestion.optB], ["C", currentQuestion.optC], ["D", currentQuestion.optD]] : []; return <section className={styles.examScreen}><div className={styles.examBar}><div><p className={styles.kicker}>SECURE EXAM MODE</p><strong>{title}</strong></div><div className={styles.examBarActions}><span className={styles.penaltyNotice}>{penalties ? `${penalties} penalty${penalties === 1 ? "" : "ies"}` : "Fullscreen active"}</span><button onClick={onExit}>Leave fullscreen</button></div></div><div className={styles.examProgress}><span style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div><div className={styles.examBody}><aside className={styles.navigator}><p className={styles.label}>QUESTION MAP</p><div className={styles.numberGrid}>{questions.map((question, index) => <button key={question.id} className={`${index === questionIndex ? styles.numberCurrent : ""} ${answers[question.id] ? styles.numberDone : ""}`} onClick={() => onJump(index)}>{index + 1}</button>)}</div></aside><article className={styles.liveQuestion}><div className={styles.questionEyebrow}><span>QUESTION {String(questionIndex + 1).padStart(2, "0")} / {questions.length}</span><span>{currentQuestion?.section || "General"}</span></div><h2>{currentQuestion?.question}</h2><div className={styles.answerGrid}>{options.map(([letter, text]) => text && <button key={letter} className={`${styles.examOption} ${answers[currentQuestion?.id ?? 0] === letter ? styles.examSelected : ""}`} onClick={() => onAnswer(letter)}><b>{letter}</b><span>{text}</span></button>)}</div><div className={styles.questionActions}><button onClick={() => onJump(Math.max(0, questionIndex - 1))} disabled={questionIndex === 0}>← Previous</button><button className={styles.nextButton} onClick={() => onJump(Math.min(questions.length - 1, questionIndex + 1))}>{questionIndex === questions.length - 1 ? "Review" : "Next →"}</button></div></article></div><footer className={styles.examFooter}><span>{Object.keys(answers).length}/{questions.length} answered · {penalties} penalties</span><button className={styles.primaryButton} onClick={onSubmit}>Submit exam</button></footer>{reentryRequired && <div className={styles.violationOverlay}><div className={styles.violationCard}><p className={styles.kicker}>EXAM SECURITY ALERT</p><h2>Return to fullscreen</h2><p>You left fullscreen or changed tabs. This attempt has received one penalty. Return before the timer ends or the exam will submit automatically.</p><strong>{String(reentrySeconds).padStart(2, "0")}s</strong><button className={styles.primaryButton} onClick={onReturnFullscreen}>Return to fullscreen</button></div></div>}</section>; }

function Results({ questions, title, answers, summary, penalties, copied, saveMessage, onCopy, onSave, onBack }: { questions: Question[]; title: string; answers: Record<number, string>; summary: { total: number; answered: number; correct: number; wrong: number; skipped: number; finalScore: number }; penalties: number; copied: boolean; saveMessage: string; onCopy: () => void; onSave: () => void; onBack: () => void }) { return <section className={styles.resultView}><div className={styles.resultHero}><div><p className={styles.kicker}>ASSESSMENT REPORT</p><h2>{summary.finalScore} <span>/ {summary.total}</span></h2><p>{title} · {penalties} fullscreen penalties</p></div><div className={styles.scoreRing}><strong>{Math.round((summary.finalScore / Math.max(1, summary.total)) * 100)}%</strong><span>final score</span></div></div><div className={styles.scoreCards}><div><strong>{summary.correct}</strong><span>Correct</span></div><div><strong>{summary.wrong}</strong><span>Wrong</span></div><div><strong>{summary.skipped}</strong><span>Skipped</span></div><div><strong>{penalties}</strong><span>Penalties</span></div></div><div className={styles.resultActions}><button className={styles.primaryButton} onClick={onSave}>Save attempt</button><button className={styles.secondaryButton} onClick={onCopy}>{copied ? "Copied" : "Copy whole result"}</button><button className={styles.secondaryButton} onClick={onBack}>Back to dashboard</button></div>{saveMessage && <p className={styles.saveMessage}>{saveMessage}</p>}<div className={styles.reviewList}>{questions.map((question) => <article className={styles.reviewCard} key={question.id}><div className={styles.questionEyebrow}><span>Q{question.qNumber} · {!answers[question.id] ? "skipped" : answers[question.id] === question.correctAns ? "correct" : "wrong"}</span><span>Your answer: {answers[question.id] || "-"} · Key: {question.correctAns || "-"}</span></div><h3>{question.question}</h3><p>{question.explanation || "Explanation not available."}</p><small><b>Short trick:</b> {question.trick || "Not available."}</small></article>)}</div></section>; }

function History({ attempts }: { attempts: SavedAttempt[] }) { return <section className={styles.historyView}><p className={styles.kicker}>PERSONAL PROGRESS</p><h2>My attempts</h2><p className={styles.historyIntro}>Saved exam results and section practice sessions.</p>{attempts.length ? attempts.map((attempt) => <article className={styles.historyCard} key={attempt.id}><div><strong>{attempt.paper_name}</strong><small>{new Date(attempt.created_at).toLocaleString()}</small></div><b>{attempt.score}/{attempt.total_questions}</b><span>{attempt.penalty_count ?? 0} penalties</span></article>) : <div className={styles.empty}>Sign in and save an attempt to see your history.</div>}</section>; }

"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";
import papers from "../data/papers.json";
import type { Paper, Question } from "../lib/types";

const paperData = papers as Paper[];

export default function Home() {
    const [selectedPaperId, setSelectedPaperId] = useState(paperData[0]?.id ?? 1);
    const [section, setSection] = useState("All sections");
    const [query, setQuery] = useState("");
    const [answers, setAnswers] = useState<Record<number, string>>({});
    const [submitted, setSubmitted] = useState(false);
    const [copied, setCopied] = useState(false);
    const selectedPaper = paperData.find((paper) => paper.id === selectedPaperId) ?? paperData[0];
    const sections = useMemo(() => ["All sections", ...new Set(selectedPaper?.questions.map((question) => question.section).filter(Boolean))], [selectedPaper]);
    const questions = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        return (selectedPaper?.questions ?? []).filter((question) => {
            const matchesSection = section === "All sections" || question.section === section;
            const matchesQuery = !normalizedQuery || `${question.question} ${question.section}`.toLowerCase().includes(normalizedQuery);
            return matchesSection && matchesQuery;
        });
    }, [query, section, selectedPaper]);

    function changePaper(paperId: number) {
        setSelectedPaperId(paperId);
        setSection("All sections");
        setQuery("");
        setAnswers({});
        setSubmitted(false);
        setCopied(false);
    }

    const summary = useMemo(() => {
        const allQuestions = selectedPaper?.questions ?? [];
        const answered = allQuestions.filter((question) => answers[question.id]);
        const correct = answered.filter((question) => answers[question.id] === question.correctAns);
        return { total: allQuestions.length, answered: answered.length, correct: correct.length, wrong: answered.length - correct.length, skipped: allQuestions.length - answered.length };
    }, [answers, selectedPaper]);

    function submitPaper() {
        setSubmitted(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    async function copyResults() {
        if (!selectedPaper) return;
        const lines = [
            `${selectedPaper.name} - Infosys SE Prep`,
            `Score: ${summary.correct}/${summary.total} | Correct: ${summary.correct} | Wrong: ${summary.wrong} | Skipped: ${summary.skipped}`,
            "",
            ...selectedPaper.questions.map((question) => {
                const chosen = answers[question.id];
                const status = !chosen ? "SKIPPED" : chosen === question.correctAns ? "CORRECT" : "WRONG";
                return `Q${question.qNumber} [${status}] Your answer: ${chosen || "-"} | Correct answer: ${question.correctAns || "-"}\nExplanation: ${question.explanation || "Not available"}\nTrick: ${question.trick || "Not available"}`;
            }),
        ];
        await navigator.clipboard.writeText(lines.join("\n"));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
    }

    return <main className={styles.shell}>
        <header className={styles.header}><div><p className={styles.kicker}>FIELD NOTES / 07 MOCK PAPERS</p><h1>Infosys SE Prep</h1><p className={styles.subtitle}>A focused desk for solving, checking, and revisiting every question.</p></div><div className={styles.stat}><strong>{paperData.length}</strong><span>papers ready</span></div></header>
        <section className={styles.workspace}>
            <aside className={styles.sidebar} aria-label="Question papers"><p className={styles.label}>Question papers</p>{paperData.map((paper) => <button key={paper.id} className={`${styles.paperButton} ${paper.id === selectedPaper?.id ? styles.active : ""}`} onClick={() => changePaper(paper.id)}><span>0{paper.id}</span><strong>{paper.name}</strong><small>{paper.totalQ} questions</small></button>)}</aside>
            <section className={styles.content}>{selectedPaper && <><div className={styles.contentHeader}><div><p className={styles.kicker}>CURRENT PAPER</p><h2>{selectedPaper.name}</h2><p>{selectedPaper.totalQ} questions · {new Set(selectedPaper.questions.map((question) => question.section)).size} sections</p></div></div>{submitted && <section className={styles.results} aria-label="Test results"><div><p className={styles.kicker}>SUBMISSION COMPLETE</p><h3>{summary.correct} / {summary.total} correct</h3><p>{summary.answered} answered · {summary.skipped} skipped · {summary.wrong} wrong</p></div><div className={styles.resultActions}><button className={styles.copyButton} onClick={copyResults}>{copied ? "Copied" : "Copy whole result"}</button><button className={styles.resetButton} onClick={() => { setAnswers({}); setSubmitted(false); setCopied(false); }}>Try again</button></div></section>}<div className={styles.controls}><input aria-label="Search questions" placeholder="Search questions..." value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Filter by section" value={section} onChange={(event) => setSection(event.target.value)}>{sections.map((item) => <option key={item}>{item}</option>)}</select><span className={styles.resultCount}>{questions.length} shown</span></div><div className={styles.questionList}>{questions.map((question) => <QuestionCard key={question.id} question={question} submitted={submitted} selectedAnswer={answers[question.id]} onSelect={(answer) => setAnswers((current) => ({ ...current, [question.id]: answer }))} />)}{!questions.length && <div className={styles.empty}>No questions match this search.</div>}</div><button className={styles.submitButton} onClick={submitPaper} disabled={submitted}>{submitted ? "Paper submitted" : `Submit paper · ${summary.answered}/${summary.total} answered`}</button></>}</section>
        </section>
    </main>;
}

function QuestionCard({ question, submitted, selectedAnswer, onSelect }: { question: Question; submitted: boolean; selectedAnswer?: string; onSelect: (answer: string) => void }) {
    const options = [["A", question.optA], ["B", question.optB], ["C", question.optC], ["D", question.optD]];
    return <article className={styles.questionCard}><div className={styles.questionMeta}><span>Q{question.qNumber}</span><span>{question.section || "General"}</span></div><h3>{question.question}</h3><div className={styles.options}>{options.map(([letter, text]) => text && <button type="button" disabled={submitted} key={letter} onClick={() => onSelect(letter)} className={`${styles.option} ${selectedAnswer === letter ? styles.selected : ""} ${submitted && question.correctAns === letter ? styles.correct : ""} ${submitted && selectedAnswer === letter && selectedAnswer !== question.correctAns ? styles.wrong : ""}`}><b>{letter}</b><span>{text}</span></button>)}</div>{submitted && <div className={styles.answer}><strong>{!selectedAnswer ? "Skipped" : selectedAnswer === question.correctAns ? "Correct" : "Wrong"} · Correct answer: {question.correctAns || "Not available"}</strong>{question.explanation && <p>{question.explanation}</p>}<small><b>Short trick:</b> {question.trick || "Not available"}</small></div>}</article>;
}
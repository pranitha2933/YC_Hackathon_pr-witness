"use client";

import { useState } from "react";

type Review = {
  intent: string;
  actualChanges: { file: string; summary: string; relevance: string }[];
  scopeConcerns: { severity: string; finding: string }[];
  blastRadius: string[];
  missingProof: string[];
  contractChecks?: { requirement: string; status: "met" | "violated" | "unproven"; evidence: string }[];
  humanSignoff?: { required: boolean; reasons: string[]; approvals: string[]; evidence: string[] };
  verdict: { risk: string; recommendation: string; reason: string };
};

const demoTask = "Allow organization administrators to export their own invoices as a CSV file.";
const demoContract = "Only organization admins can export their own invoices. Do not weaken tenant isolation or modify shared authorization behavior.";
const demoDiff = `diff --git a/src/auth/authorize.ts b/src/auth/authorize.ts
@@
-if (user.organizationId !== invoice.organizationId) throw new Error("Forbidden");
+if (!user) throw new Error("Unauthorized");
diff --git a/src/routes/invoices.ts b/src/routes/invoices.ts
@@
+router.get("/invoices/export", requireAuth, exportInvoicesAsCsv);`;

export default function Home() {
  const [prUrl, setPrUrl] = useState("");
  const [task, setTask] = useState("");
  const [contract, setContract] = useState("");
  const [diff, setDiff] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingPr, setFetchingPr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [useDemo, setUseDemo] = useState(false);

  function clearDemo() { setUseDemo(false); }

  async function fetchPullRequest() {
    setFetchingPr(true); setError(""); setReview(null);
    try {
      const response = await fetch("/api/pr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prUrl }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setTask(result.task); setDiff(result.diff); setContract(""); clearDemo();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to fetch the pull request.");
    } finally { setFetchingPr(false); }
  }

  async function analyze() {
    setLoading(true); setError(""); setReview(null);
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, contract, diff, useDemo }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setReview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally { setLoading(false); }
  }

  function loadDemo() {
    setTask(demoTask); setContract(demoContract); setDiff(demoDiff); setUseDemo(true); setReview(null); setError("");
  }

  async function copyFixPrompt() {
    if (!review) return;
    const prompt = `Fix this pull request without expanding scope.\n\nTask:\n${task}\n\nReview contract:\n${contract || "Preserve existing behavior outside the requested task."}\n\nProblems found:\n${review.scopeConcerns.map((item) => `- ${item.finding}`).join("\n")}\n\nRequired evidence before merge:\n${(review.humanSignoff?.evidence ?? review.missingProof).map((item) => `- ${item}`).join("\n")}\n\nAdd regression tests and do not change unrelated behavior.`;
    await navigator.clipboard.writeText(prompt); setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  }

  return <main className="page"><div className="shell">
    <header className="hero">
      <div><span className="eyebrow">AI code verification</span><h1>PR Witness</h1><p className="subtitle">Context in. Human sign-off out. Decide what an AI-generated pull request needs before it can safely merge.</p></div>
      <div className="hero-stat"><span>Review principle</span><strong>Evidence over diffs</strong><p>Focus people on the irreversible decisions.</p></div>
    </header>

    <section className="panel context-panel">
      <div className="section-heading"><span className="step">01</span><div><h2>Ingest change context</h2><p>Start with a public GitHub PR, or paste the task and diff yourself.</p></div></div>
      <div className="url-row">
        <label>Public GitHub pull-request URL<input value={prUrl} onChange={(event) => setPrUrl(event.target.value)} placeholder="https://github.com/owner/repository/pull/123" /></label>
        <button className="secondary compact" disabled={!prUrl || fetchingPr} onClick={fetchPullRequest}>{fetchingPr ? "Fetching…" : "Fetch PR"}</button>
      </div>
      <p className="hint">Paste a public PR URL to ingest its title, description, and diff—or paste a diff below.</p>
      <div className="grid form-grid">
        <label>What was the coding agent asked to build?<textarea value={task} onChange={(event) => { setTask(event.target.value); clearDemo(); }} placeholder="Example: Allow organization admins to export invoices as CSV." /></label>
        <label>Paste pull-request diff<textarea className="diff" value={diff} onChange={(event) => { setDiff(event.target.value); clearDemo(); }} placeholder="Paste a GitHub PR diff here…" /></label>
      </div>
      <div className="contract-wrap"><div className="section-heading compact-heading"><span className="step">02</span><div><h2>Set the human boundary</h2><p>Turn team knowledge into an explicit review contract.</p></div></div><label className="contract-label">Review Contract <span>What must not change?</span><textarea className="contract" value={contract} onChange={(event) => { setContract(event.target.value); clearDemo(); }} placeholder="Example: Do not weaken tenant isolation or modify shared authorization behavior." /></label></div>
      <div className="actions"><button className="primary" disabled={loading || !task || !diff} onClick={analyze}>{loading ? "Verifying change…" : "Generate Merge Brief"}</button><button className="secondary" onClick={loadDemo}>Load risky demo PR</button><p className="hint">The demo works without an API key. Live reviews use your server-side key.</p></div>
      {error && <p className="error">{error}</p>}
    </section>

    {review && <section className="brief">
      <div className={`verdict ${review.verdict.risk}`}><div><span className="eyebrow">Merge recommendation · {review.verdict.risk} risk</span><h2>{review.verdict.recommendation}</h2><p>{review.verdict.reason}</p></div><div className="risk-orb" aria-hidden="true">{review.verdict.risk}</div></div>
      {review.humanSignoff?.required && <section className="signoff"><span className="eyebrow">Human sign-off required</span><h2>Do not merge until this evidence exists.</h2><div className="signoff-grid"><ListCard title="Why a human must decide" items={review.humanSignoff.reasons} /><ListCard title="Required approval" items={review.humanSignoff.approvals} /><ListCard title="Required evidence" items={review.humanSignoff.evidence} /></div><button className="primary" onClick={copyFixPrompt}>{copied ? "Fix prompt copied" : "Copy fix prompt for coding agent"}</button></section>}
      <div className="sections">
        <Card title="Claimed intent" wide><p>{review.intent}</p></Card>
        {review.contractChecks && <Card title="Review Contract" wide><ul>{review.contractChecks.map((item, index) => <li key={index}><span className={`tag ${item.status}`}>{item.status}</span><strong>{item.requirement}</strong><br />{item.evidence}</li>)}</ul></Card>}
        <Card title="What actually changed"><ul>{review.actualChanges.map((item, index) => <li key={index}><span className="file">{item.file}</span>{item.summary}<span className="tag">{item.relevance}</span></li>)}</ul></Card>
        <Card title="Scope concerns"><ul>{review.scopeConcerns.map((item, index) => <li key={index}><span className="tag">{item.severity}</span><br />{item.finding}</li>)}</ul></Card>
        <Card title="Blast radius"><List items={review.blastRadius} /></Card><Card title="Missing proof"><List items={review.missingProof} /></Card>
      </div>
    </section>}
  </div></main>;
}

function Card({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) { return <article className={`card ${wide ? "wide" : ""}`}><h3>{title}</h3>{children}</article>; }
function List({ items }: { items: string[] }) { return <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>; }
function ListCard({ title, items }: { title: string; items: string[] }) { return <div><h3>{title}</h3><List items={items} /></div>; }

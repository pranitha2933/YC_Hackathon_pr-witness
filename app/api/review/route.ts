import OpenAI from "openai";
import { NextResponse } from "next/server";

const reviewSchema = {
  type: "object", additionalProperties: false,
  properties: {
    intent: { type: "string" },
    actualChanges: { type: "array", items: { type: "object", additionalProperties: false, properties: { file: { type: "string" }, summary: { type: "string" }, relevance: { type: "string", enum: ["expected", "unexpected"] } }, required: ["file", "summary", "relevance"] } },
    scopeConcerns: { type: "array", items: { type: "object", additionalProperties: false, properties: { severity: { type: "string", enum: ["high", "medium", "low"] }, finding: { type: "string" } }, required: ["severity", "finding"] } },
    blastRadius: { type: "array", items: { type: "string" } },
    missingProof: { type: "array", items: { type: "string" } },
    contractChecks: { type: "array", items: { type: "object", additionalProperties: false, properties: { requirement: { type: "string" }, status: { type: "string", enum: ["met", "violated", "unproven"] }, evidence: { type: "string" } }, required: ["requirement", "status", "evidence"] } },
    humanSignoff: { type: "object", additionalProperties: false, properties: { required: { type: "boolean" }, reasons: { type: "array", items: { type: "string" } }, approvals: { type: "array", items: { type: "string" } }, evidence: { type: "array", items: { type: "string" } } }, required: ["required", "reasons", "approvals", "evidence"] },
    verdict: { type: "object", additionalProperties: false, properties: { risk: { type: "string", enum: ["low", "medium", "high"] }, recommendation: { type: "string", enum: ["MERGE", "REVIEW", "BLOCK"] }, reason: { type: "string" } }, required: ["risk", "recommendation", "reason"] },
  },
  required: ["intent", "actualChanges", "scopeConcerns", "blastRadius", "missingProof", "contractChecks", "humanSignoff", "verdict"],
} as const;

const demo = {
  intent: "Allow organization administrators to export their own invoices as a CSV file.",
  actualChanges: [{ file: "src/routes/invoices.ts", summary: "Adds an authenticated CSV export endpoint.", relevance: "expected" }, { file: "src/auth/authorize.ts", summary: "Replaces organization ownership verification with a simple logged-in check.", relevance: "unexpected" }],
  scopeConcerns: [{ severity: "high", finding: "A shared authorization primitive changed outside the export feature, removing the organization boundary for invoice access." }],
  blastRadius: ["Invoice download endpoint", "Invoice detail API", "Any consumer of the shared authorization helper"],
  missingProof: ["No regression test proves an administrator from Organization A cannot export Organization B's invoices."],
  contractChecks: [{ requirement: "Only organization admins can export their own invoices.", status: "unproven", evidence: "The changed authorization path no longer validates organization ownership." }, { requirement: "Do not weaken tenant isolation or modify shared authorization behavior.", status: "violated", evidence: "The shared helper changed from ownership validation to checking only that a user exists." }],
  humanSignoff: { required: true, reasons: ["A shared authorization primitive changed outside the requested export feature.", "The change could expose another organization's invoice data."], approvals: ["Security or technical-owner approval for authorization behavior."], evidence: ["A regression test showing cross-organization export is denied.", "Confirmation that existing invoice download and detail endpoints preserve tenant isolation."] },
  verdict: { risk: "high", recommendation: "BLOCK", reason: "The export feature is present, but the PR weakens shared tenant isolation without proof it remains safe." },
};

type Review = typeof demo;

/**
 * Some OpenAI-compatible providers occasionally omit optional-looking fields
 * even when a strict JSON schema is requested. Keep the UI contract stable:
 * accept the useful review and supply safe empty values for missing sections.
 */
function normalizeReview(value: unknown): Review {
  const review = (value && typeof value === "object" ? value : {}) as Partial<Review>;
  const signoff = (review.humanSignoff && typeof review.humanSignoff === "object"
    ? review.humanSignoff
    : {}) as Partial<Review["humanSignoff"]>;
  const verdict = (review.verdict && typeof review.verdict === "object"
    ? review.verdict
    : {}) as Partial<Review["verdict"]>;

  return {
    intent: typeof review.intent === "string" ? review.intent : "Review intent could not be determined from the supplied diff.",
    actualChanges: Array.isArray(review.actualChanges) ? review.actualChanges : [],
    scopeConcerns: Array.isArray(review.scopeConcerns) ? review.scopeConcerns : [],
    blastRadius: Array.isArray(review.blastRadius) ? review.blastRadius : [],
    missingProof: Array.isArray(review.missingProof) ? review.missingProof : [],
    contractChecks: Array.isArray(review.contractChecks) ? review.contractChecks : [],
    humanSignoff: {
      required: typeof signoff.required === "boolean" ? signoff.required : true,
      reasons: Array.isArray(signoff.reasons) ? signoff.reasons : ["The generated review was incomplete; a human must verify the change."],
      approvals: Array.isArray(signoff.approvals) ? signoff.approvals : [],
      evidence: Array.isArray(signoff.evidence) ? signoff.evidence : [],
    },
    verdict: {
      risk: verdict.risk === "low" || verdict.risk === "medium" || verdict.risk === "high" ? verdict.risk : "medium",
      recommendation: verdict.recommendation === "MERGE" || verdict.recommendation === "REVIEW" || verdict.recommendation === "BLOCK" ? verdict.recommendation : "REVIEW",
      reason: typeof verdict.reason === "string" ? verdict.reason : "The review needs human verification.",
    },
  };
}

function fallbackReview(task: string, contract: string, diff: string): Review {
  const files = [...new Set([...diff.matchAll(/^diff --git a\/(.+?) b\//gm)].map((match) => match[1]))];
  const sensitive = /auth|authoriz|permission|token|secret|credential|role|rbac|iam|security|deploy|production/i.test(`${task}\n${contract}\n${diff}`);
  const requirements = contract.split("\n").map((line) => line.trim()).filter(Boolean);
  const risk = sensitive ? "high" : "medium";

  return normalizeReview({
    intent: task,
    actualChanges: files.map((file) => ({ file, summary: "Changed file requires human verification because the model returned an incomplete response.", relevance: "expected" })),
    scopeConcerns: [{ severity: risk, finding: "The model did not return structured findings. This change must be reviewed against the contract by a human." }],
    blastRadius: files.length ? files : ["The supplied pull-request diff"],
    missingProof: ["The model response was incomplete, so no automated evidence can prove the contract is met."],
    contractChecks: requirements.map((requirement) => ({ requirement, status: "unproven", evidence: "No structured model evidence was returned; verify this requirement manually." })),
    humanSignoff: {
      required: true,
      reasons: ["The review model returned an incomplete response.", ...(sensitive ? ["This diff or contract touches a security, identity, or deployment boundary."] : [])],
      approvals: [sensitive ? "Security or technical-owner approval." : "Technical-owner approval."],
      evidence: ["Manual verification that every Review Contract requirement is met."],
    },
    verdict: {
      risk,
      recommendation: sensitive ? "BLOCK" : "REVIEW",
      reason: "Automated analysis was incomplete, so this PR cannot be approved without human evidence.",
    },
  });
}

function parseJsonReview(output: string, task: string, contract: string, diff: string): Review {
  const clean = output.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return fallbackReview(task, contract, diff);
  const json = clean.slice(start, end + 1);
  try {
    return normalizeReview(JSON.parse(json));
  } catch {
    return fallbackReview(task, contract, diff);
  }
}

export async function POST(request: Request) {
  let task = "";
  let contract = "";
  let diff = "";
  try {
    const payload = await request.json();
    task = typeof payload.task === "string" ? payload.task : "";
    contract = typeof payload.contract === "string" ? payload.contract : "";
    diff = typeof payload.diff === "string" ? payload.diff : "";
    const useDemo = Boolean(payload.useDemo);
    if (useDemo) return NextResponse.json(demo);
    if (!task || !diff) return NextResponse.json({ error: "Add both the task and a pull-request diff." }, { status: 400 });
    const useGroq = Boolean(process.env.GROQ_API_KEY);
    if (!useGroq && !process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Add GROQ_API_KEY (recommended) or OPENAI_API_KEY in Vercel → Settings → Environment Variables, then redeploy." }, { status: 400 });

    const client = new OpenAI({
      apiKey: useGroq ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY,
      ...(useGroq ? { baseURL: "https://api.groq.com/openai/v1" } : {}),
    });
    const prompt = `You are PR Witness, an independent code-change verification agent. Determine whether a pull request fulfills the requested behavior without unexpected changes or unproven risk. Avoid style feedback. Report only concrete findings grounded in the supplied diff. A Review Contract contains human-defined non-negotiables. Treat a contract violation or unproven dangerous contract requirement as a reason for human sign-off.

TASK:
${task}

REVIEW CONTRACT:
${contract || "No additional contract supplied. Preserve behavior outside the requested task."}

PULL REQUEST DIFF:
${diff}

Return one JSON object only. Include every field in this exact shape: intent, actualChanges, scopeConcerns, blastRadius, missingProof, contractChecks, humanSignoff, verdict. Use [] for no findings; do not omit any field.`;

    if (useGroq) {
      const response = await client.chat.completions.create({
        model: "openai/gpt-oss-20b",
        messages: [{ role: "system", content: prompt }],
        max_completion_tokens: 1600,
        // Do not use provider-enforced JSON here. On large diffs the Groq model
        // can fail generation before it returns a response. The prompt requests
        // JSON and parseJsonReview normalizes it safely below.
      });
      const output = response.choices[0]?.message?.content;
      if (!output) return NextResponse.json({ error: "Groq returned no review. Try again or use the built-in demo." }, { status: 502 });
      return NextResponse.json(parseJsonReview(output, task, contract, diff));
    }

    const response = await client.responses.create({
      model: "gpt-5.4",
      max_output_tokens: 1600,
      truncation: "auto",
      text: { format: { type: "json_schema", name: "pr_witness_review", strict: true, schema: reviewSchema } },
      input: prompt,
    });

    if (!response.output_text) return NextResponse.json({ error: "The model returned no review. Try a smaller pull request or use the built-in demo." }, { status: 502 });
    return NextResponse.json(parseJsonReview(response.output_text, task, contract, diff));
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (task && diff && /failed_generation|json/i.test(message)) {
      return NextResponse.json(fallbackReview(task, contract, diff));
    }
    return NextResponse.json({ error: `Review failed: ${message}` }, { status: 500 });
  }
}

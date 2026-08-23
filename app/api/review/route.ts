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

export async function POST(request: Request) {
  try {
    const { task, contract, diff, useDemo } = await request.json();
    if (useDemo) return NextResponse.json(demo);
    if (!task || !diff) return NextResponse.json({ error: "Add both the task and a pull-request diff." }, { status: 400 });
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY is missing. Add it in Vercel → Settings → Environment Variables, then redeploy." }, { status: 400 });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: "gpt-5.4",
      max_output_tokens: 1600,
      truncation: "auto",
      text: { format: { type: "json_schema", name: "pr_witness_review", strict: true, schema: reviewSchema } },
      input: `You are PR Witness, an independent code-change verification agent. Determine whether a pull request fulfills the requested behavior without unexpected changes or unproven risk. Avoid style feedback. Report only concrete findings grounded in the supplied diff. A Review Contract contains human-defined non-negotiables. Treat a contract violation or unproven dangerous contract requirement as a reason for human sign-off.

TASK:
${task}

REVIEW CONTRACT:
${contract || "No additional contract supplied. Preserve behavior outside the requested task."}

PULL REQUEST DIFF:
${diff}`,
    });

    if (!response.output_text) return NextResponse.json({ error: "The model returned no review. Try a smaller pull request or use the built-in demo." }, { status: 502 });
    return NextResponse.json(JSON.parse(response.output_text));
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Review failed: ${message}` }, { status: 500 });
  }
}

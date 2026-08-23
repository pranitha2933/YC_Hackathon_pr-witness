import OpenAI from "openai";
import { NextResponse } from "next/server";

const demo = {
  intent: "Allow organization administrators to export their own invoices as a CSV file.",
  actualChanges: [
    { file: "src/routes/invoices.ts", summary: "Adds an authenticated CSV export endpoint.", relevance: "expected" },
    { file: "src/auth/authorize.ts", summary: "Replaces organization ownership verification with a simple logged-in check.", relevance: "unexpected" },
  ],
  scopeConcerns: [{ severity: "high", finding: "A shared authorization primitive changed outside the export feature, removing the organization boundary for invoice access." }],
  blastRadius: ["Invoice download endpoint", "Invoice detail API", "Any consumer of the shared authorization helper"],
  missingProof: ["No regression test proves an administrator from Organization A cannot export Organization B's invoices."],
  contractChecks: [
    { requirement: "Only organization admins can export their own invoices.", status: "unproven", evidence: "The changed authorization path no longer validates organization ownership." },
    { requirement: "Do not weaken tenant isolation or modify shared authorization behavior.", status: "violated", evidence: "The shared helper changed from ownership validation to checking only that a user exists." },
  ],
  humanSignoff: {
    required: true,
    reasons: ["A shared authorization primitive changed outside the requested export feature.", "The change could expose another organization's invoice data."],
    approvals: ["Security or technical-owner approval for authorization behavior."],
    evidence: ["A regression test showing cross-organization export is denied.", "Confirmation that existing invoice download and detail endpoints preserve tenant isolation."],
  },
  verdict: { risk: "high", recommendation: "BLOCK", reason: "The export feature is present, but the PR weakens shared tenant isolation without proof it remains safe." },
};

export async function POST(request: Request) {
  try {
    const { task, contract, diff, useDemo } = await request.json();
    if (useDemo) return NextResponse.json(demo);
    if (!task || !diff) return NextResponse.json({ error: "Add both the task and a pull-request diff." }, { status: 400 });
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Add OPENAI_API_KEY to .env.local, then restart the server." }, { status: 400 });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: "gpt-5.4",
      input: `You are PR Witness, an independent code-change verification agent. Determine whether a pull request fulfills the requested behavior without unexpected changes or unproven risk. Avoid style feedback. Report only concrete findings grounded in the supplied diff. A Review Contract contains human-defined non-negotiables. Treat a contract violation or unproven dangerous contract requirement as a reason for human sign-off.

Return only valid JSON matching exactly:
{"intent":"string","actualChanges":[{"file":"string","summary":"string","relevance":"expected or unexpected"}],"scopeConcerns":[{"severity":"high, medium, or low","finding":"string"}],"blastRadius":["string"],"missingProof":["string"],"contractChecks":[{"requirement":"string","status":"met, violated, or unproven","evidence":"string"}],"humanSignoff":{"required":true,"reasons":["string"],"approvals":["string"],"evidence":["string"]},"verdict":{"risk":"low, medium, or high","recommendation":"MERGE, REVIEW, or BLOCK","reason":"string"}}

TASK:
${task}

REVIEW CONTRACT:
${contract || "No additional contract supplied. Preserve behavior outside the requested task."}

PULL REQUEST DIFF:
${diff}`,
    });
    const json = response.output_text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    return NextResponse.json(JSON.parse(json));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The review could not be generated. Try again with a valid diff." }, { status: 500 });
  }
}

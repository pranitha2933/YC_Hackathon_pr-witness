import { NextResponse } from "next/server";

const githubPr = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/i;

export async function POST(request: Request) {
  try {
    const { prUrl } = await request.json();
    const match = typeof prUrl === "string" ? prUrl.trim().match(githubPr) : null;
    if (!match) return NextResponse.json({ error: "Use a public GitHub PR URL such as https://github.com/owner/repository/pull/123." }, { status: 400 });

    const [, owner, repo, number] = match;
    const baseUrl = `https://github.com/${owner}/${repo}/pull/${number}`;
    const diffResponse = await fetch(`${baseUrl}.diff`, {
      headers: { Accept: "text/plain", "User-Agent": "PR-Witness-Hackathon" },
      cache: "no-store",
    });
    if (!diffResponse.ok) {
      return NextResponse.json({ error: `GitHub could not provide this public PR diff (HTTP ${diffResponse.status}). Try pasting the .diff URL directly into the diff field.` }, { status: 502 });
    }
    const diff = await diffResponse.text();
    if (!diff.startsWith("diff --git")) return NextResponse.json({ error: "GitHub returned a page instead of a pull-request diff. Try a different public PR." }, { status: 502 });

    let task = `Review pull request #${number} in ${owner}/${repo}.`;
    try {
      const metadataResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "PR-Witness-Hackathon" },
        cache: "no-store",
      });
      if (metadataResponse.ok) {
        const metadata = await metadataResponse.json() as { title?: string; body?: string };
        task = [metadata.title, metadata.body].filter(Boolean).join("\n\n") || task;
      }
    } catch { /* The diff is enough for a review; metadata is optional. */ }

    return NextResponse.json({ task, diff, repository: `${owner}/${repo}`, number });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to fetch that pull request. Paste a public GitHub PR URL or manually paste its .diff content." }, { status: 500 });
  }
}

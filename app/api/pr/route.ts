import { NextResponse } from "next/server";

const githubPr = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/i;

export async function POST(request: Request) {
  try {
    const { prUrl } = await request.json();
    const match = typeof prUrl === "string" ? prUrl.trim().match(githubPr) : null;
    if (!match) return NextResponse.json({ error: "Use a public GitHub PR URL such as https://github.com/owner/repository/pull/123." }, { status: 400 });

    const [, owner, repo, number] = match;
    const headers = { Accept: "application/vnd.github+json", "User-Agent": "PR-Witness-Hackathon" };
    const metadataResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, { headers, cache: "no-store" });
    if (!metadataResponse.ok) return NextResponse.json({ error: "That PR could not be fetched. It must be public and accessible." }, { status: 404 });
    const metadata = await metadataResponse.json() as { title?: string; body?: string; diff_url?: string };
    const diffResponse = await fetch(metadata.diff_url ?? `https://github.com/${owner}/${repo}/pull/${number}.diff`, { headers: { "User-Agent": "PR-Witness-Hackathon" }, cache: "no-store" });
    if (!diffResponse.ok) return NextResponse.json({ error: "The PR metadata loaded, but its diff could not be fetched." }, { status: 502 });

    return NextResponse.json({ task: [metadata.title, metadata.body].filter(Boolean).join("\n\n"), diff: await diffResponse.text(), repository: `${owner}/${repo}`, number });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to fetch that pull request." }, { status: 500 });
  }
}

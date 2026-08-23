# PR Witness

> Review the intent, not 1,000 lines of AI-generated code.

PR Witness is a merge-decision agent for pull requests. It compares the original task with a pull-request diff and produces a Merge Brief: actual changes, scope concerns, blast radius, missing test evidence, and a **MERGE**, **REVIEW**, or **BLOCK** recommendation.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Demo

Click **Load risky demo PR**, then **Generate Merge Brief**. The demo requires no API key and detects that a CSV invoice export PR weakens shared tenant authorization.

## Analyze real pull-request diffs

```bash
cp .env.example .env.local
```

Add your OpenAI key to `.env.local`:

```text
OPENAI_API_KEY=your_api_key_here
```

Restart the server. Never commit `.env.local`.

To obtain a GitHub diff, add `.diff` to a public pull-request URL:

```text
https://github.com/OWNER/REPOSITORY/pull/123.diff
```

Paste that diff and the issue/task description into PR Witness.

## Hackathon pitch

PR Witness is the trust layer for AI-generated code: it proves a pull request matches its intended behavior before a human merges it.

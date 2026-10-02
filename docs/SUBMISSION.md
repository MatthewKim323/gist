# Submission kit

## 90-second clip (on Sapini)

| time | screen | say |
|---|---|---|
| 0:00 | Landing, Sign in, pick the firm profile | "Clio is good software, but getting up to speed still means walking tab by tab. A doctor's office calls: is this case even alive? This is gist OS." |
| 0:07 | Seam wipe, live timeline, mascot working each stage | "It reads the whole matter live from Clio, read only. Sixty-nine agents read every note, email and all 360 scanned pages. Every fact is checked against its source and audited by Jev." |
| 0:20 | Overview: one screen, no tabs | "One screen. Where the case is, what it's worth against the coverage, what's blocking trial, who owes what. Ninety seconds, no tab walking." |
| 0:30 | Next moves: card 1 "Chase SportsCare's records", click Open draft, Approve and copy | "And it tells you what to do next. SportsCare: 858 days, four unanswered requests. The agent drafted the letter; I approve it. gist never sends and never writes to Clio." |
| 0:42 | Card 2 "Share case status with McCulloch", Share opens composer preselected, Publish, phone opens QR, toast | "Goal two: the doctors. Each one gets a deposition-safe slice: is the case alive, what we need from them. No strategy, no value. We see when they open it." |
| 0:55 | Provider page: Respond, upload; firm inbox, gate badge flips | "They answer right there. The checklist asks, the doctor responds, the case moves." |
| 1:05 | Police report row "Conflicting", cite chip opens the PDF page | "Every fact cites its source. The notes say no police report; the defense annexed it on page five." |
| 1:13 | Ask gist OS: "yo what do I do next?" returns action cards | "Or just ask." |
| 1:20 | /cases: radar + autopilot, cost badge | "Autopilot watches Clio, the radar ranks every case. About eighty cents to digest a case the first time, zero to reopen." |

## Form answers

1. **Repo:** https://github.com/MatthewKim323/gist
2. **Clip:** (Drive link, public)
3. **Tech stack:**
   - **Built with:** Next.js 16 (React 19, TypeScript), Three.js / WebGL, Supabase (Postgres, pgvector, Realtime, Storage), the OpenAI API, TypeSafe Jev, and the MCP SDK.
   - **Running on:** Vercel, or localhost.
   - **Data outside Clio:** Supabase only, and only derived data: normalized items, OCR text, verified facts, embeddings, gates, digests, run and cost logs, shares, provider submissions and profiles. Clio is read with GETs only.
4. **Models and cost:**
   - **Models:** gpt-5.4-mini runs OCR, the extraction swarm, reconcile, gates and drafts. gpt-5.5 runs the story and ask. text-embedding-3-large is used for search. Jev (TypeSafe) handles citation audit, gate confirmation and provider redaction. gpt-realtime-mini runs voice.
   - **Cost:** about $0.80 to $1.50 per case cold (see /evals for measured numbers), $0 to reopen unchanged, a few cents per new item.
5. **Judges should know:**
   - **Where to look first:** lib/server/pipeline (swarm, verifier, Jev audit), lib/server/gates (phase checklist), lib/server/share (server-side provider redaction).
   - **Differentiators:** the two-sided loop (firm gaps become provider asks, providers respond), verified citations with rejected facts shown, incremental caching, autopilot, evals with scripts (/evals, /whitepaper), and a read-only MCP server.
   - **Honest gaps:**
     - Auth is demo-grade: signed cookie, no passwords.
     - The three Demo cases are synthetic and Supabase-only. Sapini is the only live Clio matter.
     - Per-token prices in code are estimates.
     - The Clio trial has no client photo, so initials show instead.
6. **Live link:** (Vercel URL if deployed)

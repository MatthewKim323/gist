# Submission kit

## 90-second clip (on Sapini)

| time | screen | say |
|---|---|---|
| 0:00 | Landing, click Sign in, pick the firm profile | "A doctor's office calls: is this case even alive? Today that means someone reads three years of file. This is gist OS." |
| 0:08 | Seam wipe into the live timeline, the mascot working each stage | "It reads the whole matter live from Clio, read only. Sixty-nine extractors read every note, email and all 360 scanned pages. Every fact is checked against its source, then audited by Jev." |
| 0:22 | Dashboard, Phase & gates tab | "What a lawyer actually needs: where the case is, and what it takes to reach the next phase. Two of twenty-six in hand, and who owes each one." |
| 0:32 | Click the police report row (Conflicting), then the cite chip, which opens the PDF page | "The notes say there's no police report. The defense's own discovery response annexed it on page five. Every number and date opens its source." |
| 0:42 | Money tab | "$375,000 case, $100,000 behind it. Underwater, cited to the fields." |
| 0:48 | Red flags tab | "Five accounts of the accident. A prior ankle fracture the client denied under oath." |
| 0:54 | Agent drafts tab, open the SportsCare draft | "For every blocker the agent drafts the next move. SportsCare: 858 days, four unanswered requests. The lawyer approves; gist never sends and never writes to Clio." |
| 1:02 | Share with provider, toggles, live preview, Publish, phone opens the QR, toast | "The other half: each doctor gets a deposition-safe slice. Status, what we need from them. No strategy, no value. We see when they open it." |
| 1:14 | Provider page, Respond, upload, then firm inbox and the gate badge flips | "They answer right there. The checklist asks, the doctor responds, the case moves." |
| 1:22 | /cases: radar, autopilot, "Ask gist OS" one question | "Autopilot watches Clio, the radar ranks every case, and you can just ask." |
| 1:28 | Cost badge | "About a dollar to digest a case. Zero to reopen." |

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

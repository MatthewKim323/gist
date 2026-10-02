# gist OS: Verified Case Digests for Personal-Injury Firms

**gist OS team** · Technical report · October 2026 · Rendered with live results at [/whitepaper](/whitepaper); raw tables at [/evals](/evals)

## Abstract

A personal-injury file is hundreds of loosely structured entries (notes, emails, call logs, tasks, calendar items, custom fields) plus scanned documents that run to hundreds of pages. The people who need to act on it, the attorney who inherits the matter and the medical providers treating the client on a lien, cannot read all of it, and the costly failure is not a hallucinated sentence but an omitted one. gist OS reads a matter read-only from Clio and turns it into a cited digest for the firm and a redacted status page for each provider. Every fact the system shows is extracted by a sharded model swarm, then checked by a deterministic quote verifier against the exact source it cites, then audited by a calibrated classifier (Jev, from TypeSafe) for whether the source supports the claim. Verified facts feed a hybrid retrieval index (pgvector plus Postgres full text, fused with reciprocal rank fusion), a contradiction reconciler, a phase-gate checker built on a New York PI playbook, and a final synthesis step. Every stage is content-addressed and cached, so a re-run over an unchanged file costs close to nothing. We evaluate the system with adaptations of published benchmarks (FActScore-style atomic recall, ALCE-style citation precision, RAGAS, RULER-style long-document retrieval, tau-bench-style agent tasks with pass^k, LongMemEval-style memory) on one real matter, against an independently written answer key and a single-shot long-context baseline. All numbers in Section 4 are produced by `scripts/eval.ts` and read from `eval/results/latest.json`; none are typed by hand.

## 1. Introduction

The brief (Swans x Law-Di-Gras, October 2, 2026) asks for a digest of a live Clio case that works for two audiences at once: the firm (case value, coverage, injuries, what is overdue, what changed, every fact sourced) and the providers treating the client (is my patient showing up, will I get paid, what does the firm need from me). The constraints are as instructive as the goal:

- **Read-only.** The app holds read-only Clio scopes and never writes back.
- **No hardcoding.** The matter is discovered from the database; no client name or case fact appears in application code.
- **Incremental and cheap.** Re-digesting an unchanged case must not pay for the model again.
- **Omissions over hallucinations.** The Swans CTO framed it directly: an omission is more dangerous than a hallucination. A digest that silently drops the incident report annexed to a discovery response is worse than one that says "not sure".

Our test matter is a real seeded Clio file: a New York motor-vehicle case in litigation (162 Clio timeline items, 27 documents, including a 131-page chiropractic records bundle and several scanned pleadings). Its notes contradict its own documents in ways a skim misses: a memo says a witness was never contacted while the file holds a subpoena for his deposition; a note says the incident report is missing while a filed discovery response annexes it. These are the failures gist OS is built to surface.

Our contributions are: (1) a pipeline where every displayed fact carries a quote that code, not a model, has found in the cited source; (2) a calibrated second check (Jev) that separates "the quote exists" from "the quote supports the claim"; (3) a reconciler that turns verified facts into contradiction and "buried evidence" findings; (4) a two-sided output (firm digest plus provider share behind a redaction gate); and (5) an evaluation harness that adapts six published benchmark families to a single real legal matter, with a long-context baseline.

## 2. System design

```
                 Clio (read-only OAuth)
                        |
                        v
 [1] sync ----------> source_items (sha256 content_hash, updated_since cursors, tombstones)
                        |
 [2] OCR -----------> doc_pages (text layer first; image/junk pages -> vision model; cached per doc version + page)
                        |
 [3] extract swarm -> facts (gpt-5.4-mini, one call per shard, cache key sha256(shard)+prompt_version+model)
        |                 |
        |          [4] quote verifier (deterministic: NFKC, token overlap >= 0.85, date/amount presence)
        |                 |
        |          [5] Jev audit (supports / contradicts / unsupported, auto-accept p >= 0.8)
        v                 |
 [6] index ---------> chunks (items + pages + verified facts; text-embedding-3-large @1536, halfvec + tsvector)
                        |
            +-----------+------------+
            v                        v
 [7] reconcile                [8] phase gates
 contradictions,              playbook requirements x evidence
 buried evidence (Jev >= 0.6 / 0.7)   (gpt-5.4-mini + Jev cross-check)
            |                        |
            +-----------+------------+
                        v
 [9] synthesis (gpt-5.5 story over facts, flags, gates; skipped when input hash unchanged)
                        |
          +-------------+--------------+
          v                            v
   firm digest + Ask gist        provider share (deterministic redaction -> Jev redaction gate)
```

| Stage | Model | Cache key | Guarantee |
|---|---|---|---|
| 1 Sync | none | per resource `updated_since` cursor; per item sha256 `content_hash` | Only new or changed items are rewritten; deletions are tombstoned, never silently kept |
| 2 OCR | none for text layers; `gpt-5.4-mini` vision for image or junk-text pages | `(doc_id, version_id, page)` | A page is transcribed once per document version |
| 3 Extract | `gpt-5.4-mini` (structured output) | `sha256(shard content):PROMPT_VERSION:model`, plus `VERIFY_VERSION` for re-derivation | Same shard, same prompt, same model: $0; verifier changes re-derive facts from the cached output without a model call |
| 4 Verify | none (code) | n/a | A fact whose quote is not in its cited source is `rejected` and kept for audit, never shown as true |
| 5 Audit | Jev (`jev-latest`) | rides on the extraction cache | Only `supports` with p >= 0.8 promotes a clean fact to `verified` |
| 6 Index | `text-embedding-3-large`, 1536 dims | per chunk sha256 of audience + header + body | Only new or changed chunks are embedded |
| 7 Reconcile | `gpt-5.4-mini` + Jev | sha256 of model, prompt, thresholds, fact ids and listing | Every finding cites at least two distinct sources and passes a Jev threshold |
| 8 Gates | `gpt-5.4-mini` + Jev | sha256 of prompt version, model, requirement and its evidence | Status `have` requires citable evidence, else downgraded to `partial` |
| 9 Synthesis | `gpt-5.5` | sha256 of model, system prompt and the full story input | Numbers (spend, last contact, overdue, value vs limits) are computed in code; the model writes prose over cited inputs only |

Every model call is logged to `llm_calls` (tokens, cached tokens, cost, latency) and every unit of work to `agent_tasks` under an `agent_runs` row, which is what the run timeline in the app draws and what Section 5 reads.

## 3. Method details

### 3.1 Sharding

Clio items are grouped by kind and cut into shards so each model call sees a coherent slice: notes in shards of 10, emails and calls in shards of 15, tasks, calendar entries and custom fields in shards of 25, contacts and relationships in shards of 30, with a hard cap of 60,000 characters per shard. Document pages are sharded in windows of 10 pages per document. Each source is wrapped in a `<source ref=... kind=... date=...>` tag; the `ref` the model must copy back is the same string the verifier looks up, so a fact can only cite something that was in its own prompt. Shards run with bounded concurrency (8 by default).

### 3.2 Deterministic quote verification

For a fact with quote `q` citing source `s`:

1. **Normalize** both strings: per character NFKC, lowercase, keep letters and digits, collapse every run of anything else into one space. A position map from the normalized string back to the original is kept so the UI can highlight the exact span.
2. **Exact match**: if normalized `q` is a substring of normalized `s`, the score is 1.
3. **Fuzzy match** otherwise: slide a window of `|q|` tokens over `s` and compute the best multiset token overlap, `max over windows of |tokens(q) ∩ window| / |tokens(q)|`, in one linear pass.
4. **Ellipses**: a quote stitched with `...` is split, and every part must pass on its own; the fact's score is the minimum over parts.
5. **Threshold**: score below **0.85** means `rejected` with the overlap recorded in `reject_reason`. A missing `source_ref` or a quote shorter than 3 normalized characters is rejected outright.
6. **Dates and amounts**: if the fact has an `event_date`, some written form of that date (16 common forms, plus month-and-year, plus the item's own date) must appear in the quote or the cited source; if it has `amount_usd`, some form of that amount (whole, cents, thousands separators, `k`, `million`) must appear. Failing either moves the fact to `needs_review`, not `verified`.

No model participates in this step, so it cannot be argued with: a quote is in the source or it is not.

### 3.3 Calibrated audit (Jev)

A quote can be real and still not support the summary written on top of it. Each surviving fact becomes one Jev `choice` question (`supports` / `contradicts` / `unsupported`) whose state holds only the cited source text, batched up to 40 questions and about 12,000 characters per request. A fact is `verified` only if Jev answers `supports` with probability **>= 0.8** and the verifier left it clean; everything else is `needs_review` with the reason. If Jev is unavailable the system degrades to quote-verified facts and says so.

The same calibrated classifier is reused downstream with thresholds tuned per task, exactly as coded:

- Reconcile keeps a **contradiction** finding when Jev rates it at least **0.6**, and a **buried evidence** finding (one source says an item is missing, another shows it in hand) at least **0.7**, since a false "you already have it" is costlier.
- Phase gates let Jev override the gate checker's status only when Jev's choice differs, its confidence is at least **0.75**, and its probability for the checker's status is below **0.2**.
- The provider redaction gate blocks a snippet when any of four Jev yes/no checks (money, strategy, credibility, other provider) scores at least **0.5**.

### 3.4 Hybrid retrieval

The index holds one chunk per source item, one per OCR'd page and one per verified fact, each with a contextual header (who, when, what) so both BM25 and the embedding see it. A query is expanded by `gpt-5.4-mini` into two alternative phrasings (clinical and legal vocabulary). The `hybrid_search` SQL function ranks chunks by `ts_rank_cd` over an OR-ed `tsquery` and, separately, by cosine distance for each query embedding, then fuses with reciprocal rank fusion, `score(d) = Σ_lists 1 / (k + rank)`, with **k = 60**. Scores are max-normalized and verified-fact chunks get a **1.5x** boost. Results then pass a four-layer dedup ported from gbrain: Jaccard similarity above 0.85 against kept results is dropped, no source kind may exceed 60% of results, and at most two hits per source (all pages of a document count as one source).

### 3.5 Reconciliation

Verified facts are clustered by event key and embedding similarity (same event at cosine >= 0.8 inside a 30-day window, duplicates at >= 0.92, key merging at >= 0.85, groups capped at 30). Each group goes to `gpt-5.4-mini`, which proposes contradictions and buried-evidence findings; any finding that does not cite at least two distinct sources is discarded, then Jev applies the thresholds in 3.3.

### 3.6 Phase-gate playbook

`lib/server/gates/playbook.ts` encodes what a generic New York PI file needs before it can leave each phase (Intake, Treatment, Demand, Negotiation, Litigation, Trial, Disbursement), for example signed HIPAA authorizations, a notice of claim when a public entity is involved, per-provider records and itemized bills, adverse limits confirmed in writing, party and non-party depositions, IME reports with rebuttal, expert disclosures under CPLR 3101(d). Per-provider requirements are expanded at runtime from the matter's own treating-provider relationships, so nothing case-specific lives in the playbook. Each requirement carries search queries and evidence keys; the gate checker sees the retrieved evidence, returns `have`, `partial`, `missing` or `conflicting` with who owes the item, and Jev cross-checks the status. Requirements of every earlier phase are re-checked, so an intake item that was never done keeps surfacing in litigation.

### 3.7 Provider share and redaction gate

A provider share is assembled from `provider_safe` facts and provider-specific items, then every outgoing string passes two gates. First, deterministic redaction replaces SSNs, dates of birth, phone numbers, emails, street addresses and account or policy numbers, and reduces the client's name to initials. Second, the Jev redaction gate asks four questions per snippet (settlement or valuation, legal strategy or weakness, prior injury or credibility, another provider's bills or records), framed with the warning that opposing counsel may read the page. Anything at or above 0.5 is pulled and listed for the attorney with its reason. If Jev fails, a `gpt-5.4-mini` classifier stands in; if that fails too, the gate fails closed and blocks.

## 4. Evaluation

All results below are generated by `scripts/eval.ts` and stored in `eval/results/latest.json` (with timestamped copies in `eval/results/`). On GitHub the result blocks are invisible markers; the rendered version with tables is at [/whitepaper](/whitepaper) and the raw tables at [/evals](/evals).

**Setup.** One real matter (the seeded Sapini file: 162 Clio timeline items and 27 documents). The reference is `eval/reference/answer-key.md`, written earlier on October 2, 2026 by a separate research agent that read the raw seed JSON and document text layers, independently of the pipeline, and used only for scoring, never by the app. From it we derive a checklist of atomic expected findings (`eval/reference/checklist.json`) and a question set with gold answers and gold source refs (`eval/reference/qa.json`). Judges are `gpt-5.4-mini`; every judge prompt is a named constant (`JUDGE_*`) in `scripts/eval.ts`, and judge cost is logged per suite.

**These are adaptations of published benchmarks on one matter, not official leaderboard numbers.** Each suite borrows the metric definitions and protocol of its origin and applies them to this case; N is small and reported per suite.

### 4.1 Benchmarks

| Suite | Modeled on | Our adaptation |
|---|---|---|
| Atomic fact recall (omission rate) | FActScore, Min et al. 2023 (arXiv:2305.14251) | The answer key is decomposed into atomic findings; a judge decides if gist's verified facts, digest, contradictions or gates contain each one. Recall overall and per category, misses listed |
| Citation precision | ALCE, Gao et al. 2023 (arXiv:2305.14627) | Deterministic re-check that each verified fact's quote is in its cited source and that its date or amount appears, plus a judged "source supports the summary" sample |
| Verifier and Jev behavior | (system diagnostic) | Status and reason counts from the DB; judged precision of rejections on a sample |
| Contradiction detection | (task-specific) | Hit rate of surfaced findings against the answer key's contradiction list, and judged validity of a sample of findings |
| RAG quality | RAGAS, Es et al. 2023 (arXiv:2309.15217) | "Ask the case" on the QA set, judged for faithfulness, answer relevancy, context precision and context recall per the RAGAS definitions |
| Retrieval ablation | (standard IR) | recall@5 and recall@10 against gold refs for hybrid vs vector-only vs keyword-only through the same SQL function |
| Long-document needle retrieval | Needle-in-a-Haystack, Kamradt 2023; RULER, Hsieh et al. 2024 (arXiv:2404.06654) | No planted needles: questions whose evidence sits deep inside the long scanned bundles, recall reported by page-depth bucket |
| Agent harness | tau-bench, Yao et al. 2024 (arXiv:2406.12045) | Tasks for the Ask gist assistant with programmatic checks (required tool called, cites valid, gold key facts present, no invented numbers); pass^1 and pass^2 over 2 trials |
| Memory | LongMemEval, Wu et al. 2024 (arXiv:2410.10813) | Scripted multi-session runs against per-profile memory: single-session recall, knowledge update, temporal, abstention; throwaway profile deleted after |
| Long-context baseline | (head-to-head) | One `gpt-5.5` call with the whole case text (truncated to context) asked for the same checklist and QA set, scored by the same judge |

### 4.2 Atomic fact recall

<!-- eval:fact_recall -->

### 4.3 Citation precision

<!-- eval:citation_precision -->

### 4.4 Verifier and Jev behavior

<!-- eval:verifier_jev -->

### 4.5 Contradiction detection

<!-- eval:contradictions -->

### 4.6 RAG quality (RAGAS-style)

<!-- eval:rag -->

### 4.7 Retrieval ablation

<!-- eval:retrieval_ablation -->

### 4.8 Long-document needle retrieval

<!-- eval:needle -->

### 4.9 Agent harness (tau-bench-style)

<!-- eval:agent -->

### 4.10 Memory (LongMemEval-style)

<!-- eval:memory -->

### 4.11 Single-shot long-context baseline

<!-- eval:baseline -->

## 5. Cost per case

<!-- eval:cost_latency -->

Cost is dominated by the first (cold) digest: OCR of image pages and one extraction call per shard. After that, every stage is keyed on content: an unchanged item keeps its hash, so its shard hits `extraction_cache`; unchanged chunks are not re-embedded; reconcile and gate decisions are cached on their exact inputs; and synthesis is skipped when the story input hash matches the last digest. A sync that brings one new email re-runs only the shard that contains it, the chunks it touches, and the downstream steps whose inputs actually changed. Verifier or audit rule changes bump `VERIFY_VERSION` and re-derive facts from cached model output at zero model cost.

## 6. Limitations

- **One real matter.** Every benchmark here runs on a single seeded case (plus synthetic demo matters that are not scored). Numbers are directional, not a population estimate.
- **Answer key provenance.** The key was written by a separate research agent earlier on the same day, reading the raw seed JSON and document text layers, independently of the pipeline. It was not written by a lawyer and did not read the two large medical bundles in full, so items that live only in those bundles are under-represented, and some of its derived claims may themselves be wrong.
- **Judge bias.** The judge is `gpt-5.4-mini`, the same model family that produces gist's extractions and answers. Same-family judges are known to be lenient toward their own outputs; we mitigate with deterministic checks where possible (citation precision, retrieval recall, agent programmatic checks) and report judged and deterministic metrics separately.
- **Price table.** Costs come from a per-token price table hardcoded in `lib/server/llm.ts`, not from invoices. Jev cost is estimated from characters divided by four at a fixed rate. Treat dollar figures as estimates.
- **Small N.** Several suites run 10 to 50 items with one or two trials to stay inside a few dollars of eval spend; confidence intervals would be wide.
- **Demo-grade auth.** Profiles are picked on a sign-in screen without passwords; share links are random 256-bit tokens stored only as sha256 hashes, but the deployment is a hackathon build, not a hardened multi-tenant system.

## 7. Future work

- A multi-matter benchmark with lawyer-written keys, including medical-bundle content, and inter-annotator agreement.
- Cross-family judging (a judge from a different model family) and human spot checks on judged suites.
- Calibration curves for the Jev thresholds per task from labeled data rather than hand-set values.
- Incremental reconcile at the cluster level, so one new fact re-checks only its own cluster.
- Provider-side writes (records and bill uploads) closing the loop on the gates they owe, and webhooks instead of polling once Clio write scopes are acceptable to firms.

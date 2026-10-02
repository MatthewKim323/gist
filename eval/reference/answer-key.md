<!--
PROVENANCE: copied verbatim from research/answer-key.md in the gist working directory.
Written on 2026-10-02 (earlier the same day as the eval run) by a separate research agent that read the raw
Clio seed JSON and the document text layers directly, independently of the gist pipeline (it never saw
pipeline facts, digests, contradictions or gates). It is used ONLY for scoring in scripts/eval.ts; no app
code reads it. Known gaps stated by its author: the long medical bundles were not read. The Clio seed was
extended after the key was written (extra expenses and medical-record/bill PDFs appear in the synced data),
so a few counts in this key (for example "5 expense entries") describe the earlier seed.
-->

# Sapini answer key (as of 2026-10-02)

Source: `research/sapini-clio-data.json` (42 notes, 69 comms, 14 tasks, 17 calendar, 5 expenses, 15 docs, 10 contacts, 9 relationships, 16 custom fields = 162 timeline items) plus text layers of 10 docs (bill of particulars, verified answer, BOP affirmative defenses, both discovery responses, subpoena, 3 expert reports, HIPAA) and 2 scans eyeballed (letter to judge, summons p1/p4). Med bundles (doc-19, doc-20) NOT read.

Citation format: `type date "subject"`. Clio ids are runtime, so match on date+subject. Docs cited by Clio filename + PDF page. **Clio `received_at` on docs does not match the NYSCEF stamp inside the doc** (see §1.8 #14), so cite doc pages, not just received_at.

---

## 1. Ground truth

### 1.1 The story in 6 bullets
1. **2023-04-23, 8:30am, Cedar St & Garden St, New Rochelle NY.** Justin Sapini (DOB 1995-12-21, 30) in his 2012 VW GLI is sideswiped by a Metro-North utility vehicle (2019 Chevy, PA plate ZMP3277, unit E2858D) driven by Anthony F. Ferrara, pulling into a Metro-North facility. No ambulance; Montefiore Nyack ER next day, CT head + C-spine negative. (note 2023-05-07 "Intake summary"; bill-of-particulars p1-3)
2. **Injuries:** both shoulders, both knees, neck/mid/low back, head (TBI on DTI MRI 107 days out), left wrist, right hand. **Left shoulder arthroscopy 2023-07-26** (Capiola, New Horizon Surgical Ctr, Paterson NJ). **Right shoulder arthroscopy recommended 2024-05-27, still undated 858 days later.** Never discharged, no MMI, PT + chiro weekly, 3.5 yrs on. (BOP p3-9; note 2024-05-27 "Second surgery recommended"; note 2026-09-18 "The second surgery is now the biggest open question")
3. **Stage: Litigation / discovery**, NY County Supreme Ct, Index 160000/2024, Hon. Christopher Chin. Defense counsel Milber Makris (Stephen Zaklukiewicz). Plaintiff firm StolzenbergCortelli (Howard Stolzenberg, Terrence Cortelli; paralegal S. Alvarez). Demand served 2024-04-12, lowball offer 2024-04-29 (amount not recorded), overtaken by the 2nd-surgery recommendation. Defense IMEs + radiology review all say "resolved / no trauma". (letter-to-judge p1; BOP p12; note 2024-04-29 "Adjuster response")
4. **Money: value $375,000 vs $100,000/$300,000 confirmed limit.** Specials $118,400 (interim, 8 of 10 providers) + wage loss $214,000 (one 2022 1099, no expert) = $332,400 economics. Progressive no-fault $50k exhausted (not recoverable, Ins Law 5104(a)), UM/UIM $25k/$50k adds nothing, Medicaid lien $22,180, SSD pending, CPLR 4545 pleaded. (custom fields; note 2026-06-04 "Case evaluation"; note 2026-09-09 "Coverage confirmed in writing")
5. **Liability contested two ways, neither investigated by the firm's own account:** (a) mechanism: client has given 3 inconsistent accounts, no police report in file, 22 scene photos never collected; (b) scope of employment decides whether Metro-North (self-insured) is in the case at all; Kyle Pullano "never contacted." Plus prior left-ankle fracture (2011) denied at intake and under oath. (note 2026-09-15 "Case posture, and what is still not done")
6. **The file contradicts its own memo.** Defendants' discovery response (filed 2025-09-30) already annexes the Metro-North incident report marking Ferrara **"On-Duty", "heading to the jobsite"**, names Pullano as his **passenger**, and lists a **Travelers auto policy HC2ECAP477M03**. The firm also subpoenaed Pullano for an EBT on 2025-12-08. Notes from Sept 2026 still say the incident report is missing and Pullano was never contacted. The scope question that "is the whole case" may already be answered in the firm's own documents. (03-discovery__doc-40 p1, p3-4; 03-discovery__doc-43 p1)

### 1.2 The 10 entries that matter (of 162)
| # | Item | Why |
|---|---|---|
| 1 | doc `03-discovery__doc-40__defendants-response-demand.pdf` p1, p3 (IR-1), p4 (cover sheet). NYSCEF 2025-09-30, Clio received 2024-11-03 | Ferrara **On-Duty**, "heading to the jobsite"; **Kyle Pullano = passenger witness**; **Travelers policy HC2ECAP477M03**; location "I-95 SB Exit 16 ramp" on IR-1 vs "Cedar St & Garden St" on cover sheet; Ferrara says HE was sideswiped on passenger side (4th account) |
| 2 | note 2026-09-15 "Case posture, and what is still not done" | The master risk memo: two-level liability, 3 accounts, Pullano, ankle, glenoid hypoplasia, anticipated defenses |
| 3 | note 2026-06-04 "Case evaluation" | $375k valuation, $332,400 economics, capped at $100k, 4 exposures stated plainly |
| 4 | email 2026-09-08 "RE: Coverage confirmation, claim SIR068120" (CSB) + note 2026-09-09 "Coverage confirmed in writing" | $100k/$300k BI, no excess disclosed. The coverage KPI source |
| 5 | email 2026-09-24 "RE: Chaser: right shoulder surgical date" (McCulloch) | 5th approach answered: Capiola wants to see patient again, no date. The item holding the case |
| 6 | note 2026-09-25 "Specials cannot be closed while two ledgers are unreconciled" (+ note 2024-02-17 "Specials tally to date: $118,400.00" for the breakdown) | specials are interim, chiro + PT ledgers never reconciled |
| 7 | note 2023-05-31 "Prior injury discrepancy: left ankle" | 2011 talus avulsion fracture vs "none" at intake vs ankle complaint not claimed |
| 8 | note 2023-05-23 "Mechanism: the client has given three different accounts" | the credibility problem, with no police report |
| 9 | doc `08-experts__doc-56__ime-orthopedic-hostin.pdf` p4-12 (+ doc-55 Tsao, doc-47 Katzman) | Defense: all sprains "resolved", MMI, **return to work without restrictions**; client **refused past medical history**; client told Hostin *his* car struck the other (account #2) and told Tsao he was sideswiped by a truck and hit the sidewalk (account #3); Katzman: brain/DTI normal, knees + R shoulder no recent trauma |
| 10 | phone 2026-09-27 "Client call: should he keep going to PT" (+ email 2026-09-21 "Updated employment and commission records", unanswered; task "Obtain updated employment and commission records from client" overdue) | last real client contact; wage claim (biggest number) rests on one document and client hasn't sent more |

Alternates if you want 12: doc `03-discovery__doc-43__subpoena-kyle-pullano.pdf` p1 (contradicts "nobody contacted him"); note 2026-09-06 "Discovery is stuck on the maintenance records" (dispatch records objection = the scope fight).

### 1.3 Key dates timeline
| Date | Event | Source |
|---|---|---|
| 2011-10-05 | Prior L ankle/foot X-ray: small dorsal avulsion fracture of anterior talus (Blumberg) | note 2023-05-31; Hostin IME p5 |
| 2018-09-10 | Prior chest X-ray | note 2023-05-31 |
| **2023-04-23** | **DOI**, 8:30am | custom field Date of Incident |
| 2023-04-24 | Montefiore Nyack ER, CT head + C-spine negative | BOP p9 #10; note 2023-05-07 |
| 2023-05-07 | Intake, retainer + HIPAA; matter open_date | calendar "Initial client consultation"; matter.open_date |
| 2023-05-15 | LOR to Claims Service Bureau, claim SIR068120 | email 2023-05-15 |
| 2023-05-24 | Bilateral shoulder MRIs (DOI+31) | note 2023-09-20; Hostin p5-6 |
| 2023-07-26 | **Left shoulder arthroscopy** (DOI+94) | calendar "Left shoulder arthroscopy"; BOP p3 |
| 2023-08-08 | Brain MRI/DTI (DOI+107), TBI PPV >95% | note 2023-09-20 |
| 2023-09-14 | SportsCare "discharge" note (DOI+144), notes continue 91 more days | note 2023-11-19 |
| 2023-12-19 | Progressive no-fault $50k exhausted | email 2023-12-19 |
| 2024-03-28 | Medicaid lien $22,180 asserted; SSD filed | note 2024-03-28; task "File Medicaid lien acknowledgment" |
| 2024-04-12 | Demand package to CSB | email/note 2024-04-12 |
| 2024-04-29 | CSB offer "well under $100k" (amount not in file) | note 2024-04-29 |
| 2024-05-27 | **Right shoulder arthroscopy recommended** | calendar "Consultation re second surgery"; note 2024-05-27 |
| 2024-10-11 | Summons + complaint filed, Index 160000/2024 (NYSCEF) | 02-pleadings__doc-01 p1 |
| 2024-12-02 | Verified answer: 9 affirmative defenses incl PAL 1276, SOL, another action pending | 02-pleadings__doc-05 p2-4 |
| 2025-01-02 | Plaintiff's BOP + discovery responses filed; RJI/PC request | doc-07; doc-08; letter-to-judge |
| 2025-04-16 | Letter to Justice Chin: no PC date yet | 06-correspondence__doc-12 |
| 2025-09-30 | Defendants' response w/ incident report; defendants' BOP on affirmative defenses | doc-40; doc-41 |
| 2025-11-02 | Subpoena: Pullano EBT set for **2025-12-08** (outcome not in file) | doc-43 |
| 2025-12-08 | Katzman radiology review dated | doc-47 p3 |
| 2026-03-04 | Tsao neuro IME (per report) | doc-55 p3 |
| 2026-03-31 | Hostin ortho IME (per report, "Rescheduled") | doc-56 p4 |
| 2026-04-22 | SOL date in Clio (task complete, "satisfied") | matter.statute_of_limitations; task "Limitations Date" |
| 2026-09-02 / 09-07 | IMEs per Clio calendar/tasks (conflicts with reports, §1.8) | calendar "Orthopedic IME..." / "Neurological IME..." |
| 2026-09-08 | CSB confirms $100k/$300k | email 2026-09-08 |
| 2026-09-24 | McCulloch: no date until re-eval | email 2026-09-24 |
| 2026-09-27 | Last client contact | phone 2026-09-27 |
| 2026-10-05 → 10-29 | upcoming, §1.7 | |

Derived: days since DOI **1,258**; matter age 1,244 days; R shoulder recommendation undated **858** days.

### 1.4 Case value vs coverage
| Line | Amount | Source |
|---|---|---|
| Estimated case value | **$375,000** | custom field Estimated Case Value; note 2026-06-04 |
| Medical specials (interim) | $118,400 | custom field Medical Specials To Date; note 2024-02-17 |
| Wage loss claimed | $214,000 | custom field Wage Loss Claimed |
| Economics | $332,400 | custom field Case Value Rationale |
| Defendant BI limit | **$100,000 / $300,000** (confirmed in writing 2026-09-08) | custom field Policy Limits; email 2026-09-08 |
| UM/UIM | $25,000 / $50,000, adds nothing (below defendant limit) | note 2026-09-09 |
| No-fault (Progressive, claim 22-4471102) | $50,000, exhausted, not recoverable | email 2023-12-19; note 2024-01-08 |
| Medicaid lien | $22,180 | custom field Health Insurance or Lien Holder |
| **Gap** | value - limit = **$275,000**; limit covers **26.7%** of value | computed |

Specials breakdown (note 2024-02-17): New Horizon surgery $38,500; Montefiore ER $9,087; imaging (10 studies) $24,600; EMG/NCV (4) $6,200; chiro Adv Rockland (96 visits) $17,400; PT SportsCare (74 sessions) $14,900; McCulloch/Capiola (14 visits) $4,850; physiatry + neuro (Abramov, Kwan) $2,863. Sums to $118,400 exactly.

Illustrative waterfall at the $100k cap (fee % is NOT in the file, 33⅓% assumed, label it): 100,000 − 33,333.33 fee − 1,410 costs − 22,180 Medicaid = **$43,076.67** to client, before any provider balances (none recorded) and before lien negotiation.

**Coverage panel must show three states (Mark Day test):**
- Known: $100k/$300k BI per CSB letter, "no excess or umbrella disclosed" (email 2026-09-08). Policy Limits Confirmed = true.
- Unknown / conflicting: whose policy is the $100k? Note 2023-05-14 says **Ferrara personally** carries $100k/$300k and Metro-North is **self-insured "with no stated ceiling"** (note 2023-05-09). The Metro-North accident cover sheet lists **Travelers Indemnity policy HC2ECAP477M03** (doc-40 p4). Distribution list includes **Danella Rental Systems** (Plymouth Meeting PA), and the vehicle has a PA plate: possible lessor. If Metro-North stays in (on-duty per IR-1), the $100k "cap" may not be the cap. The "underwater" thesis rests on an unresolved coverage question.
- Not researched: no statement of exposure requested from Metro-North (note 2023-05-14), no policy/asset search, Travelers limits never asked, Danella never investigated, folder 07 Insurance empty.
- Legal flag for attorney (hedged): Metro-North is pleaded as **owner** (BOP p3 #7). NY VTL §388 owner liability for permissive users may not depend on scope of employment. The file treats scope as dispositive; worth a lawyer's second look.

### 1.5 Firm spend
**$1,410.00 total, 5 expense entries, all "not yet reimbursed".**
- 2023-08-31 $65 McCulloch records copy
- 2023-11-09 $85 Montefiore ED chart reproduction
- 2023-11-29 $450 reproduction + imaging copies (remaining providers, 10 studies)
- 2024-07-21 $210 court filing, summons/complaint (index 160000/2024)
- 2026-09-03 $600 IME observer (both exams)

Records $600 / court $210 / IME $600. No expert, deposition, investigator or police report costs: consistent with "nothing investigated, no experts retained".

### 1.6 Last real client contact
- **Last contact: 2026-09-27, phone, client-initiated** ("Justin called": asks if he should keep going to PT; surgery still undated; employment records "soon"). **5 days ago.** (phone 2026-09-27; note 2026-09-27 "Client call: treatment status" is the same call, dedupe). Note: the Clio comm is stored as User→Client although the body says the client called. Direction field is unreliable.
- Prior: phone 2026-09-25, phone 2026-09-12, phone 2026-09-07.
- **Last written word from the client: email 2025-04-08 "Checking in: still going to therapy" (542 days).** Firm email 2026-09-21 asking for commission statements is unanswered.
- Client comm count: 20 of 69 comms involve the client (calls + emails).

### 1.7 Overdue / upcoming / waiting on whom (today 2026-10-02)
**Overdue (2):**
- task "By medical provider: McCulloch Orthopaedic... Updated records and right shoulder surgical date", due 2026-08-25, **38 days overdue**. Waiting on: **provider** (McCulloch).
- task "Obtain updated employment and commission records from client", due 2026-09-26, **6 days overdue**. Waiting on: **client**.

**Upcoming (tasks + calendar):**
| Date | Item | Owner/waiting on |
|---|---|---|
| 10-05 | task "Reconcile chiropractic and PT ledgers against CPT lines" | firm (blocked by providers) |
| 10-07 | task "By medical provider: Advanced Rockland... daily notes and itemised bill" | provider |
| 10-09 | cal: chiro session, Haggerty | client attendance |
| 10-10 | task "Confirm date of right shoulder arthroscopy..." + cal "Call to McCulloch... Fourth attempt" | firm → provider |
| 10-10 | cal: PT session SportsCare | client attendance |
| 10-14 | task "By medical provider: SportsCare... Ongoing treatment notes" | provider |
| 10-14 | cal: "Follow-up call with client re treatment status" | firm → client |
| 10-17 | cal: PT session SportsCare | client |
| 10-21 | cal: "File review: compliance conference and the second surgery" (decide motion to compel dispatch records; how to value undated surgery) | attorney |
| 10-29 | cal: "Client appointment: updated employment and commission records" | client |

Not calendared: the 2026 compliance conference (email 2026-01-29; note 2026-03-06; note 2026-09-06 asks for one). Pullano EBT outcome. Client deposition (defense wants it after the surgery, note 2025-08-27).

**Waiting on whom (deterministic from comms: last inbound vs outbound since):**
| Party | Ask | Outbound since last answer | Waiting since |
|---|---|---|---|
| McCulloch / Capiola | R shoulder date, updated notes, itemised bill | answered 2026-09-24 but no date; 5 approaches (5/5, 6/14 phone, 7/4, 8/3, 9/17) | surgery undated since 2024-05-27; billing "to follow" since 2023-08-31 |
| SportsCare PT | notes + itemised ledger since last production | **4 unanswered** (2024-05-27, 2025-05-07, 2026-03-23 "court has asked", 2026-05-05) | last inbound **2023-11-19 (1,048 days)** |
| Advanced Rockland Chiro | itemised ledger w/ CPT | 2 unanswered (2025-08-10, 2026-09-26) | ledger "to follow" since 2023-10-20; last inbound 2024-08-15 (778 days) |
| Montefiore Nyack | itemised ED charges, acct 4471-SAPINI | 1 unanswered (2025-12-06) | 300 days |
| Defendants (CSB / Milber Makris) | incident report, vehicle assignment + dispatch records, scope-of-employment disclosure | email 2026-09-05; the 2026-09-08 "RE:" reply ignores it and restates coverage | dispatch records objected to as overbroad (note 2026-09-06) |
| Client | commission statements post-2022; surgery decision | email 2026-09-21 unanswered | |
| Firm itself | never asked for the 22 photos; never contacted Pullano (per notes); no police report; no economic expert | | since 2023-05 |

### 1.8 Contradictions and red flags (the omission-defense card)
1. **Accident accounts (5 on file):**
   - A. Claim paperwork / complaint / BOP: Metro-North vehicle merged into his lane and struck him; their passenger door hit his driver door (note 2023-05-23 #1; BOP p2-3 #6, #8; complaint p4 ¶27-29).
   - B. Intake: MN vehicle turning into the facility contacted his driver door (note 2023-05-07).
   - C. Intake alt: both merging, **his** vehicle struck the other (note 2023-05-23 #2). **Repeated to defense IME Hostin 2026-03-31** (doc-56 p4).
   - D. Earlier written: sideswiped **by a truck, then struck the sidewalk** (note 2023-05-23 #3). **Repeated to defense IME Tsao 2026-03-04** (doc-55 p3).
   - E. Ferrara's IR-1: Ferrara was sideswiped by another vehicle on his passenger side, **on the I-95 SB Exit 16 ramp** (doc-40 p3), while the MN cover sheet says Cedar St & Garden St (p4).
2. **Prior injuries:** intake "none" (note 2023-05-07) and **sworn discovery response "Not applicable"** (doc-08 p4, 2025-01-02) vs 2011 L ankle/foot avulsion fracture + 2018 chest film in his own stack (note 2023-05-31; task "Catalogue client's own document stack"). Claims L ankle to Hostin (doc-56 p4) but no ankle in BOP. Refused PMH to both IME doctors (note 2026-09-02; doc-56 p5). Custom field: "Denied by the client, contradicted by his own paperwork".
3. **Scope of employment "never investigated" vs the file:** IR-1 checks **On-Duty**, "heading to the jobsite" (doc-40 p3); complaint pleads course of employment (doc-01 p4 ¶27). Notes 2023-06-07, 2026-01-12, 2026-09-15 say it's unanswered.
4. **Kyle Pullano "has not been contacted" / "nobody has contacted him"** (note 2023-06-07; note 2026-09-15) vs **subpoena for EBT 2025-12-08** (doc-43, dated 2025-11-02) and defendants identifying him as Ferrara's passenger (doc-40 p1). Note 2026-03-06 says the Pullano deposition is outstanding on their side.
5. **Incident report "being searched for" / "not produced"** (note 2026-09-06; email 2026-09-05) vs annexed to defendants' response filed 2025-09-30 (doc-40 p3).
6. **Police report: "none obtained / none in file"** (notes 2023-05-23, 2026-09-15) vs plaintiff's own sworn response "**Annexed is a copy of the Police Accident Report**" (doc-08 p5) and Hostin reviewed a "Police accident report dated 4/23/2023" (doc-56 p5).
7. **22 scene photos "we have obtained none"** (note 2026-09-15) vs sworn response "Plaintiff is in possession of twenty-two (22) color copied photographs" (doc-08 p4). Defendants produced 5 (doc-40 p1).
8. **Coverage:** self-insured, "no limit to confirm" (note 2023-05-09; note 2023-05-14) vs $100k/$300k "confirmed" (email 2026-09-08; note 2026-09-09) vs Travelers policy HC2ECAP477M03 (doc-40 p4). The $100k may be Ferrara's personal policy (note 2023-05-14).
9. **Second action / SOL exposure:** plaintiff's response says the suit is index **150940/2024** (doc-08 p4), caption is **160000/2024**. The answer pleads "another action pending", PAL §1276 non-compliance and SOL (doc-05 p3-4). Index 160000/2024 was filed 2024-10-11 (doc-01 p1), ~18 months post-DOI. PAL 1276 imposes a shortened period against the authority (note 2023-05-09 says so). Task "Limitations Date" says "Satisfied" with no Presentation of Claim document in the file. **Attorney must verify** which action is the timely one.
10. **IME dates and order:** Clio says ortho 2026-09-02, neuro 2026-09-07 (calendar, tasks, note 2026-09-02). The reports say neuro **2026-03-04**, ortho **2026-03-31** ("Rescheduled"), served 2026-03-24 / 2026-04-09 (NYSCEF). Katzman report dated 2025-12-08, exchanged 2026-02-04, and the exchange cover cites "report dated February 11, 2025".
11. **IME watchdog:** note 2026-09-02 says watchdog at both, ortho <15 min. Phone 2026-09-12 says watchdog at **ortho only**, **neuro** <10 min. Tsao's report names watchdog Emmaly Merced at the **neuro** exam (doc-55 p3).
12. **Expert reports "now served" on 2026-09-13** (note) before the service emails of 09-14, 09-20, 09-22.
13. **Who is holding up the 2nd surgery?** Client can't afford time off (phone 2025-07-09); Capiola "will not schedule until the client stops deferring" (note 2025-10-24); client "willing whenever they call" (note 2026-07-04); scheduler "depends on block time" (phone 2026-06-14); Capiola wants to re-see him (email 2026-09-24); client told Hostin he is "scheduled... in the near future" (doc-56 p4). Also phone 2024-10-07: right shoulder "now bothers him more, raise it with Capiola", 4 months **after** the 2024-05-27 recommendation.
14. **Doc dates drift:** summons Clio received 2024-03-08 vs filed 2024-10-11; court-filing expense 2024-07-21; BOP received 2024-05-27 vs filed 2025-01-02; subpoena received 2025-01-02 vs dated 2025-11-02; defendants' response received 2024-11-03 vs filed 2025-09-30.
15. **Compliance conference:** calendar shows one held 2025-04-15, but letter to judge 2025-04-16 says no Preliminary Conference date was ever set.
16. **Residence:** Clio contact + BOP current address **Cypress, Texas** (BOP p1 #3; email jsapini.tx@) vs weekly PT in Nanuet NY + chiro in Spring Valley NY, "confined to his home" (BOP p9 #11b). Attendance claims and the Texas address don't sit together.
17. **Work:** "totally disabled" since DOI (BOP p9 #12) vs Hostin "able to return to work without restrictions" (doc-56 p12). Client told Hostin his work history is "stocking, restaurant service, door-to-door financial advising" (doc-56 p5). $214k rests on one 2022 1099 (task, note 2025-03-18).
18. **PT frequency:** weekly (email 2025-04-08, phone 2025-10-09, email 2026-05-05, calendar) vs twice a week (phone 2024-10-07, phone 2026-09-25, note 2026-09-18). PT "discharged" 2023-09-14 then 91 more days of notes (note 2023-11-19).
19. **Request counts in text are wrong:** task McCulloch "Three written requests" and calendar "Fourth attempt" vs 5 actual approaches (email 2026-09-17 "fifth approach"). Task SportsCare "Two requests unanswered" vs 4. Note 2026-09-25 "SportsCare has not been asked since the last production" vs 4 requests. Note 2023-11-29 "produced in full" vs ledgers never received.
20. **Medical causation:** CT head/C-spine clean day after; TBI rests on DTI 107 days later (note 2023-09-20). Glenoid hypoplasia (developmental) in the same MRI that justified surgery (note 2023-07-12). Katzman: brain, DTI, NeuroQuant normal; knees + R shoulder "no recent traumatic injury" (doc-47). Tsao: TBI/PCS "objectively resolved" (doc-55).
21. **Duplicates:** email 2026-09-08 "RE: Discovery status..." and email 2026-09-08 "RE: Coverage confirmation..." have identical bodies. Progressive exhaustion notices 2023-12-19 and 2025-01-10. The Medicaid lien was asserted 2024-03-28, but the client email "Medicaid lien notice" is dated 2025-03-01.
22. Defense also pleads comparative negligence, assumption of risk, seatbelt, failure to mitigate, emergency doctrine, collateral source (doc-05 p2-3; doc-41).

### 1.9 Injuries (BOP doc-07 p3-9 is the clean cited source; med bundles not read)
- **L shoulder:** posterior inferior labral tear 8-9 o'clock, infraspinatus tear, IGHL thickening, synovitis. **S/p arthroscopy 2023-07-26**: labral repair (PushLock anchor), synovectomy, lysis of adhesions, SAD, debridement of biceps, partial RC tear, cartilage defect. MRI also shows glenoid hypoplasia (developmental).
- **R shoulder:** infraspinatus (anterior half) + posterior inferior labral tear; **arthroscopy recommended, undated.**
- **Head:** concussion, post-traumatic cephalgia, neuronal loss, post-concussion syndrome, abnormal DTI, hemosiderin focus R parietal; blurred vision, migraines, dizziness, photophobia.
- **Knees:** bilateral medial meniscus posterior horn tears; R prepatellar contusion/edema (the BOP puts the edema on the R, note 2023-09-20 puts it on the L, a minor conflict).
- **Spine:** C5-6 bulge, lordosis straightening; L5-S1 bulge narrowing recesses/foramina; thoracic myofascial. EMG: L C5-6 radiculopathy; bilateral L5-S1 radiculopathy (Hostin p7).
- **L wrist** sprain, **R hand** tingling.
- Pleaded permanent, serious injury under Ins Law 5102 (BOP p11 #19).
- Defense view: all sprains resolved, MMI, RTW (Hostin); TBI resolved (Tsao); no trauma on imaging (Katzman).

### 1.10 Providers (10 in BOP doc-07 p10-11; only 4 are Clio contacts + Capiola)
| Provider | In Clio? | Role | Status | Records | Bills | Firm's current ask |
|---|---|---|---|---|---|---|
| Montefiore Nyack Hospital | yes | ER 2023-04-24 | done | ED chart in (note 2023-11-29) | $9,087 in tally; itemised detail never received | itemised charges acct 4471-SAPINI (email 2025-12-06) |
| McCulloch Ortho / Dr. David Capiola (+ Nicole Kosuda PA) | yes (org + person) | ortho, L shoulder surgeon | active; R shoulder recommended, undated | file + op report 2023-08-31 | $4,850 (14 visits); billing "to follow" since 2023-08-31 | surgical date / re-eval appt; notes since last production; itemised bill (task overdue 08-25) |
| Advanced Rockland Chiro (Kevin Haggerty DC) | yes | chiro, weekly | active, never discharged | file 2023-10-20, update 2024-08-15 | $17,400 (96 visits) **unreconciled**, ledger never received | itemised ledger w/ CPT + current notes (task due 10-07) |
| SportsCare PT (Michael Ludena PT) | yes | PT, weekly or 2x | active; odd 2023-09-14 "discharge" | file 2023-11-19 only | $14,900 (74 sessions) **unreconciled** | notes + ledger since 2023-11-19 (task due 10-14); 4 unanswered |
| New Horizon Surgical Center | no | surgery facility | done | op report via McCulloch | $38,500 | none |
| Hudson Valley Radiology / Mid Rockland | no | imaging | done | 10 studies catalogued | $24,600 incl imaging | none |
| Lenox Hill Radiology | no | imaging | ? | ? | ? | unknown |
| Peter Kwan MD | no | neurology | ? | produced (note 2025-02-16) | in $2,863 | none |
| Interventional PM&R (Vadim Abramov MD) | no | physiatry | ? | produced | in $2,863 | none |
| Melinda Miller MD (EMG/NCV) | no | electrodiagnostics | done | per Hostin p7 | $6,200 | none |

"Two providers have sent nothing" (notes 2023-11-29, 2024-02-17, 2026-08-03) are **never named**. Provider balances/liens per provider: **none recorded anywhere.** After no-fault exhaustion, treatment bills through Medicaid (note 2024-01-08), so "will I get paid" for chiro/PT is mostly a Medicaid question, not a lien question. Don't invent provider lien amounts.

### 1.11 Missing from the file
Police accident report (referenced as annexed); 22 client photos; defendants' 5 photos (pages blank); Presentation of Claim / notice of claim under PAL 1276 (no doc); 50-h transcript (referenced, doc-08 p4); retainer (fee %); prior X-rays (2011, 2018) as docs; prior IMEs **Semble 2023-09-13** and **Alleyne 2025-10-31** (listed in Hostin p6, not in Clio); no-fault payment ledger (email 2024-01-13 says attached); the demand package itself; the 2024-04-29 offer amount; Travelers policy limits; Medicaid lien letter; SSD status/award; commission statements 2023+; economic expert; any plaintiff expert (defense has 3, plaintiff 0); Pullano EBT result; client deposition; vehicle assignment + dispatch records; 2026 compliance conference date; MMI statement; names of the 2 non-producing providers; contacts for defense counsel, Kyle Pullano, the judge, and 6 of 10 providers; folders 07 Insurance and 09 Settlement empty; Clio responsible attorney not set in seed.

---

## 2. Attorney view spec (priority order)

| # | Panel | Deck quote | What Sapini shows |
|---|---|---|---|
| 1 | **Header**: photo (from photo-id scan), name, age 30, DOI 2023-04-23 (1,258 days), stage bar (Intake…Closed, at Litigation), index 160000/2024, Justice Chin, opposing counsel | "client's picture as soon as I open" | Justin Sapini, MVA New Rochelle NY, Litigation (5 of 8). NY flag: no-fault state |
| 2 | **Two KPIs**: Value $375k vs coverage $100k/$300k, **UNDERWATER 26.7%** badge + coverage state chips (known / conflicting / not researched) | "what is the case worth, and what coverage sits behind it" | §1.4. Chip: "Coverage conflict: self-insured vs $100k vs Travelers policy on incident report" |
| 3 | **90-second story** (6 bullets, every clause linked) | "up to speed in two minutes" / "without me having to ask anyone" | §1.1 |
| 4 | **Needs attention now**: overdue / upcoming 14d / waiting on whom | "What's overdue, what's coming, and what's waiting on someone else?" | 2 overdue (McCulloch 38d, client records 6d); 6 upcoming; waiting table §1.7 with SportsCare 1,048 days silent |
| 5 | **Risk & contradictions card** (ranked) | "omissions" (Swans CTO) + Erika's "every fact sourced" | Top 5: on-duty IR-1 in file vs "never investigated"; Pullano subpoenaed vs "never contacted"; 5 accident accounts; prior ankle denied under oath; second action / PAL 1276 SOL defense. Rest collapsed |
| 6 | **Last client contact** | "When did anyone last actually talk to the client?" | 5 days (phone 09-27, client called). Sub-line: last written from client 542 days; 09-21 request unanswered |
| 7 | **Since you last opened** | "What changed since I last opened this matter?" | Demo: last open 2026-09-01 → 3 expert reports, coverage confirmation, McCulloch reply, 2 client calls, 2 overdue flips |
| 8 | **Top 10 of 162** + expand all | "Out of three hundred entries, show me the ten that matter" | §1.2 |
| 9 | **Injuries card** with doc page cites | "Somewhere in a 200-page scan are my client's primary injuries" | §1.9 from BOP p3-9 (+ bundles if OCR'd) |
| 10 | **Firm spend + waterfall** | "How much has the firm already spent" | $1,410 (5 entries, 0 reimbursed). Waterfall at $100k: $43,076.67 net, fee % assumption labeled |
| 11 | **Providers & treatment timeline** (per-provider lane, gaps shaded, request ladder) | providers' "is my patient showing up" mirrored | 10 providers, 4 in Clio; R shoulder undated 858d bar |
| 12 | **Key dates timeline** | "If a date is on screen, I need to see where it came from" | §1.3, each clickable |
| 13 | **Source drawer** (global) | "click on anything and open the note, document or email" | note/email text with highlighted quote; PDF at page |
| 14 | **Completeness + cost badge** | "Don't digest the whole case with AI again every time" | "162/162 items, 13 docs text layer, 2 scans OCR'd, 2 bundles skipped" + $ cold / $0 warm |
| 15 | **Provider shares log** | "What did we share with this provider, and has anyone opened it?" | per provider: shared at, sections, opens |

---

## 3. Provider view spec

Defaults for every provider. **Show:** coarse stage ("In litigation, discovery phase"), heartbeat ("case active, last firm activity N days ago", no detail), coverage tier (attorney-chosen wording, default "Liability coverage confirmed in writing", no amount), their own records/bills received checklist, what the firm needs from them (with due date), patient attendance per firm calendar, next scheduled patient visits, stage-change notifications. **Hide always by default:** valuation, policy limits $, specials total, other providers' bills, Medicaid lien and SSD (other lienholders + PHI), offers/demand, liability analysis, accident accounts, prior-injury issue, IME/expert reports, client finances (can't afford surgery), Texas residence, the firm's internal criticism of the provider ("SportsCare has not answered", "gap argument writes itself"). Reason: provider comms aren't privileged; assume defense subpoenas the share. Deposition-safe by default.

**McCulloch Orthopaedic / Dr. Capiola** (group the Capiola person contact under the org)
- Sees: case alive, in litigation; coverage confirmed; records received ✓ initial exam + L shoulder op report (2023-08-11/08-31); ✗ office notes since 2023-08-31; ✗ itemised billing.
- Firm needs: (1) **date for the right shoulder arthroscopy, or the date of Dr. Capiola's re-evaluation visit** (overdue since 08-25; firm call scheduled 10-10); (2) updated office notes; (3) itemised bill. Note to patient's availability: "patient reports he is available at short notice" (email 2026-07-04).
- Opt-in shares (attorney toggle): R shoulder MRI impression (supports their recommendation); PT/chiro attendance. Hide: "undated surgery is worth far less" (note 2026-09-18), client's financial reason for deferring (phone 2025-07-09), Hostin's "resolved, RTW".

**SportsCare Physical Therapy**
- Sees: case alive; records received ✓ through 2023-11-19; ✗ notes since; ✗ itemised ledger; upcoming patient sessions on firm calendar 10-10, 10-17.
- Firm needs: treatment notes + itemised ledger from last production to date (due 10-14); confirm current treatment status/frequency. Answer their implied question: "if a reproduction balance is holding up production, tell us" (email 2026-05-05).
- Hide: unreconciled $14,900, the discharge-note oddity as a *defense* issue (ask neutrally for current status, never ask them to "fix" a record), frequency discrepancy, 4-request history tone.
- "Is my patient showing up": only firm-side signal is client statements + calendar. Visit-level attendance needs their own notes. Show "patient reports attending weekly; last confirmed 2026-09-27".

**Advanced Rockland Chiropractic (Haggerty)**
- Sees: records ✓ through 2024-08-15; ✗ itemised ledger with CPT codes (asked since 2023-10-20); next session 10-09.
- Firm needs: itemised ledger with CPT codes + current daily notes (due 10-07).
- Hide: $17,400 unreconciled, ledger is "least certain" component.

**Montefiore Nyack Hospital**
- Sees: case alive; ED chart ✓; reproduction invoice paid ✓ (2023-11-09); ✗ itemised charges.
- Firm needs: itemised ED charge detail, acct 4471-SAPINI (asked 2025-12-06).
- Patient status: one-time ER visit, no ongoing treatment. Hide: "CT clean, so the TBI rests on imaging 107 days later" (defense argument).

Providers not in Clio (New Horizon, Kwan, Abramov, imaging, EMG): no share target. Composer should say "6 providers in the bill of particulars have no Clio contact" (an omission signal, not a silent drop).

---

## 4. Deterministic signals (never LLM)

| Signal | Computation | Fields |
|---|---|---|
| Days since DOI / age | today − DOI; today − DOB | custom_field_values["Date of Incident"]; client contact `date_of_birth` |
| Stage + position | stage name, index in practice-area stage list | `matter.matter_stage{name}`, `/matter_stages?practice_area` |
| SOL | date, days to/past, task status | `matter.statute_of_limitations`; tasks where `statute_of_limitations=true` → `status`, `due_at` |
| Value, specials | parse currency | CF "Estimated Case Value", "Medical Specials To Date" (currency type) |
| Limits | regex `\$[\d,]+ / \$[\d,]+` per line, label by line prefix | CF "Policy Limits" (text_area), "Policy Limits Confirmed" (checkbox) |
| Lien, wage | regex `\$[\d,]+(\.\d\d)?` | CF "Health Insurance or Lien Holder", "Wage Loss Claimed" |
| Underwater | value − per-person limit; limit/value % | above |
| Waterfall | limit − fee% × limit − spend − liens | above + fee % as explicit user input (not in Clio) |
| Firm spend | Σ `total` (or quantity×price); reimbursed flag | `/activities?type=ExpenseEntry` `date,quantity,price,total,note,billed` |
| Overdue / upcoming | status≠complete and due_at<today; due_at within 14d | tasks `status,due_at,name` |
| Upcoming events | start_at ≥ now | calendar_entries `start_at,summary` |
| Waiting on (category) | task name prefix `By medical provider: <name> -` → provider; regex "from client" → client; relationship description classifier → carrier/adverse | tasks `name`; relationships `description` |
| Per-contact silence | last inbound date, # outbound since, days | communications `date,type,senders[],receivers[]` matched to contact ids |
| Last client contact | max date where client id ∈ senders∪receivers; split phone/email, inbound/outbound | communications + `matter.client.id` |
| Request counts | count outbound comms to contact since last inbound | same (show computed count, not the text's "third request") |
| Duplicates | sha256(normalized body) collisions | communications `body` |
| Doc date drift | NYSCEF `FILED: ... MM/DD/YYYY` regex vs `received_at` | doc text layer page 1 + documents `received_at` |
| Since last opened | `updated_at > last_viewed_at` per user | every resource `updated_at` |
| Completeness | counts per resource; docs by text-layer chars/page; OCR status | sync tables |
| Provider list | relationships whose description matches /treating|hospital|provider/ + BOP-listed providers without contact | relationships `description`, contacts |
| Cost | Σ tokens × price per LLM call | own log |

LLM-only (must cite + quote-verify): story, top-10 ranking, contradictions, injuries, provider asks text, accident accounts.

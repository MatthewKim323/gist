// DEV FIXTURE ONLY (?fixture=1). An invented, generic case: every name, date and number below is
// made up for UI work and has nothing to do with any real matter.
import type { Citation, Digest } from "@/lib/types";
import type { SourcePayload } from "@/components/gist/source/types";

const c = (source_ref: string, label: string, quote?: string): Citation => ({ source_ref, label, quote });

const N1 = c("note:9001", "Note · Mar 15, 2024 · Intake call", "rear-ended at a red light on the expressway");
const E1 = c("email:9101", "Email · Apr 2, 2024 · Re: accident details", "I was merging when the van hit me from behind");
const D1 = c("doc:701#p3", "Police report p.3", "V2 struck V1 in the rear while V1 was stopped");
const D2 = c("doc:702#p12", "Lakeside Ortho records p.12", "MRI: partial-thickness tear, right rotator cuff");
const D3 = c("doc:702#p14", "Lakeside Ortho records p.14", "patient denies prior injury to the right shoulder");
const D4 = c("doc:703#p2", "Prior PCP chart p.2", "R shoulder pain x 3 weeks, referred to PT");
const D5 = c("doc:704#p1", "Declarations page p.1", "Bodily injury limit $100,000 each person");
const F1 = c("field:case_value", "Clio field · Case value", "280000");
const F2 = c("field:incident_date", "Clio field · Date of incident", "2024-03-14");
const X1 = c("expense:9301", "Expense · Filing fee", "Index number purchase");
const X2 = c("expense:9302", "Expense · Records", "Records retrieval, Lakeside Ortho");
const L1 = c("doc:705#p1", "Medicaid lien letter p.1", "conditional payment amount of $18,420.55");
const T1 = c("task:9401", "Task · Serve discovery responses", "Serve responses to defendant's demands");
const T2 = c("task:9402", "Task · Follow up with client on wage docs", "Need W-2s and employer letter");
const CAL1 = c("calendar:9501", "Calendar · Compliance conference", "Compliance conference, Part 12");
const CL1 = c("call:9601", "Call · Jun 30, 2026 · Client check-in", "Client says shoulder still locks at night");
const E2 = c("email:9102", "Email · Sep 28, 2026 · Records request", "Please send complete records and itemized bills");
const N2 = c("note:9002", "Note · Sep 30, 2026 · Defense counsel call", "Defense wants to schedule the IME for October");
const E3 = c("email:9103", "Email · Aug 11, 2026 · Coverage", "carrier says there may be an umbrella policy");
const N3 = c("note:9003", "Note · Feb 6, 2025 · Surgery consult", "recommends arthroscopic repair, right shoulder");
const V1 = c("calendar:9502", "Calendar · PT visit", "Physical therapy");

export const FIXTURE_DIGEST: Digest = {
  matter: {
    id: 1001,
    display_number: "00412-Reyes",
    client_name: "Jordan Reyes",
    photo_url: null,
    incident_date: { value: "2024-03-14", cites: [F2, N1] },
    days_since_incident: 932,
    stage: "Litigation",
    stage_since: "2025-11-02",
    responsible_attorney: "Dana Whitfield",
    clio_url: "https://app.clio.com/nc/#/matters/1001",
  },
  money: {
    case_value: { value: 280000, cites: [F1] },
    coverage_limit: { value: 100000, cites: [D5] },
    coverage_state: "conflicting",
    coverage_notes: [
      { value: "Primary auto policy, $100k per person", cites: [D5] },
      { value: "Possible umbrella policy, not confirmed", cites: [E3] },
    ],
    underwater: true,
    specials: { value: 64210, cites: [D2] },
    liens: [{ value: 18420.55, cites: [L1] }],
    firm_spend: { value: 3815.4, cites: [X1, X2] },
  },
  story: [
    { text: "Client was rear-ended while stopped at a red light on the expressway; police report puts fault on the other driver.", cites: [N1, D1] },
    { text: "Right shoulder MRI shows a partial-thickness rotator cuff tear; surgeon recommended arthroscopic repair in Feb 2025.", cites: [D2, N3] },
    { text: "A prior primary care chart notes right shoulder pain weeks before the crash, which the client denied at intake.", cites: [D4, D3] },
    { text: "Case value sits well above the $100k bodily injury limit; an umbrella policy is rumored but unconfirmed.", cites: [F1, D5, E3] },
    { text: "In litigation since Nov 2025; discovery responses are overdue and defense is pushing for an IME in October.", cites: [T1, N2] },
  ],
  phase: {
    current: "Litigation",
    next: "Trial",
    time_in_stage_days: 334,
    gates: [
      { requirement_key: "discovery.responses", phase: "Litigation", label: "Discovery responses served", status: "missing", owed_by: "firm", owed_by_contact_id: null, owed_by_name: "Firm", due_date: "2026-09-15", days_outstanding: 17, evidence: [T1], note: "Task open, past due", confidence: 0.94 },
      { requirement_key: "records.complete", phase: "Litigation", label: "Complete records, every provider", status: "partial", owed_by: "provider", owed_by_contact_id: 501, owed_by_name: "Lakeside Orthopedics", due_date: null, days_outstanding: 41, evidence: [D2, E2], note: "Records received only through Dec 2025", confidence: 0.88 },
      { requirement_key: "bills.itemized", phase: "Litigation", label: "Itemized bills, every provider", status: "missing", owed_by: "provider", owed_by_contact_id: 502, owed_by_name: "Harbor Physical Therapy", due_date: null, days_outstanding: 63, evidence: [E2], note: null, confidence: 0.91 },
      { requirement_key: "depositions.parties", phase: "Litigation", label: "Party depositions", status: "have", owed_by: null, owed_by_contact_id: null, owed_by_name: null, due_date: null, days_outstanding: null, evidence: [c("doc:706#p1", "EBT transcript p.1", "Examination before trial of plaintiff")], note: null, confidence: 0.97 },
      { requirement_key: "ime.report", phase: "Litigation", label: "IME report and rebuttal", status: "missing", owed_by: "defense", owed_by_contact_id: 601, owed_by_name: "Defense counsel", due_date: "2026-10-20", days_outstanding: null, evidence: [N2], note: "IME not yet scheduled", confidence: 0.86 },
      { requirement_key: "prior_injury", phase: "Litigation", label: "Prior injury history reconciled", status: "conflicting", owed_by: "client", owed_by_contact_id: null, owed_by_name: "Jordan Reyes", due_date: null, days_outstanding: null, evidence: [D3, D4], note: "Client denial vs prior chart", confidence: 0.9 },
      { requirement_key: "wage.loss", phase: "Litigation", label: "Wage loss documentation", status: "missing", owed_by: "client", owed_by_contact_id: null, owed_by_name: "Jordan Reyes", due_date: "2026-08-30", days_outstanding: 94, evidence: [T2], note: "Asked twice", confidence: 0.92 },
      { requirement_key: "expert.medical", phase: "Litigation", label: "Medical expert disclosure", status: "missing", owed_by: "firm", owed_by_contact_id: null, owed_by_name: "Firm", due_date: "2026-12-01", days_outstanding: null, evidence: [], note: null, confidence: 0.8 },
      { requirement_key: "coverage.confirmed", phase: "Litigation", label: "Coverage confirmed", status: "conflicting", owed_by: "carrier", owed_by_contact_id: null, owed_by_name: "Defendant's carrier", due_date: null, days_outstanding: 52, evidence: [D5, E3], note: "Umbrella policy unconfirmed", confidence: 0.83 },
    ],
  },
  red_flags: [
    {
      id: "rf1",
      title: "Prior right shoulder complaint vs intake denial",
      why_it_matters: "Defense will use the prior chart to argue the tear predates the crash. Get ahead of it before the IME.",
      severity: "high",
      claims: [
        { source_ref: "doc:702#p14", says: "Client denied any prior shoulder injury", quote: "patient denies prior injury to the right shoulder", date: "2024-04-09" },
        { source_ref: "doc:703#p2", says: "PCP treated right shoulder pain before the crash", quote: "R shoulder pain x 3 weeks, referred to PT", date: "2024-02-19" },
      ],
    },
    {
      id: "rf2",
      title: "Two accounts of how the crash happened",
      why_it_matters: "Stopped vs merging changes comparative fault. The police report backs the stopped version.",
      severity: "medium",
      claims: [
        { source_ref: "note:9001", says: "Stopped at a red light", quote: "rear-ended at a red light on the expressway", date: "2024-03-15" },
        { source_ref: "email:9101", says: "Merging when hit", quote: "I was merging when the van hit me from behind", date: "2024-04-02" },
        { source_ref: "doc:701#p3", says: "Police: V1 was stopped", quote: "V2 struck V1 in the rear while V1 was stopped", date: "2024-03-14" },
      ],
    },
  ],
  actions: [
    { id: "a1", label: "Serve discovery responses", bucket: "overdue", due_date: "2026-09-15", days: 17, owner: "firm", owner_name: "Dana Whitfield", cite: T1 },
    { id: "a2", label: "Wage loss docs from client", bucket: "overdue", due_date: "2026-08-30", days: 33, owner: "client", owner_name: "Jordan Reyes", cite: T2 },
    { id: "a3", label: "Compliance conference", bucket: "upcoming", due_date: "2026-10-09", days: 7, owner: "court", owner_name: "Part 12", cite: CAL1 },
    { id: "a4", label: "IME scheduling", bucket: "upcoming", due_date: "2026-10-20", days: 18, owner: "defense", owner_name: "Defense counsel", cite: N2 },
    { id: "a5", label: "Itemized bills", bucket: "waiting", due_date: null, days: 63, owner: "provider", owner_name: "Harbor Physical Therapy", cite: E2 },
    { id: "a6", label: "Records after Dec 2025", bucket: "waiting", due_date: null, days: 41, owner: "provider", owner_name: "Lakeside Orthopedics", cite: E2 },
    { id: "a7", label: "Umbrella policy answer", bucket: "waiting", due_date: null, days: 52, owner: "carrier", owner_name: "Defendant's carrier", cite: E3 },
  ],
  last_client_contact: { value: "2026-06-30", cites: [CL1] },
  since_last_opened: {
    at: "2026-09-24T17:20:00Z",
    items: [
      { label: "Defense wants the IME in October", kind: "note", cite: N2 },
      { label: "Records request sent to two providers", kind: "email", cite: E2 },
      { label: "Discovery task went overdue", kind: "task", cite: T1 },
    ],
  },
  injuries: [
    { label: "Partial-thickness rotator cuff tear", body_part: "Right shoulder", cites: [D2] },
    { label: "Cervical strain", body_part: "Neck", cites: [c("doc:702#p4", "Lakeside Ortho records p.4", "cervical strain, ROM limited")] },
    { label: "Post-traumatic headaches", body_part: "Head", cites: [c("doc:707#p2", "Neurology consult p.2", "headaches since the collision")] },
  ],
  providers: [
    {
      contact_id: 501, name: "Lakeside Orthopedics", role: "Orthopedic surgeon",
      first_visit: "2024-03-28", last_visit: "2025-12-10",
      visits: ["2024-03-28", "2024-04-09", "2024-06-20", "2024-10-02", "2025-02-06", "2025-05-14", "2025-12-10"].map((date) => ({ date, cite: D2 })),
      gaps: [{ from: "2025-05-14", to: "2025-12-10", days: 210 }],
      last_heard_from: "2026-08-22", open_asks: 1,
    },
    {
      contact_id: 502, name: "Harbor Physical Therapy", role: "Physical therapy",
      first_visit: "2024-04-15", last_visit: "2026-07-18",
      visits: ["2024-04-15", "2024-05-01", "2024-05-20", "2024-06-10", "2024-07-02", "2024-08-14", "2025-03-03", "2025-04-01", "2025-06-12", "2026-01-20", "2026-03-11", "2026-05-02", "2026-07-18"].map((date) => ({ date, cite: V1 })),
      gaps: [{ from: "2024-08-14", to: "2025-03-03", days: 201 }],
      last_heard_from: "2026-07-30", open_asks: 1,
    },
    {
      contact_id: 503, name: "Northside Neurology", role: "Neurology",
      first_visit: "2024-05-22", last_visit: "2024-11-19",
      visits: ["2024-05-22", "2024-08-07", "2024-11-19"].map((date) => ({ date, cite: c("doc:707#p2", "Neurology consult p.2", "headaches since the collision") })),
      gaps: [],
      last_heard_from: "2025-01-10", open_asks: 0,
    },
  ],
  top_facts: [],
  completeness: {
    entries_read: 186, entries_total: 186,
    pages_read: 312, pages_total: 312, pages_ocr: 241,
    facts_verified: 214, facts_rejected: 7, facts_review: 3,
  },
  cost: { cold_usd: 1.84, last_run_usd: 0, models: ["gpt-5.4-mini", "gpt-5.5", "jev-latest", "text-embedding-3-large"] },
  generated_at: "2026-10-02T17:42:00Z",
};

export const FIXTURE_REJECTED: { summary: string; reason: string }[] = [
  { summary: "Client returned to work full time in May 2024", reason: "Quote not found in source" },
  { summary: "Second MRI ordered for the left shoulder", reason: "Source says right shoulder" },
  { summary: "Defense offered $40,000", reason: "Jev: source says nothing" },
  { summary: "PT discharged the client", reason: "Quote not found in source" },
  { summary: "Police cited the client", reason: "Jev: contradicts source" },
  { summary: "Surgery was performed in March 2025", reason: "Jev: source says nothing" },
  { summary: "Lien amount is $21,000", reason: "Number not in quote" },
];

const LOREM_DOC = (quote: string, before: string, after: string) => `${before}\n\n${quote}.\n\n${after}`;

const FIXTURE_SOURCES: Record<string, Omit<SourcePayload, "ref">> = {
  "note:9001": { kind: "note", title: "Intake call", occurred_at: "2024-03-15", clio_url: null, body_text: "Spoke with Jordan by phone. States they were rear-ended at a red light on the expressway around 5:40 pm. Ambulance declined at scene, went to urgent care next morning. Complains of right shoulder and neck pain. Has photos of the van. No prior accidents per client." },
  "note:9002": { kind: "note", title: "Defense counsel call", occurred_at: "2026-09-30", clio_url: null, body_text: "Call with defense counsel. Defense wants to schedule the IME for October, will send dates. Reminded them our discovery responses are coming this week. They asked about the umbrella question again." },
  "note:9003": { kind: "note", title: "Surgery consult", occurred_at: "2025-02-06", clio_url: null, body_text: "Ortho consult summary from client: surgeon recommends arthroscopic repair, right shoulder. Client is nervous about time off work and wants to wait until after the summer." },
  "email:9101": { kind: "email", title: "Re: accident details", occurred_at: "2024-04-02", clio_url: null, body_text: "Hi, following up on your questions. I was merging when the van hit me from behind, it all happened fast. I have the photos on my phone and will send them tonight. Thanks, Jordan" },
  "email:9102": { kind: "email", title: "Records request", occurred_at: "2026-09-28", clio_url: null, body_text: "To the records department: Please send complete records and itemized bills for the above patient for all dates of service from March 2024 to present. A HIPAA authorization is attached." },
  "email:9103": { kind: "email", title: "Coverage", occurred_at: "2026-08-11", clio_url: null, body_text: "Adjuster called back. The carrier says there may be an umbrella policy through the defendant's employer but would not confirm the limit. Will follow up in writing." },
  "call:9601": { kind: "call", title: "Client check-in", occurred_at: "2026-06-30", clio_url: null, body_text: "Client says shoulder still locks at night. Still doing PT twice a month. Asked about timeline; explained discovery." },
  "task:9401": { kind: "task", title: "Serve discovery responses", occurred_at: "2026-09-15", clio_url: null, body_text: "Serve responses to defendant's demands for discovery and inspection. Due 9/15." },
  "task:9402": { kind: "task", title: "Follow up with client on wage docs", occurred_at: "2026-08-30", clio_url: null, body_text: "Need W-2s and employer letter confirming missed days. Asked in July and August." },
  "calendar:9501": { kind: "calendar", title: "Compliance conference", occurred_at: "2026-10-09", clio_url: null, body_text: "Compliance conference, Part 12, 9:30 am." },
  "calendar:9502": { kind: "calendar", title: "PT visit", occurred_at: null, clio_url: null, body_text: "Physical therapy, Harbor PT." },
  "expense:9301": { kind: "expense", title: "Filing fee", occurred_at: "2025-11-02", clio_url: null, body_text: "Index number purchase. $210.00" },
  "expense:9302": { kind: "expense", title: "Records", occurred_at: "2026-01-14", clio_url: null, body_text: "Records retrieval, Lakeside Ortho. $85.40" },
  "field:case_value": { kind: "field", title: "Case value", occurred_at: null, clio_url: null, body_text: "280000" },
  "field:incident_date": { kind: "field", title: "Date of incident", occurred_at: null, clio_url: null, body_text: "2024-03-14" },
};

const FIXTURE_DOCS: Record<string, { name: string; pages: number; text: Record<number, string> }> = {
  "701": { name: "Police accident report", pages: 4, text: { 3: LOREM_DOC("V2 struck V1 in the rear while V1 was stopped", "NARRATIVE: V1 eastbound in lane 2 at signalized intersection. Signal red for eastbound traffic.", "V2 driver states brakes did not respond in time. No injuries reported at scene. Photos taken.") } },
  "702": { name: "Lakeside Orthopedics records", pages: 40, text: {
    4: LOREM_DOC("cervical strain, ROM limited", "EXAM: Neck tender to palpation over paraspinals.", "Plan: PT 2x weekly."),
    12: LOREM_DOC("MRI: partial-thickness tear, right rotator cuff", "IMAGING REVIEW 06/20/2024.", "Recommend continued PT, consider surgical consult if no improvement in 8 weeks."),
    14: LOREM_DOC("patient denies prior injury to the right shoulder", "HISTORY: Patient reports pain since MVC on 3/14/2024.", "Occupation: warehouse lead. Right hand dominant."),
  } },
  "703": { name: "Prior PCP chart", pages: 6, text: { 2: LOREM_DOC("R shoulder pain x 3 weeks, referred to PT", "VISIT 02/19/2024. CC: shoulder pain after lifting at work.", "No imaging ordered. Follow up prn.") } },
  "704": { name: "Declarations page", pages: 2, text: { 1: LOREM_DOC("Bodily injury limit $100,000 each person", "POLICY PERIOD 01/01/2024 to 01/01/2025.", "Each accident limit $300,000. Property damage $50,000.") } },
  "705": { name: "Medicaid lien letter", pages: 2, text: { 1: LOREM_DOC("conditional payment amount of $18,420.55", "RE: Recovery of medical assistance payments.", "This amount may change as additional claims are processed.") } },
  "706": { name: "EBT transcript", pages: 88, text: { 1: LOREM_DOC("Examination before trial of plaintiff", "SUPREME COURT OF THE STATE OF NEW YORK.", "Taken at the offices of plaintiff's counsel.") } },
  "707": { name: "Neurology consult", pages: 5, text: { 2: LOREM_DOC("headaches since the collision", "HPI: Patient reports daily headaches", "Assessment: post-traumatic headache. Plan: follow up in 3 months.") } },
};

export function fixtureSource(ref: string): SourcePayload | null {
  const docMatch = ref.match(/^doc(?:ument)?:([^#]+)(?:#p(\d+))?$/);
  if (docMatch) {
    const d = FIXTURE_DOCS[docMatch[1]!];
    if (!d) return null;
    const page = docMatch[2] ? Number(docMatch[2]) : 1;
    return {
      ref, kind: "document", title: d.name, body_text: null, occurred_at: null, clio_url: null,
      doc: { id: docMatch[1]!, name: d.name, page, pages_total: d.pages, page_text: d.text[page] ?? null, pdf_url: null },
    };
  }
  const s = FIXTURE_SOURCES[ref];
  return s ? { ref, ...s } : null;
}

export function fixtureAnswer(q: string): { answer: string; cites: Citation[] } {
  const lq = q.toLowerCase();
  if (lq.includes("shoulder") || lq.includes("prior")) {
    return { answer: "The intake history says the client denied any prior right shoulder injury, but a primary care chart from about three weeks before the crash records right shoulder pain and a PT referral.", cites: [D3, D4] };
  }
  if (lq.includes("coverage") || lq.includes("policy") || lq.includes("limit")) {
    return { answer: "The declarations page shows a $100,000 per person bodily injury limit. An umbrella policy was mentioned by the carrier but never confirmed in writing.", cites: [D5, E3] };
  }
  return { answer: "The client was rear-ended in March 2024. The case is in litigation, discovery responses are overdue, and defense wants an IME in October.", cites: [N1, T1, N2] };
}

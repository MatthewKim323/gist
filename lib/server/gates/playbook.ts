import type { Owner, Phase } from "@/lib/types";

// Generic New York personal-injury playbook. Domain knowledge only: what a file typically needs before
// it can leave each phase. Nothing case-specific lives here; per-provider items are expanded at runtime
// from the matter's own treating-provider relationships.

export interface Requirement {
  key: string;                 // stable; per-provider items become '<key>.<contactId>'
  label: string;               // per-provider labels use {provider}
  owner: Owner;                // who typically owes it
  perProvider?: boolean;
  /** hybrid-search queries used to gather evidence ({provider} is substituted) */
  search: string[];
  /** fact event_key prefixes and kinds that count as evidence */
  eventKeys: string[];
  kinds?: string[];
  /** what "have" means, given to the gate checker and to Jev */
  have: string;
}

export const PLAYBOOK: Partial<Record<Phase, Requirement[]>> = {
  Intake: [
    { key: "intake.retainer", label: "Signed retainer agreement", owner: "client", search: ["retainer agreement signed", "engagement letter returned"], eventKeys: ["material.retainer", "intake"], have: "A signed retainer is on file or confirmed returned." },
    { key: "intake.hipaa", label: "HIPAA authorizations signed", owner: "client", search: ["HIPAA authorization signed", "medical authorization"], eventKeys: ["material.hipaa"], have: "Signed HIPAA authorizations are on file." },
    { key: "intake.letter_of_representation", label: "Letter of representation to the adverse carrier", owner: "firm", search: ["letter of representation", "claim number acknowledged by adjuster"], eventKeys: ["material.letter_of_representation", "coverage.claim"], kinds: ["coverage"], have: "LOR sent and a claim number assigned." },
    { key: "intake.notice_of_claim", label: "Notice of claim / presentation of claim (if a public entity is involved)", owner: "firm", search: ["notice of claim served", "presentation of claim public authority", "General Municipal Law 50-e", "Public Authorities Law"], eventKeys: ["material.notice_of_claim", "deadline.notice_of_claim"], kinds: ["deadline"], have: "Served within time, or the file shows no public entity is involved." },
    { key: "intake.no_fault", label: "No-fault application filed (NY Ins. Law 5102)", owner: "client", search: ["no-fault application NF-2", "no-fault claim number", "PIP benefits"], eventKeys: ["coverage.no_fault"], kinds: ["coverage"], have: "No-fault claim opened with a claim number." },
  ],
  Treatment: [
    { key: "treatment.records", label: "Complete medical records: {provider}", owner: "provider", perProvider: true, search: ["{provider} medical records received", "{provider} treatment notes", "{provider} office notes produced"], eventKeys: ["material.records", "treatment"], kinds: ["treatment", "material"], have: "Records through the most recent visit are on file. Partial if only through an earlier date or requests are outstanding." },
    { key: "treatment.bills", label: "Itemized bills / ledger: {provider}", owner: "provider", perProvider: true, search: ["{provider} itemized bill", "{provider} ledger CPT codes", "{provider} billing charges"], eventKeys: ["material.bills", "money.specials", "money.bill"], kinds: ["money", "material"], have: "An itemized bill or ledger with CPT lines covering treatment to date. Partial if only a total or bills 'to follow'." },
    { key: "treatment.mmi", label: "MMI / discharge or a costed future-care plan", owner: "provider", search: ["maximum medical improvement", "discharged from care", "future surgery recommended cost", "permanency narrative report"], eventKeys: ["treatment.mmi", "treatment.discharge", "treatment.future", "injury.permanency"], kinds: ["treatment"], have: "A provider states MMI/discharge, or a future-care plan with dates and costs is documented." },
    { key: "treatment.police_report", label: "Police accident report (MV-104 / precinct report)", owner: "firm", search: ["police accident report", "MV-104", "police report obtained"], eventKeys: ["material.police_report"], kinds: ["material"], have: "A copy of the police report is in the file." },
    { key: "treatment.photos", label: "Scene, vehicle and injury photographs", owner: "client", search: ["scene photographs", "photos of the vehicle damage", "injury photos"], eventKeys: ["material.photos"], kinds: ["material"], have: "Photos are in the file (not merely said to exist)." },
    { key: "treatment.wage_loss", label: "Wage-loss documentation (employer letter, tax returns, pay records)", owner: "client", search: ["lost wages documentation", "employer wage verification", "tax returns 1099 W-2", "commission records"], eventKeys: ["money.wage", "material.wage", "material.employment"], kinds: ["money", "material"], have: "Employer verification or tax/pay records covering the claimed period." },
    { key: "treatment.coverage", label: "Adverse coverage limits confirmed in writing", owner: "carrier", search: ["policy limits confirmed", "declarations page", "bodily injury limits", "excess umbrella coverage"], eventKeys: ["coverage"], kinds: ["coverage"], have: "Carrier confirmed BI limits in writing and excess/umbrella was asked about." },
    { key: "treatment.liability", label: "Liability evidence (witnesses, statements, scene investigation)", owner: "firm", search: ["witness statement", "liability investigation", "how the accident happened", "incident report"], eventKeys: ["liability", "accident", "witness"], kinds: ["liability", "witness", "event"], have: "Witnesses identified and contacted or statements on file; mechanism is consistent." },
    { key: "treatment.liens", label: "Liens identified and amounts confirmed (health insurer, Medicaid, Medicare)", owner: "carrier", search: ["lien asserted amount", "Medicaid lien", "Medicare conditional payment", "health insurer subrogation"], eventKeys: ["money.lien", "lien"], kinds: ["money"], have: "Every lienholder identified with a current amount." },
  ],
  Demand: [
    { key: "demand.specials_final", label: "Specials totaled and reconciled against provider ledgers", owner: "firm", search: ["medical specials total", "specials reconciled", "specials tally"], eventKeys: ["money.specials"], kinds: ["money"], have: "A specials total that ties to itemized provider bills." },
    { key: "demand.package", label: "Demand package served on the carrier", owner: "firm", search: ["demand package sent", "settlement demand letter", "time-limited demand"], eventKeys: ["material.demand", "status_change.demand"], kinds: ["status_change", "material"], have: "Demand letter sent with records and bills." },
    { key: "demand.response", label: "Carrier response or offer", owner: "carrier", search: ["settlement offer", "adjuster response to demand", "offer amount"], eventKeys: ["money.offer", "status_change.offer"], kinds: ["money", "status_change"], have: "An offer or written response to the demand is on file." },
  ],
  Negotiation: [
    { key: "negotiation.offer_history", label: "Offer / counteroffer history documented", owner: "firm", search: ["offer counteroffer", "negotiation history", "settlement authority"], eventKeys: ["money.offer"], kinds: ["money"], have: "Each offer and counter is recorded with a date." },
    { key: "negotiation.client_authority", label: "Client settlement authority", owner: "client", search: ["client authority to settle", "client approved settlement range"], eventKeys: ["strategy.authority"], kinds: ["strategy", "client_contact"], have: "Client's authority is documented." },
  ],
  Litigation: [
    { key: "litigation.pleadings", label: "Summons, complaint and answer on file", owner: "court", search: ["summons and complaint filed index number", "verified answer affirmative defenses"], eventKeys: ["material.pleading", "status_change.suit"], kinds: ["material", "status_change"], have: "Filed summons/complaint and the answer are in the file." },
    { key: "litigation.bill_of_particulars", label: "Verified bill of particulars served", owner: "firm", search: ["verified bill of particulars", "bill of particulars served"], eventKeys: ["material.bill_of_particulars"], kinds: ["material"], have: "Served BOP on file." },
    { key: "litigation.discovery_responses", label: "Discovery responses complete (both sides)", owner: "defense", search: ["response to demand for discovery", "discovery demands outstanding", "documents not produced objection"], eventKeys: ["material.discovery", "request.discovery"], kinds: ["material", "request"], have: "Both sides' responses served with no open deficiencies or objections." },
    { key: "litigation.party_depositions", label: "Party depositions (EBTs): plaintiff and defendants", owner: "defense", search: ["examination before trial plaintiff", "deposition of defendant driver", "EBT scheduled"], eventKeys: ["deadline.deposition", "material.deposition", "material.ebt"], kinds: ["deadline", "material"], have: "Transcripts on file or EBTs held." },
    { key: "litigation.witness_depositions", label: "Non-party witness depositions", owner: "firm", search: ["non-party witness deposition subpoena", "witness EBT"], eventKeys: ["witness", "material.subpoena"], kinds: ["witness", "material"], have: "Known witnesses deposed or the decision not to is documented." },
    { key: "litigation.ime_reports", label: "Defense IME reports received, with rebuttal", owner: "defense", search: ["independent medical examination report", "IME report findings", "rebuttal to IME"], eventKeys: ["material.ime", "ime"], kinds: ["material"], have: "All IME reports received and a treating-physician rebuttal planned or served." },
    { key: "litigation.expert_disclosures", label: "Expert disclosures (medical, economic) under CPLR 3101(d)", owner: "firm", search: ["expert witness disclosure 3101(d)", "economic expert retained", "medical expert report"], eventKeys: ["material.expert", "strategy.expert"], kinds: ["material", "strategy"], have: "Medical and, where wage loss is claimed, economic experts disclosed." },
    { key: "litigation.motions", label: "Outstanding motions resolved (compel, preclude, summary judgment)", owner: "court", search: ["motion to compel", "motion pending", "compliance conference order"], eventKeys: ["material.motion", "deadline.motion", "status_change.court"], kinds: ["deadline", "material"], have: "No undecided motions, or the plan for each is documented." },
    { key: "litigation.final_specials", label: "Final specials with updated bills", owner: "provider", search: ["updated specials", "final medical bills", "outstanding provider balances"], eventKeys: ["money.specials", "material.bills"], kinds: ["money"], have: "Specials updated through the present from itemized bills." },
    { key: "litigation.future_care", label: "Future surgery / care scheduled and costed", owner: "provider", search: ["surgery scheduled date", "future surgery cost estimate", "recommended surgery"], eventKeys: ["treatment.future", "treatment.surgery"], kinds: ["treatment"], have: "Any recommended procedure has a date or a documented cost and life-care basis." },
    { key: "litigation.note_of_issue", label: "Note of issue / certificate of readiness", owner: "firm", search: ["note of issue filed", "certificate of readiness", "trial calendar"], eventKeys: ["status_change.note_of_issue", "deadline.note_of_issue"], kinds: ["status_change", "deadline"], have: "Note of issue filed after discovery closed." },
  ],
  Trial: [
    { key: "trial.exhibits", label: "Trial exhibits and certified records", owner: "firm", search: ["certified medical records trial", "exhibit list"], eventKeys: ["material.exhibit"], kinds: ["material"], have: "Certified records and exhibit list ready." },
    { key: "trial.witnesses", label: "Trial witnesses and treating doctors confirmed", owner: "firm", search: ["trial subpoena doctor", "witness availability trial"], eventKeys: ["witness"], kinds: ["witness"], have: "Witness list confirmed with availability." },
  ],
  Disbursement: [
    { key: "disbursement.lien_payoffs", label: "Final lien payoff letters", owner: "carrier", search: ["final lien amount", "lien payoff letter", "lien reduction"], eventKeys: ["money.lien"], kinds: ["money"], have: "Written final amount for every lien." },
    { key: "disbursement.closing_statement", label: "Signed closing statement", owner: "client", search: ["closing statement signed", "settlement distribution"], eventKeys: ["material.closing_statement"], kinds: ["material"], have: "Client-signed closing statement." },
  ],
};

export interface ExpandedRequirement extends Omit<Requirement, "perProvider"> {
  phase: Phase;
  provider_contact_id: number | null;
  provider_name: string | null;
}

/** Requirements to exit the current phase plus every earlier phase's (re-checked: still unmet ones surface). */
export function requirementsFor(current: string, providers: { id: number; name: string }[]): ExpandedRequirement[] {
  const phases = PHASES_ORDER;
  const idx = Math.max(0, phases.findIndex((p) => p.toLowerCase() === current.toLowerCase()));
  const out: ExpandedRequirement[] = [];
  for (const phase of phases.slice(0, idx + 1)) {
    for (const r of PLAYBOOK[phase] ?? []) {
      const { perProvider, ...rest } = r;
      if (perProvider) {
        for (const p of providers) {
          const sub = (s: string) => s.replaceAll("{provider}", p.name);
          out.push({ ...rest, phase, key: `${r.key}.${p.id}`, label: sub(r.label), search: r.search.map(sub), provider_contact_id: p.id, provider_name: p.name });
        }
      } else out.push({ ...rest, phase, provider_contact_id: null, provider_name: null });
    }
  }
  return out;
}

const PHASES_ORDER: Phase[] = ["Intake", "Treatment", "Demand", "Negotiation", "Litigation", "Trial", "Disbursement", "Closed"];

// Deterministic letters built in code from gate fields. Used when the model is unavailable (no key,
// no credits, 429) or when a model draft fails the disclosure check. Only facts the recipient already
// owes or knows go in: item labels, dates of service, request dates. Never gate notes (they carry the
// firm's internal read of the case), never value, coverage or settlement position. New York practice.
import type { ActionKind } from "./types";

export interface DraftItem {
  label: string;
  due_date: string | null;
  days_outstanding: number | null;
}

export interface DraftInput {
  kind: ActionKind;
  recipient_name: string;
  client_name: string;
  matter_ref: string;            // display number
  attorney: string | null;
  incident_date: string | null;  // pretty
  items: DraftItem[];
  /** provider dates of service window, pretty */
  service_from: string | null;
  service_to: string | null;
  /** prior written requests to this recipient that went unanswered (pretty dates, oldest first) */
  prior_requests: string[];
  last_heard: string | null;     // pretty
  respond_by: string;            // pretty
}

/** "Complete medical records: Acme PT" -> "complete medical records" when the recipient is Acme PT. */
export function itemPhrase(label: string, recipient: string): string {
  let s = label.replace(/\s*\([^)]*\)\s*$/, "");
  const i = s.indexOf(":");
  if (i > 0 && recipient && s.slice(i + 1).trim().toLowerCase() === recipient.toLowerCase()) s = s.slice(0, i);
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function bullets(d: DraftInput): string {
  return d.items.map((it) => `  - ${cap(itemPhrase(it.label, d.recipient_name))}`).join("\n");
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function priorLine(d: DraftInput): string {
  const [first, ...rest] = d.prior_requests;
  if (!first) return "";
  if (!rest.length) return `We first wrote about this on ${first} and have not yet received what we need. `;
  const times = rest.length === 1 ? "once" : rest.length === 2 ? "twice" : `${rest.length} times`;
  const when = rest.length > 3 ? `most recently on ${rest[rest.length - 1]}` : `on ${rest.join(", ").replace(/, ([^,]*)$/, " and $1")}`;
  return `We first wrote about this on ${first} and followed up ${times}, ${when}, and have not yet received what we need. `;
}

const ORG_RE = /\b(llc|pllc|p\.?c\.?|inc|corp|center|centre|hospital|therapy|offices?|group|medical|clinic|associates|imaging|radiology|services|health)\b/i;
const providerSalutation = (name: string) => (ORG_RE.test(name) ? `Dear ${name} records department,` : `Dear ${name},`);

function signoff(d: DraftInput): string {
  return `Thank you,\n${d.attorney ?? "[Attorney name]"}`;
}

export function templateDraft(d: DraftInput): { subject: string; body: string; channel: "email" | "letter" } {
  const re = `Re: ${d.client_name}${d.incident_date ? `, date of incident ${d.incident_date}` : ""} (our file ${d.matter_ref})`;
  const first = d.items[0] ? itemPhrase(d.items[0].label, d.recipient_name) : "outstanding items";
  switch (d.kind) {
    case "records_request": {
      const dos = d.service_from && d.service_to ? `for dates of service from ${d.service_from} through the present (our file currently runs through ${d.service_to})`
        : d.service_from ? `for dates of service from ${d.service_from} through the present` : "for all dates of service through the present";
      return {
        channel: "email",
        subject: `${d.prior_requests.length ? "Follow-up: " : ""}Records request for ${d.client_name}`,
        body: [
          providerSalutation(d.recipient_name),
          re,
          `This office represents ${d.client_name}, your patient. ${priorLine(d)}Please send the following ${dos}:`,
          bullets(d),
          `A HIPAA-compliant authorization signed by the patient is on file with this office and can be resent on request. Under New York Public Health Law Section 18, copy charges may not exceed $0.75 per page; please include an invoice if a fee applies.`,
          `We would appreciate the records by ${d.respond_by}. If anything is holding this up, a quick reply with what you need from us would help.`,
          signoff(d),
        ].join("\n\n"),
      };
    }
    case "client_followup":
      return {
        channel: "email",
        subject: `Quick check-in: ${first}`,
        body: [
          `Hi ${d.client_name.split(/\s+/)[0]},`,
          `Hope you are doing alright. We are pulling your file together for the next step and there ${d.items.length > 1 ? "are a few things" : "is one thing"} we still need from you:`,
          bullets(d),
          `Whatever you have is fine to start, even photos of paperwork from your phone. If something is hard to get, just tell us and we will figure out another way to get it.`,
          `Could you send what you can by ${d.respond_by}? Call or reply any time with questions.`,
          signoff(d),
        ].join("\n\n"),
      };
    case "defense_demand":
      return {
        channel: "letter",
        subject: `${d.client_name}: outstanding discovery`,
        body: [
          `Dear Counsel,`,
          re,
          `I write in a good-faith effort to resolve the following outstanding discovery without motion practice, consistent with 22 NYCRR 202.7 and 202.20-f. ${priorLine(d)}The following remains outstanding:`,
          bullets(d),
          `Please provide complete responses, or let me know a date certain by which you will, no later than ${d.respond_by}. If you contend any item is not discoverable, please say so in writing so we can narrow what is in dispute. Absent a response, we will ask the Court for relief, including an order under CPLR 3124.`,
          `I am available to confer by phone at your convenience.`,
          `Very truly yours,\n${d.attorney ?? "[Attorney name]"}`,
        ].join("\n\n"),
      };
    case "carrier_followup":
      return {
        channel: "email",
        subject: `${d.client_name}: request for confirmation`,
        body: [
          `Dear ${d.recipient_name},`,
          re,
          `${priorLine(d)}To keep this file moving, please confirm the following in writing:`,
          bullets(d),
          `If a current itemization or final amount is not yet available, please tell us when it will be and who is handling it on your end.`,
          `We would appreciate a response by ${d.respond_by}.`,
          signoff(d),
        ].join("\n\n"),
      };
    default:
      return {
        channel: "email",
        subject: `Follow up: ${first}`,
        body: [`To do on ${d.client_name} (${d.matter_ref}):`, bullets(d), `Target: ${d.respond_by}.`].join("\n\n"),
      };
  }
}

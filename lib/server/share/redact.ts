import "server-only";

// Deterministic redaction. Runs before the Jev gate on every outgoing string, so identifiers never
// even reach the classifier. Patterns are generic; nothing case-specific lives here.

const PATTERNS: { re: RegExp; to: string }[] = [
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, to: "[SSN]" },
  { re: /\b(?:ssn|social security(?: number| no\.?)?)\s*[:#]?\s*\d{9}\b/gi, to: "[SSN]" },
  {
    re: /\b(?:dob|d\.o\.b\.|date of birth|born(?: on)?)\s*[:#]?\s*(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]+\.? \d{1,2},? \d{4})/gi,
    to: "[DOB]",
  },
  { re: /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, to: "[phone]" },
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, to: "[email]" },
  { re: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Ct|Court|Pl|Place|Way)\b\.?/g, to: "[address]" },
  { re: /\b(?:policy|claim|account|acct)\s*(?:no\.?|number|#)\s*[:#]?\s*[A-Z0-9-]{5,}\b/gi, to: "[account no.]" },
];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface RedactContext {
  clientName: string | null;
  clientInitials: string;
  terms: string[];
}

export function redactText(text: string, ctx: RedactContext): string {
  let out = text;
  for (const p of PATTERNS) out = out.replace(p.re, p.to);
  if (ctx.clientName) {
    const full = ctx.clientName.trim();
    if (full) out = out.replace(new RegExp(escapeRe(full), "gi"), ctx.clientInitials);
    for (const part of full.split(/[\s,]+/).filter((p) => p.length >= 3)) {
      out = out.replace(new RegExp(`\\b${escapeRe(part)}\\b`, "gi"), ctx.clientInitials);
    }
  }
  for (const t of ctx.terms) {
    if (!t) continue;
    out = out.replace(new RegExp(escapeRe(t), "gi"), "[redacted]");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return "Patient";
  const parts = name.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (!parts.length) return "Patient";
  return parts.slice(0, 3).map((p) => `${p[0]!.toUpperCase()}.`).join("");
}

const GENERIC = new Set([
  "the", "and", "of", "for", "dr", "md", "do", "pc", "llc", "pllc", "inc", "group", "center", "centre",
  "medical", "medicine", "health", "healthcare", "hospital", "clinic", "physical", "therapy", "care",
  "associates", "practice", "services", "orthopedic", "orthopedics", "ortho", "chiropractic", "chiro",
  "sports", "pain", "management", "imaging", "radiology", "rehab", "rehabilitation", "spine", "surgery",
  "office", "offices", "doctor", "doctors", "provider", "surgeon", "surgical", "orthopaedic", "orthopaedics", "physician", "physicians", "partners", "facility", "diagnostic", "treating", "new", "york", "east", "west", "north", "south", "pt",
]);

/** Distinctive words in a provider name, used to tell one provider's items from another's. */
export function nameTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  return Array.from(
    new Set(
      name
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, " ")
        .split(/[\s-]+/)
        .map((t) => t.replace(/'s$/, ""))
        .filter((t) => t.length >= 4 && !GENERIC.has(t)),
    ),
  );
}

export function mentionsAny(text: string | null | undefined, tokens: string[]): boolean {
  if (!text || !tokens.length) return false;
  const lc = text.toLowerCase();
  return tokens.some((t) => new RegExp(`\\b${escapeRe(t)}\\b`).test(lc));
}

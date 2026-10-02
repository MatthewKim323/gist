// Finds a quote inside a body of text, tolerant of whitespace, case and curly quotes.
// Returns [start, end) in the ORIGINAL text, or null.

function norm(ch: string): string {
  if (/\s/.test(ch)) return " ";
  if (ch === "‘" || ch === "’") return "'";
  if (ch === "“" || ch === "”") return '"';
  return ch.toLowerCase();
}

function normalizeWithMap(text: string): { s: string; map: number[] } {
  let s = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = norm(text[i]!);
    if (c === " " && s.endsWith(" ")) continue;
    s += c;
    map.push(i);
  }
  return { s, map };
}

function normQuote(q: string): string {
  return normalizeWithMap(q.trim()).s.replace(/[.,;:]+$/, "");
}

export function findQuote(text: string, quote: string | null | undefined): [number, number] | null {
  if (!text || !quote) return null;
  const { s, map } = normalizeWithMap(text);
  const q = normQuote(quote);
  if (!q) return null;
  const tryFind = (needle: string): [number, number] | null => {
    if (needle.length < 8) return null;
    const at = s.indexOf(needle);
    if (at < 0) return null;
    return [map[at]!, map[at + needle.length - 1]! + 1];
  };
  const exact = tryFind(q);
  if (exact) return exact;
  // Fall back to the longest run of leading or trailing words that does match.
  const words = q.split(" ");
  for (let n = words.length - 1; n >= 3; n--) {
    const head = tryFind(words.slice(0, n).join(" "));
    if (head) return head;
    const tail = tryFind(words.slice(words.length - n).join(" "));
    if (tail) return tail;
  }
  return null;
}

export function splitOnQuote(text: string, quote: string | null | undefined): { before: string; match: string; after: string } | null {
  const r = findQuote(text, quote);
  if (!r) return null;
  return { before: text.slice(0, r[0]), match: text.slice(r[0], r[1]), after: text.slice(r[1]) };
}

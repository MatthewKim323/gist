// Minimal markdown for the white paper: headings, paragraphs, lists, fenced code, tables, block quotes,
// bold/italic/inline code/links, and `<!-- eval:ID -->` markers that the page swaps for live results.
// The source is our own committed file; text is still HTML-escaped before inline formatting.

export type Block =
  | { t: "h"; level: number; html: string; id: string }
  | { t: "p"; html: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "code"; text: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "quote"; html: string }
  | { t: "hr" }
  | { t: "eval"; id: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function inline(src: string): string {
  const codes: string[] = [];
  let s = src.replace(/`([^`]+)`/g, (_, c: string) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t: string, u: string) => {
    const safe = /^(https?:|\/|#)/.test(u) ? u : "#";
    const ext = /^https?:/.test(safe) ? ' target="_blank" rel="noreferrer"' : "";
    return `<a href="${safe}"${ext}>${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${esc(codes[Number(i)])}</code>`);
}

const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const ev = /^<!--\s*eval:([a-z0-9_]+)\s*-->$/.exec(line.trim());
    if (ev) { out.push({ t: "eval", id: ev[1] }); i++; continue; }
    if (/^<!--/.test(line.trim())) { while (i < lines.length && !lines[i].includes("-->")) i++; i++; continue; }
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push({ t: "code", text: buf.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { out.push({ t: "h", level: h[1].length, html: inline(h[2]), id: slug(h[2]) }); i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push({ t: "hr" }); i++; continue; }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line).map(inline);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]).map(inline));
      out.push({ t: "table", head, rows });
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += " " + lines[i++].trim();
        items.push(inline(item));
      }
      out.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ t: "quote", html: inline(buf.join(" ")) });
      continue;
    }
    const buf: string[] = [];
    while (
      i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|<!--)/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !lines[i].trim().startsWith("|")
    ) buf.push(lines[i++].trim());
    out.push({ t: "p", html: inline(buf.join(" ")) });
  }
  return out;
}

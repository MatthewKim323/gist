// Provider-facing "Case updates" from autopilot: plain-English moves (stage changes) with a date, newest first.
// Pure render so it works inside the server share page and the client preview alike.
import { fmtDate } from "@/lib/server/share/plain";
import "@/app/styles/gist-autopilot.css";

export interface CaseMove {
  message: string;
  created_at: string;
}

export default function CaseMoves({ items }: { items: CaseMove[] }) {
  if (!items.length) return null;
  return (
    <div className="gap-moves" aria-label="Case updates">
      <div className="gs-k">Case updates</div>
      <ul>
        {items.map((u, i) => (
          <li key={`${u.created_at}-${i}`} className={i === 0 ? "is-new" : ""}>
            <span className="gap-moves__date">{fmtDate(u.created_at, { month: "short", day: "numeric" })}</span>
            <span>{u.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

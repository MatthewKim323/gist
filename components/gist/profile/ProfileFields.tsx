"use client";
// The editable profile fields, shared by sign-in (new profile) and /profile (edit).
export interface Fields {
  display_name: string;
  email: string;
  title: string;
  firm_name: string;
}

const FIRM_TITLES = ["Attorney", "Paralegal", "Case manager", "Office manager"];
const PROVIDER_TITLES = ["Billing", "Front desk", "Office manager", "Provider"];

export default function ProfileFields({
  role,
  value,
  onChange,
  office,
}: {
  role: "firm" | "provider";
  value: Fields;
  onChange: (v: Fields) => void;
  /** Provider office, shown read-only. */
  office?: string | null;
}) {
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  const titles = role === "firm" ? FIRM_TITLES : PROVIDER_TITLES;
  return (
    <div className="gp-form">
      <label className="gp-field">
        <span className="gp-label">Your name</span>
        <input className="gp-input" value={value.display_name} onChange={set("display_name")} placeholder="Full name" autoComplete="name" required />
      </label>
      <label className="gp-field">
        <span className="gp-label">Email</span>
        <input className="gp-input" type="email" value={value.email} onChange={set("email")} placeholder="name@office.com" autoComplete="email" />
      </label>
      <div className="gp-field gp-field--full">
        <span className="gp-label">Title</span>
        <div className="gp-titles" role="radiogroup" aria-label="Title">
          {titles.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={value.title === t}
              className={`gp-pill${value.title === t ? " is-on" : ""}`}
              onClick={() => onChange({ ...value, title: value.title === t ? "" : t })}
            >
              {t}
            </button>
          ))}
        </div>
        <input className="gp-input" value={value.title} onChange={set("title")} placeholder="Or type your own" aria-label="Title" />
      </div>
      {role === "firm" ? (
        <label className="gp-field gp-field--full">
          <span className="gp-label">Firm name</span>
          <input className="gp-input" value={value.firm_name} onChange={set("firm_name")} placeholder="Shown to providers you share with" autoComplete="organization" />
        </label>
      ) : (
        <label className="gp-field gp-field--full">
          <span className="gp-label">Office</span>
          <input className="gp-input" value={office ?? ""} readOnly />
        </label>
      )}
    </div>
  );
}

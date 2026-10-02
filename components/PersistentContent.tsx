import SceneSignIn from "@/components/gist/auth/SceneSignIn";
// Persistent home/contact content: sits outside <main> like the source; HomeContact pulls
// .js-view-projects-btn and .js-contact-content into its CSS3D layer.
const EMAIL = "founders@kalilabs.ai";

// First tab is selected on load (its section overlays the in-flow one).
const CONTACT_TABS = [
  { key: "email", label: "Email" },
  { key: "elsewhere", label: "Elsewhere" },
];

const SOCIALS = [{ label: "GitHub", href: "https://github.com/MatthewKim323/gist" }];

// The home scene still mounts this container into its CSS3D layer, so it stays, just empty.
const HOME_SOCIALS: { label: string; icon: string; href: string }[] = [];

function SocialIcon({ name }: { name: string }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.9 };
  const glyph: Record<string, React.ReactNode> = {
    github: (
      <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.9 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22l-.01 3.29c0 .32.22.7.83.57A12 12 0 0 0 12 .3Z" />
    ),
    linkedin: (
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z" />
    ),
    x: (
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z" />
    ),
    devpost: (
      <path d="M6.002 1.61 0 12l6.002 10.39h11.996L24 12 17.998 1.61H6.002Zm1.593 2.76h4.71c4.27 0 7.13 3.11 7.13 7.63 0 4.52-2.86 7.63-7.13 7.63h-4.71V4.37Zm2.83 2.76v9.74h1.88c2.71 0 4.3-1.87 4.3-4.87 0-3-1.59-4.87-4.3-4.87h-1.88Z" />
    ),
    mail: (
      <g {...stroke}>
        <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
        <path d="m3 6 9 6.5L21 6" />
      </g>
    ),
    resume: (
      <g {...stroke}>
        <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5l-5-5Z" />
        <path d="M14 2.5v5h5M8.5 13h7M8.5 17h5" />
      </g>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {glyph[name]}
    </svg>
  );
}

function ArrowLabel({ children }: { children: React.ReactNode }) {
  return (
    <span>
      <span>
        <span>{"\u2BA1\u00A0\u00A0"}</span>
      </span>
      {children}
    </span>
  );
}

export function PersistentContent() {
  return (
    <div className="d-none">

      <div className="home-socials js-home-socials" style={{ visibility: "hidden" }}>
        {HOME_SOCIALS.map((l) => (
          <a
            key={l.label}
            href={l.href}
            aria-label={l.label}
            title={l.label}
            target={l.href.startsWith("http") ? "_blank" : undefined}
            rel={l.href.startsWith("http") ? "noreferrer" : undefined}
            className="home-socials__link js-manager-ignore"
            data-router-disabled=""
            data-cursor="hide"
          >
            <SocialIcon name={l.icon} />
          </a>
        ))}
      </div>
      
      <div className="js-view-projects-btn" style={{ visibility: "hidden", display: "flex", gap: "1.6rem", justifyContent: "center" }}>
        <a href="/matter" title="Open the case" className="btn btn--regular btn--fill btn--light js-manager-ignore js-btn" data-btn="fill" data-cursor="hide">
          <span className="btn__inner js-btn-inner">
            <span className="btn__content js-btn-content">
              <span className="d-flex flex-row items-end">
                <span className="btn__text">
                  Open the case
                </span>
                <svg className="btn__icon d-inline-block js-btn-icon">
                  <use href="#arrow"></use>
                </svg>
              </span>
            </span>
          </span>
        </a>
        {/* full page load into the role picker (firm or provider) */}
        <a href="/contact" title="Sign in" style={{ marginLeft: "1.25rem" }} className="btn btn--regular btn--fill btn--light js-manager-ignore js-btn" data-btn="fill" data-cursor="hide">
          <span className="btn__inner js-btn-inner">
            <span className="btn__content js-btn-content">
              <span className="d-flex flex-row items-end">
                <span className="btn__text">Sign in</span>
                <svg className="btn__icon d-inline-block js-btn-icon">
                  <use href="#arrow"></use>
                </svg>
              </span>
            </span>
          </span>
        </a>
      </div>
      
      <div className="w-1/1 w-auto@sm js-contact-content" style={{ visibility: "hidden" }}>
        {/* the contact scene is the sign-in: the camera turns here from the landing (toContact) */}
        <div className="d-flex flex-column flex-row@sm items-center@sm mt-8 mt-0@sm pb-5 pb-0@sm">
          <div className="d-flex flex-column items-center items-end@sm mr-2@sm">
            <div className="mb-2 | js-reveal-anim">
              <h2 className="t-center t-right@sm t-5 t-6@sm t-lh-0.9 mb-0">
                <span className="d-block t-serif t-normal t-ls-tighter t-italic">Who&apos;s opening</span>
                <span className="d-block t-serif t-normal t-ls-tighter t-italic">the case?</span>
              </h2>
            </div>
            <div className="d-flex justify-end t-center t-right@sm t-uppercase t-lh-1.3 | js-reveal-anim">
              <p className="t-0.9 mb-0">one case, two sides<br /> each sees only what is theirs</p>
            </div>
          </div>
          <div className="mt-1 mt-0@sm | js-reveal-anim">
            <SceneSignIn />
          </div>
        </div>
      </div>
    </div>
  );
}

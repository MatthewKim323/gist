# Roles (firm vs treating provider)

Demo-grade sign-in: roles are picked on `/signin`, not password-protected. The pick is written to a
signed httpOnly cookie `gist_session` (HMAC-SHA256, secret `GIST_SESSION_SECRET` or the Supabase
service key) and enforced on the server by `proxy.ts` and `requireRole()`.

| route | who |
|---|---|
| `/signin` | public. Firm -> `/matter?view=digest`; provider picks an office -> `/provider` |
| `/provider` | provider session only (else -> `/signin`). Cases this office is on, rendered with the firm's latest live share config, or the conservative default |
| `/matter`, `/s/compose`, `/pipeline-preview` | provider session -> redirect to `/provider` |
| `/api/matter/**`, `/api/ask`, `/api/similar`, `/api/pipeline`, `/api/sync`, `/api/docs/**`, `/api/clio/**`, `/api/share/**` | provider session -> 403 |
| `/`, `/s/<token>` | always public |
| no session | reaches everything (keeps the judge/demo flow working) |

Profiles (table `profiles`, migration 0005): sign-in picks a recent profile ("Continue as") or creates one.
The cookie carries `profileId`. `/profile` views and edits it; the chip menu has Profile, Your cases, Switch account, Sign out.

API: `GET /api/auth/session` (session + profile), `POST {profileId}` (continue as),
`POST {role:"firm", display_name, email?, title?, firm_name?}`, `POST {role:"provider", providerContactId, display_name, email?, title?}`,
`DELETE` (sign out). `GET/PATCH /api/profile` (own profile; role and office are read-only).

Firm name shown to providers: `withFirmName(view, share.created_by)` in `lib/server/share/firm.ts` (sharing profile, then latest firm profile, then `GIST_FIRM_NAME`).

## Session chip

```tsx
import SessionChip from "@/components/gist/auth/SessionChip";
<SessionChip />   // fetches /api/auth/session; renders nothing when signed out
```

## Landing "Sign in" entry (for the owner of components/PersistentContent.tsx)

Same markup as "Open the case" (or `<Button href="/signin" arrow>Sign in</Button>` from components/gist/ui/Button); drop it next to that button. `data-router-disabled` makes it a full
page load so the engine router does not try a contextual transition to an unknown route.

```tsx
<a href="/signin" title="Sign in" data-router-disabled
   className="btn btn--regular btn--fill btn--light js-manager-ignore js-btn" data-btn="fill" data-cursor="hide">
  <span className="btn__inner js-btn-inner">
    <span className="btn__content js-btn-content">
      <span className="d-flex flex-row items-end">
        <span className="btn__text">Sign in</span>
        <svg className="btn__icon d-inline-block js-btn-icon"><use href="#arrow"></use></svg>
      </span>
    </span>
  </span>
</a>
```

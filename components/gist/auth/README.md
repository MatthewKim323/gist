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

API: `GET /api/auth/session` (who am I), `POST {role:"firm"}` or `{role:"provider", providerContactId}`,
`DELETE` (sign out).

## Session chip

```tsx
import SessionChip from "@/components/gist/auth/SessionChip";
<SessionChip />   // fetches /api/auth/session; renders nothing when signed out
```

## Landing "Sign in" entry (for the owner of components/PersistentContent.tsx)

Same markup as "Open the case"; drop it next to that button. `data-router-disabled` makes it a full
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

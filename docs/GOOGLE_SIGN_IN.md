# Google Sign-In — production setup

Status: **the code is done** (login and self-registration with Google, student
profile created on first sign-in). What is missing is configuration only —
nothing on AWS, no code change, no database change.

## How it works

| Layer | What it does | Config it needs |
|---|---|---|
| Frontend (`frontend/src/lib/useGoogleIdentity.ts`) | Loads Google Identity Services and shows "Continue with Google" on `/login` and `/register` **only if** the client ID is present at build time | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (baked into the bundle by the CI build) |
| Backend (`backend/accounts/views.py` → `GoogleLoginView`, `POST /api/auth/google/`) | Verifies the Google `id_token`, returns JWTs; first sign-in creates the user + student profile (first/last name from Google, language from the UI locale) | `GOOGLE_OAUTH2_CLIENT_ID` in `.env.prod` |

Both values are the **same string** (the OAuth client ID, e.g.
`123456789-abc.apps.googleusercontent.com`). The client secret is **not** used
(ID-token flow), so nothing secret is stored.

Today in production neither is set: `POST /api/auth/google/` answers
`{"detail": "Google login not configured"}` and the button is hidden.

## Steps

### 1. Create the OAuth client (Google Cloud Console — anyone with a Google account)

1. https://console.cloud.google.com → create/select a project (e.g. "No Under 40").
2. **APIs & Services → OAuth consent screen**: External, app name "No Under 40",
   support email, authorised domain `danzaclassicanounder40.com`, publish the
   app (while "Testing" only listed test users can sign in).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorised JavaScript origins:
     - `https://danzaclassicanounder40.com`
     - `https://www.danzaclassicanounder40.com` (if the www host is served)
     - `http://localhost` (optional, for local testing)
   - Authorised redirect URIs: none needed (Google Identity Services popup flow).
4. Copy the **Client ID**.

### 2. Backend — `.env.prod` on the EC2 host

```
GOOGLE_OAUTH2_CLIENT_ID=<client id>
```

then restart the `django` service (the next deploy also picks it up).

### 3. Frontend — GitHub Actions secret

Repository → Settings → Secrets and variables → Actions → **New repository secret**:

```
NEXT_PUBLIC_GOOGLE_CLIENT_ID = <client id>
```

`.github/workflows/ci.yml` already passes it as a build arg
(`NEXT_PUBLIC_GOOGLE_CLIENT_ID=${{ secrets.NEXT_PUBLIC_GOOGLE_CLIENT_ID }}`).
A new build is required for the frontend to pick it up: push to `develop`
or re-run the last "Build and deploy to EC2" workflow.

### 4. Verify

- `https://danzaclassicanounder40.com/it/login` shows "Continua con Google".
- `curl -s -X POST https://danzaclassicanounder40.com/api/auth/google/ -H 'Content-Type: application/json' -d '{"id_token":"x"}'`
  answers `{"detail": "invalid Google token"}` (configured) instead of
  `"Google login not configured"`.
- Sign in with a Google account that has no No Under 40 account: a student
  profile is created and the welcome email (if written in HQ > Emails) is sent.

## Notes

- A Google account whose email already exists on the platform (any role)
  simply logs into that account — no duplicate is created.
- Local `.env` has both variables empty on purpose; put the same client ID
  there (with `http://localhost` as an authorised origin) to test locally.

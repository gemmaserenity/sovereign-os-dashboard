# Sovereign OS Dashboard — Deploy Guide

**Account**: Gemma's Cloudflare (`gorokhoff.gemma@gmail.com` / `02b2ede6803f6eca7402286c0e6c3cac`)  
Run the Cloudflare account-verification skill before any wrangler command.

---

## Step 1 — Supabase migration (Project A)

Open [Supabase SQL Editor → jjeqijptbfutrziykoff](https://supabase.com/dashboard/project/jjeqijptbfutrziykoff/sql) and run:

```
supabase/migration.sql
```

This creates: `sovdash_revenue_forecast`, `sovdash_tasks`, `sovdash_actions` (all with service_role RLS policies).

---

## Step 2 — Create KV namespace

```bash
wrangler kv:namespace create SOVDASH_KV
```

Copy the returned `id` and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SOVDASH_KV"
id = "PASTE_ID_HERE"
```

---

## Step 3 — Deploy to Cloudflare Pages

```bash
wrangler pages deploy public --project-name sovereign-os-dashboard
```

On first deploy, Wrangler creates the project automatically under Gemma's account.

---

## Step 4 — Set all secrets

Set these in the CF Dashboard → Pages → sovereign-os-dashboard → Settings → Environment Variables (mark each as **Secret**):

| Secret name | Value | Required |
|---|---|---|
| `SETUP_CODE` | Any strong string (used for first-time password creation) | ✅ |
| `SUPABASE_A_URL` | `https://jjeqijptbfutrziykoff.supabase.co` | ✅ |
| `SUPABASE_A_SERVICE_KEY` | Project A service role key (sb_secret_...) | ✅ |
| `SUPABASE_B_URL` | `https://mverztarzypogdyugtei.supabase.co` | ✅ |
| `SUPABASE_B_SERVICE_KEY` | Project B service role key | ✅ |
| `ANTHROPIC_API_KEY` | Anthropic API key (for Action Input routing) | ✅ |
| `STRIPE_SECRET_KEY` | AI Advisory Stripe restricted key | Optional (revenue panel shows $0 if absent) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Optional (calendar shows placeholder if absent) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Optional |
| `GOOGLE_REFRESH_TOKEN` | OAuth refresh token for gorokhoff.gemma@gmail.com | Optional |

---

## Step 5 — Create passwords (first-time setup)

Once deployed, run these two curl commands (or use any HTTP client):

```bash
# Create Gemma's password
curl -X POST https://sovereign-os-dashboard.pages.dev/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"gemma","password":"YOUR_GEMMA_PASSWORD","setup_code":"YOUR_SETUP_CODE"}'

# Create Sascha's password
curl -X POST https://sovereign-os-dashboard.pages.dev/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"sascha","password":"YOUR_SASCHA_PASSWORD","setup_code":"YOUR_SETUP_CODE"}'
```

After this, disable or remove the `SETUP_CODE` secret — the setup endpoint returns 409 if credentials already exist, but removing the secret adds extra security.

---

## Step 6 — Custom domain (optional)

In CF Dashboard → Pages → sovereign-os-dashboard → Custom Domains:
- Suggested: `dash.gemmaserenity.com` or `os.gemmaserenity.com`

---

## Step 7 — Google Calendar OAuth (optional, for Calendar panel)

1. In [Google Cloud Console](https://console.cloud.google.com): create OAuth credentials for a Web Application.
2. Add `https://sovereign-os-dashboard.pages.dev` as an authorized redirect URI.
3. Run the OAuth flow once to get a refresh token for `gorokhoff.gemma@gmail.com` (scope: `https://www.googleapis.com/auth/calendar.readonly`).
4. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` as secrets.

Simplest way to get the refresh token: use the [Google OAuth Playground](https://developers.google.com/oauthplayground/) with your credentials.

---

## Open items to confirm before/during build

| Item | Status |
|---|---|
| AI Advisory Stripe account — create + get restricted API key | Pending — dashboard shows $0 until set |
| `origin_url` for Revenue panel — confirm Stripe dashboard URL | Currently set to mailer URL as placeholder |
| Custom domain choice | Confirm `dash.gemmaserenity.com` or similar |
| NEXT (next.themanifestingqueen.com) task table schema | Tasks panel currently uses `sovdash_tasks` only; NEXT integration is Phase 2 |
| Confirm pastel color assignments are correct | Verified in preview — adjust in `style.css` `:root` vars if needed |

---

## File structure

```
sovereign-os-dashboard/
├── wrangler.toml                        CF Pages config + KV binding
├── supabase/
│   └── migration.sql                   Run in Project A SQL editor
├── functions/api/
│   ├── _lib/crypto.js                  PBKDF2 auth + session utils
│   ├── _lib/supabase.js                Supabase REST helper
│   ├── auth/login.js                   POST /api/auth/login
│   ├── auth/logout.js                  POST /api/auth/logout
│   ├── auth/setup.js                   POST /api/auth/setup (first-time only)
│   ├── auth/status.js                  GET  /api/auth/status
│   ├── dashboard.js                    GET  /api/dashboard (all panel data)
│   ├── tasks.js                        GET/POST/PATCH /api/tasks
│   ├── actions.js                      GET/POST/PATCH /api/actions
│   └── forecast.js                     GET/POST/DELETE /api/forecast
└── public/
    ├── index.html                      SPA shell (login + dashboard)
    ├── style.css                       All styles (light + dark mode)
    ├── app.js                          Dashboard logic + 30s polling
    ├── manifest.json                   PWA manifest
    └── sw.js                           Service worker (offline shell cache)
```

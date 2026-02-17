# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Repo overview
ResumeTower has two main parts:

- `web/`: React + TypeScript + Vite frontend (Tailwind + shadcn/ui) that authenticates users via Supabase Auth and displays jobs/resumes/cover letters.
- `supabase/`: Supabase project (Postgres schema migrations + Edge Functions) used for auth, storage, and background Gmail polling.

Product requirements and intended architecture are captured in `docs/PRD.md`.

## Common commands

### Frontend (`web/`)
From repo root:

```sh
cd web
npm ci
```

Run dev server (Vite):

```sh
cd web
npm run dev
```

Build / preview prod bundle:

```sh
cd web
npm run build
npm run preview
```

Lint:

```sh
cd web
npm run lint
# optionally: npm run lint -- --fix
```

Notes:
- There is currently no test runner configured in `web/package.json`.
- Vite sets the app origin used elsewhere (see Supabase auth config) to `http://127.0.0.1:5173`.

### Supabase (`supabase/`)
This repo is laid out like a standard Supabase CLI project (config at `supabase/config.toml`, migrations under `supabase/migrations/`). Typical workflows:

Start/stop the local Supabase stack:

```sh
supabase start
supabase stop
supabase status
```

Reset local DB and re-apply migrations:

```sh
supabase db reset
```

Edge Functions:
- The main function is `supabase/functions/gmail-poller`.
- Local dev is typically done with `supabase functions serve`.

Configuration note: `supabase/config.toml` enables DB seeding via `./seed.sql`, but `supabase/seed.sql` is not present in this repo currently.

## Environment variables / configuration

### Frontend env
`web/src/lib/supabase.ts` expects:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

See `web/.env.example`.

### Supabase / Edge Function env
Google OAuth credentials are expected to be available to Supabase Auth and the Edge Function:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Supabase auth redirect configuration for local dev is in `supabase/config.toml`:
- site URL: `http://127.0.0.1:5173`
- callback route used by the web app: `/auth/callback`

## High-level architecture

### Frontend routing + app shell
- Entry: `web/src/main.tsx` mounts `App`.
- `web/src/App.tsx` uses React Router and a nested layout:
  - `Layout` (`web/src/components/layout/Layout.tsx`) renders `Sidebar`, `Header`, and an `<Outlet />`.
  - Routes:
    - `/` → `Dashboard`
    - `/settings` → `Settings`
    - `/job/:id` → `JobDetail`
    - `/auth/callback` → `AuthCallback`

Path alias: Vite maps `@` → `web/src` (see `web/vite.config.ts`).

### Auth + Google (Gmail) integration flow
Primary files:
- `web/src/contexts/AuthContext.tsx`: wraps the app, manages Supabase session state, and triggers Google OAuth login.
- `web/src/pages/AuthCallback.tsx`: on `SIGNED_IN`, persists Google provider tokens into the DB.

Flow:
1. User clicks “Connect Gmail” in `Settings` → `signInWithGoogle()` triggers `supabase.auth.signInWithOAuth()` requesting Gmail read scope and offline access.
2. After OAuth, user lands on `/auth/callback`.
3. `AuthCallback` extracts `session.provider_token` and `session.provider_refresh_token` and upserts them into `public.user_integrations`.

### Background processing: Gmail → Jobs
Primary files:
- `supabase/functions/gmail-poller/index.ts`: Edge Function that polls Gmail using refresh tokens and writes to DB.

Flow (current implementation):
1. Edge Function queries `public.user_integrations` for rows where `provider = 'google'`.
2. For each integration, it refreshes an access token via Google’s OAuth token endpoint.
3. It searches Gmail for unread job-related messages and inserts new rows into:
   - `public.jobs`
   - `public.resumes` (currently mocked)
   - `public.cover_letters` (currently mocked)

### Data model (migrations)
Schema lives in `supabase/migrations/`:
- `public.jobs`: core job records (status: prepared/applied/rejected/interview)
- `public.resumes` + `public.cover_letters`: generated artifacts tied to a job
- `public.base_profile`: per-user JSON profile for future resume generation
- `public.user_integrations`: stores per-user OAuth tokens for background polling

Row Level Security (RLS) is enabled with policies scoped by `auth.uid()` in the migrations.

## Where to make common changes
- Gmail polling logic + parsing: `supabase/functions/gmail-poller/index.ts`
- Supabase table changes / RLS policies: add a new SQL file under `supabase/migrations/`
- Supabase client configuration: `web/src/lib/supabase.ts`
- Auth/login UX: `web/src/contexts/AuthContext.tsx` and `web/src/pages/AuthCallback.tsx`
- Dashboard queries/rendering: `web/src/pages/Dashboard.tsx`

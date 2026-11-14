# RECORDS

J-POP music city web platform. This repo is the Phase 1 foundation: a landing page ported from the MUJI / Kinfolk draft, plus a Supabase-ready Postgres schema. It is not a streaming service.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build
npm start
```

Landing styles live in `app/globals.css` (design tokens from draft B). Sections are in `components/landing/`. Album covers are designed placeholders; all catalog names are example data.

SQL migrations are in `supabase/migrations/`. They are not applied automatically. After a Supabase project exists, run them there.

## Cloudflare deploy

The app is prepared for Cloudflare Workers via `@opennextjs/cloudflare`. Log in with Wrangler when you are ready, then:

```bash
npm run deploy
```

That runs `opennextjs-cloudflare build && opennextjs-cloudflare deploy`.

The Worker name in `wrangler.jsonc` is `records` (account `a1994605882614d0dc50a1e72ba9bdc3`). Public catalog env (`NEXT_PUBLIC_SUPABASE_URL` and the anon key) is set in `wrangler.jsonc` `vars` so it is available at runtime, and is also read from `.env.local` during `opennextjs-cloudflare build`. Do not add `ADMIN_PASSWORD` or `SUPABASE_SERVICE_ROLE_KEY` to the Worker; ingest and admin review do not need them at runtime.

Live URL: https://records.records-web.workers.dev/

Preview the Worker locally after a Cloudflare build:

```bash
npm run preview
```

## Music data ingestion

Seed J-POP candidates from MusicBrainz (1 request/second, never auto-approved):

```bash
# Optional: set SUPABASE_SERVICE_ROLE_KEY in untracked .env.local to insert directly.
# Otherwise the script writes SQL/JSON under scripts/.output/ for a review insert.
npm run ingest:musicbrainz
```

Copy `.env.example` to `.env.local` and add the project's URL and publishable/anon key. Do not commit service-role keys.

Admin review (approve / reject / merge) lives at `/admin/candidates` and requires `profiles.role = 'admin'`.

Admin bulk-approve (unique candidates only; ambiguous rows stay in review):

```bash
npm run approve:unique
```

Or use the button on `/admin/candidates`.

YouTube mappings are taken only from MusicBrainz URL relations (no scraping):

```bash
npm run ingest:mb-youtube
```

Catalog routes: `/search`, `/artist/[id]`, `/album/[id]`, `/song/[id]`.

## Walkie (Phase 4)

Sign up or log in at `/signup` and `/login`. Walkie lives at `/walkie` and is private to the signed-in user (RLS). Save a song from a song, album, or search page, or from the dock player. Tests:

```bash
npm test
```

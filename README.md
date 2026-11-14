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

The Worker name in `wrangler.jsonc` is `records`. Change it if your existing Cloudflare project uses a different Workers name (the project is referred to as RECORDS). Do not add bindings or secrets until those resources exist.

Preview the Worker locally after a Cloudflare build:

```bash
npm run preview
```

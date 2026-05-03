# Mnazilona

Monorepo containing the four sub-projects that make up the Mnazilona / Alma smart-home product.

```
Mnazilona-DEV/
├── landing-page/                 Public marketing site (Next.js, port 3002)
├── admin-dashboard/              Internal admin console (Next.js, port 3001)
├── MnazilonaApp/                 Mobile app (React Native)
├── ESP32 C6/                     Device firmware (Arduino / ESP-IDF)
└── backend-production-ready-copy/  HTTP + MQTT backend (port 3000)
```

The `landing-page/` and `admin-dashboard/` projects are two **independent**
Next.js apps. They were previously mixed inside `admin-dashboard/` and have been
split so each can be developed, built, and deployed on its own.

## Running locally

Each sub-project has its own `package.json` and is installed/run independently.

### Landing page

```bash
cd landing-page
npm install
npm run dev          # http://localhost:3002
```

Routes: `/`, `/blog`, `/blog/[slug]`, `/contact`, `/privacy`, `/terms`.

No backend dependency — blog posts are mock data in `src/lib/posts.ts`.

### Admin dashboard

```bash
cd admin-dashboard
npm install
npm run dev          # http://localhost:3001
```

Routes: `/admin`, `/admin/login`, `/admin/(dashboard)/...`. Visiting `/`
redirects to `/admin`.

Requires the backend running. Configure `NEXT_PUBLIC_API_URL` in
`admin-dashboard/.env` (defaults to `http://localhost:3000`).

### Backend

```bash
cd backend-production-ready-copy
# see its own README
```

### Mobile app & firmware

See `MnazilonaApp/README.md` and `ESP32 C6/` for setup.

## Branding

Both web apps display the same product name (`Alma` / `ألما`). The branding
constants live in each app's own `src/config/site.ts` — they are intentionally
duplicated to keep the two apps independent. Update both files when changing
the brand name, contact email, or store URLs.

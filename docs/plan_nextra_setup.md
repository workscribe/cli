# Nextra Setup Plan — Landing Page Repo

Documentation lives at `workscribe.co/docs` inside the landing page repo, powered by Nextra (Next.js docs framework).

---

## Install

```bash
npm install next react react-dom nextra nextra-theme-docs
```

---

## `next.config.mjs`

```js
import nextra from 'nextra'

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.jsx',
})

export default withNextra({
  // existing Next.js config here
})
```

---

## `theme.config.jsx`

Controls the docs sidebar, logo, footer, and SEO.

```jsx
import { useRouter } from 'next/router'

export default {
  logo: (
    <span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
      workscribe
    </span>
  ),
  project: {
    link: 'https://github.com/workscribe/cli',
  },
  docsRepositoryBase: 'https://github.com/workscribe/cli',
  useNextSeoProps() {
    const { asPath } = useRouter()
    return {
      titleTemplate: asPath === '/' ? 'Workscribe Docs' : '%s — Workscribe',
    }
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="Workscribe — your work, automatically documented." />
      <link rel="icon" href="/favicon.ico" />
    </>
  ),
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
  footer: {
    text: (
      <span>
        MIT {new Date().getFullYear()} ©{' '}
        <a href="https://workscribe.co" target="_blank">Workscribe</a>
      </span>
    ),
  },
  primaryHue: 199,       // matches teal accent from V6 wordmark
  primarySaturation: 60,
  darkMode: true,        // default to dark — matches site design
}
```

---

## File Structure

After running `npm run sync-docs -- ../workscribe-landing-page` from the CLI repo:

```
pages/
  index.tsx                   ← landing page
  docs/
    _meta.json                ← sidebar order and labels (maintained in landing page repo)
    getting-started.md
    commands.md
    configuration.md
    providers.md
    privacy.md
    troubleshooting.md
```

---

## `pages/docs/_meta.json`

Controls sidebar navigation order. Maintained in the landing page repo — not synced from the CLI repo.

```json
{
  "getting-started": "Getting Started",
  "commands": "Commands",
  "configuration": "Configuration",
  "providers": "AI Providers",
  "privacy": "Privacy & Security",
  "troubleshooting": "Troubleshooting"
}
```

**Update this file whenever a new doc page is added via `sync-docs`.**

---

## Routing

With the Next.js pages router, routing is automatic:

| File | URL |
|---|---|
| `pages/index.tsx` | `workscribe.co` |
| `pages/docs/getting-started.md` | `workscribe.co/docs/getting-started` |
| `pages/docs/commands.md` | `workscribe.co/docs/commands` |

No extra routing config needed. Landing page and docs coexist in the same Next.js project.

---

## `package.json` scripts

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start"
}
```

---

## Syncing docs from the CLI repo

Doc content lives in `docs/site/` in the CLI repo and is synced to the landing page repo via:

```bash
# From the CLI repo
npm run sync-docs -- ../workscribe-landing-page

# Or with env var
DOCS_REPO=../workscribe-landing-page npm run sync-docs
```

This copies all `.md` files from `docs/site/` into `pages/docs/` in the landing page repo.

**After syncing — checklist:**
- [ ] If a new page was added, update `pages/docs/_meta.json` in the landing page repo
- [ ] Run `npm run dev` and verify the new page appears in the sidebar
- [ ] Commit both the synced files and any `_meta.json` changes

---

## Notes

- `_meta.json` is the only file that must be maintained manually in the landing page repo — everything else comes from `sync-docs`
- Nextra v2 (pages router) is used here, not v3 (app router) — simpler to coexist with a marketing landing page
- `primaryHue: 199` approximates the teal from the V6 wordmark — adjust once the exact hex is confirmed from the designer

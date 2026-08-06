# Design Plan — workscribe.co

## Status

**Wordmark: decided — V6 (see below).**
Color and typography direction chosen. Formal brief not yet written but creative direction is locked enough to begin building.

---

## Wordmark — V6 (Chosen)

After reviewing six variants, **V6** is the chosen mark.

**Description:**
- Lowercase `workscribe` in a bold NeoGeometric sans-serif
- Deep navy (`#1a2744`)
- Single purposeful detail: the dot on the `i` is replaced with a small teal/cyan rightward-pointing triangle caret (`▶`) — directly referencing a terminal prompt cursor or text insertion point
- No other letter modifications — all other characters are standard unmodified NeoGeometric forms
- Single color throughout except the accent caret

**Why V6 won:**
- Lowercase feels CLI-native — you type `workscribe`, not `WORKSCRIBE`
- The cursor caret on `i` is semantically precise — anyone who uses a terminal immediately reads it
- Single accent detail with clear meaning — not decorative, not arbitrary
- Clean enough to scale down to favicon size (the caret survives at small sizes better than the ring or dots from earlier variants)

**Variants reviewed and why they were set aside:**

| Variant | Detail | Reason not chosen |
|---|---|---|
| V1 | Lowercase, `o` as ring | Ring concept good but less semantically specific than a cursor |
| V2 | All caps, stacked `E` + K accent | All caps too corporate; K accent arbitrary |
| V3 | Mixed case, floating dots | Mixed case unresolved; dots disappear at small sizes |
| V4 | All caps, stacked `E` + cursor `i` | Best caps version but all caps still too formal |
| V5 | Lowercase, stacked `e` | Lost the cursor detail; stacked `e` less distinctive at lowercase size |
| V6 ✓ | Lowercase, cursor caret on `i` | Lowercase + purposeful single detail + clean palette |

**Assets needed from this mark:**
- SVG export (light and dark versions)
- Favicon using the cursor caret `▶` as standalone glyph at 16×16, 32×32, 64×64
- OG image: wordmark on dark background with tagline

---

---

## Reference Landing Pages (Founder Favourites)

| Site | What to take from it |
|---|---|
| getearlybird.ai | Dark background confidence, feature animations showing real UI, repetitive CTAs, clean sans-serif type |
| mermaid.js.org | Developer-first authenticity, minimal nav, technical credibility without over-designing, code blocks as design elements |
| chatgpt.com/codex | (Inaccessible during review — assume: dark, minimal, terminal/code aesthetic, premium feel) |

**Common thread across all three:** Dark backgrounds. Minimal chrome. Code or terminal output used as the hero visual. Direct, low-hype copy.

---

## Creative Direction

### Concept: `the quiet tool`

Workscribe is passive — it does not interrupt, demand attention, or ask for input. The design should reflect this. Not loud. Not feature-list heavy. Calm, precise, and confident.

Developer tools that age well (curl, git, htop) don't shout. The site should feel like it was made by engineers who use their own product daily.

**Mood:** Dark terminal. Focused. Purposeful. Like a well-configured Neovim setup.

---

## Color Direction

The V6 wordmark anchors the palette. The deep navy and teal caret are now the brand colors — the site palette extends from those.

### Primary Palette

| Role | Value | Notes |
|---|---|---|
| Brand navy | `#1a2744` | From the wordmark — primary brand color |
| Brand accent | `#5bc4d4` (approx) | Teal caret from the `i` — used sparingly |
| Background | `#0d1117` | Near-black with a navy undertone — harmonises with the wordmark |
| Surface / cards | `#161b27` | Slightly lifted panels |
| Border | `#252d3d` | Subtle separation |
| Primary text | `#e8eaf0` | Off-white with a cool/blue cast to match the navy |
| Muted text | `#6b7a99` | Secondary copy, captions |
| CTA button | `#1a2744` bg, `#e8eaf0` text — or inverted | Primary CTA |
| CTA hover | `#5bc4d4` accent border or bg tint | Subtle teal on interaction |
| Code blocks | `#0a0e17` bg, `#c9d1e0` text | Darker than page, feels like a real terminal |

**Rationale:** The wordmark is navy — the site should feel like one coherent system, not a navy logo floating on an unrelated dark background. A dark navy-tinted background (`#0d1117`) bridges the two. The teal accent appears only where the caret appears — in CTAs, highlights, and interactive states. Used sparingly it retains its meaning.

### Light Mode (if required)

| Role | Value |
|---|---|
| Background | `#f5f7fa` |
| Surface | `#ffffff` |
| Primary text | `#1a2744` (brand navy as text) |
| Accent | `#5bc4d4` |
| Code blocks | `#eef0f5` bg |

> Default to dark. Light mode only if explicitly required — a terminal tool defaulting to light mode is a mismatch.

---

## Typography Direction

> Pending formal brief.

### Recommended pairing

| Role | Font | Notes |
|---|---|---|
| Headings | **Geist** or **Inter** (700) | Both are clean geometric sans — developer-native (Vercel uses Geist) |
| Body | **Inter** (400/450) | Industry standard for readability |
| Code / terminal | **Geist Mono** or **JetBrains Mono** | Monospace that feels intentional, not default |

**Why not a display/editorial font?** Workscribe is a terminal tool. A quirky display font would feel like a mismatch. The typography should feel like an extension of the terminal environment — precise, functional, legible.

**Scale (draft, desktop):**
| Element | Size | Weight |
|---|---|---|
| Hero headline | 56–64px | 700 |
| Section headline | 36–40px | 600 |
| Body | 16–18px | 400 |
| Code | 14px | 400 (mono) |
| Captions / labels | 13px | 400, muted |

---

## Layout Principles

1. **Max content width: 1100px** — centered, with generous side padding. Don't stretch to full viewport.
2. **Vertical rhythm** — consistent spacing units (8px base). Sections breathe.
3. **No carousels on desktop** — show features in grids, not hidden carousels. Mermaid.js does this well.
4. **Terminal blocks as hero visuals** — the product lives in the terminal. Show the terminal. No abstract illustrations.
5. **One primary CTA per section** — don't compete with yourself. Each section has one job.
6. **Mobile-first** — single column stacks cleanly. Terminal blocks scroll horizontally on small screens.

---

## Iconography

- Use simple line icons (Lucide or Phosphor icon sets) — consistent stroke weight
- No blob illustrations, no isometric 3D, no gradient orbs
- Small icons paired with feature tiles only — not decorative
- Terminal cursor `▋` or `$` prompt can be used as a decorative motif in headings or dividers

---

## Terminal Block Design

The terminal block is the centrepiece of the site — it needs to look authentic.

**Anatomy:**
```
┌─────────────────────────────────────────┐
│ ● ● ●   workscribe summary              │  ← title bar with traffic lights
├─────────────────────────────────────────┤
│ $ workscribe summary                    │
│                                         │
│ ## chronicle (main) — 3h 10m            │
│ - Implemented weekly summary            │
│ - Fixed project name resolution         │
│ - Added Slack webhook support           │
└─────────────────────────────────────────┘
```

- Background: `#0a0a0a`
- Traffic lights: decorative only (red/yellow/green circles)
- Prompt `$`: accent green
- Heading `##`: slightly brighter white
- Bullets: standard off-white
- Subtle scanline or grain texture: optional, adds depth without gimmick
- Border: `1px solid #2a2a2a` with `border-radius: 8px`

---

## Assets to Create

| Asset | Description | Priority | Status |
|---|---|---|---|
| Wordmark — dark bg version | V6 on `#0d1117` background, exported SVG | High | Pending |
| Wordmark — light bg version | V6 on white/`#f5f7fa`, exported SVG | High | Pending |
| Favicon | Teal cursor caret `▶` glyph alone, 16×16 / 32×32 / 64×64 | High | Pending |
| OG image | 1200×630, dark bg, V6 wordmark + tagline "Your work, automatically documented." | High | Pending |
| Terminal demo blocks | Static HTML/CSS terminal blocks for hero and showcase section | High | Pending |
| Feature icons | 6× Lucide or Phosphor line icons for feature grid | Medium | Pending |
| Provider logos | Anthropic, OpenAI, Ollama wordmarks / logos (sourced, not created) | Medium | Pending |
| Animated terminal (optional) | Typewriter effect on hero terminal block | Low | Pending |

---

## What to Avoid

- Gradient mesh backgrounds
- Abstract SaaS illustrations (people on laptops, cloud icons)
- Bright purple/violet (over-saturated in the current SaaS landscape)
- Comic or quirky fonts
- Full-bleed video heroes
- Excessive micro-animations
- Light mode as the default for a terminal tool

---

## Open Questions for Design Brief

1. ~~Is there an existing logo or wordmark?~~ — **Resolved: V6 chosen**
2. Dark-only site, or dark default with light mode toggle?
3. Is there a launch date driving timeline for the site?
4. Will there be a blog / changelog section, or keep it purely marketing for now?
5. Exact teal hex value from the V6 source file — need from the designer to lock the accent color precisely
6. Does the wordmark need a stacked version (icon above text) for square contexts like social avatars?

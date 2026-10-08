# Design reference

How to use the HTML demo when building screens.

## The rule

The demo is the **visual and behavioural reference**: layout, spacing, colours, wording, what
happens when you click. It is **not code to copy.** It is a prototype with inline styles, fake
in-memory data, a custom template runtime, and AI calls made from the browser. Build every
screen as real React components using the design tokens and shared components.

Where the demo and the docs disagree, **the docs win**. Deliberate differences are listed per
screen in `scope-v1.md`.

## The files

| File | What it is |
|---|---|
| `design/originals/Chairside Demo v3 (offline).html` | The original clickable demo. Open it in a browser to see and click the design. A compressed bundle: do not try to read its source. |
| `design/originals/Architecture Explorer (1).html` | The original architecture plan. Its content has been carried into `docs/architecture/`. |
| `design/unpacked/chairside-demo.html` | **Readable copy of the demo** (markup, then data and logic). Read this, by line range. |
| `design/unpacked/architecture-explorer.html` | Readable copy of the architecture plan. Rarely needed. |
| `design/unpacked/unpack.mjs` | Re-creates the readable copies if the design is exported again. |

**Read by line range.** The readable demo is 2,150 lines; never load all of it. The line
numbers below are stable as long as the file is not regenerated.

## Screen index (`design/unpacked/chairside-demo.html`)

The markup uses a small template language: `{{ name }}` is a value, `<sc-for>` is a loop,
`<sc-if>` is a condition. The matching values are computed in the logic section.

| Screen | Markup lines | Logic lines | Built in |
|---|---|---|---|
| Sidebar / navigation | 24–58 | 2085–2088 | E00-T04b |
| Today | 62–213 | 1783–1810 | E01-T10, then E02, E05, E06 add panels |
| Calendar: header and day view | 215–283 | 1812–1847 | E01-T04 |
| Calendar: week view | 284–314 | 1835–1845 | E01-T07 |
| Patients list | 316–347 | 1849–1858 | E01-T02a |
| Patient profile | 348–446 | 1860–1880, 1690–1719 | E01-T03, then later epics |
| Automations: rule list and editor | 455–529 | 1882–1897 | E05-T08 |
| Automations: care plans | 530–569 | 1995–2003 | E05-T03 |
| Automations: aftercare library | 570–611 | 2004–2010 | E06-T04 |
| Automations: to review | 612–634 | 1966–1972 | E06-T08 |
| Import: steps 1–4 | 637–745 (steps at 651, 666, 683, 717) | 1899–1910 | E04-T04 to T08 |
| Settings: clinic / staff / hours / channels | 746–799 (tabs at 753, 758, 770, 779) | 1912–1919 | E01-T08, E01-T09, E04-T02, E03-T06 |
| Visit ("In the chair"): pick patient | 804–858 | 2024–2034 | E06-T03 (reduced, see scope) |
| Visit: chart and treatment recording | 859–976 | 2035–2078 | **Not in v1** except the "When you finish" idea |
| Visit: finished summary | 977–996 | 1658–1686 | E06-T03 (reduced) |
| Patient phone: demo frame and tabs | 999–1024 | 1921–1935, 2011–2019 | Demo only |
| Patient phone: SMS and email mock-ups | 1025–1075 | 1484 (`mailOf`), 2011–2012 | Text reference for templates |
| Patient page: clinic header + appointment | 1076–1093 | 1921–1930 | E02-T09 |
| Patient page: pick a new time | 1094–1111 | 1931 | E02-T10 (changed to a request form) |
| Patient page: cancel | 1112–1124 | 1932 | E02-T09 |
| Patient page: result (confirmed / cancelled) | 1125–1133 | 1927–1930 | E02-T09 |
| Patient page: treatment plan | 1134–1149 | 1934 | v1.1 |
| Patient page: aftercare | 1150–1168 | 1484 (`mailOf`) | E06-T09 |
| Patient page: aligner progress | 1169–1190 | 2020–2023 | v1.1 |
| Drawer: appointment details | 1197–1258 | 1937–1957, 1720–1727 | E01-T06, E02-T12 |
| Drawer: aftercare review | 1259–1322 | 1975–1994 | E06-T08 |
| Drawer: new appointment | 1323–1362 | 1958–1964, 2116–2135 | E01-T05 |
| Toast | 1364–1366 | 1615 (`flash`) | E00-T04c |

Useful data in the logic section:

| What | Lines |
|---|---|
| Status names and colours (`ST`) | 1377–1385 |
| Care plans (names, intervals, reminder wording) | 1406–1412 |
| Aftercare library texts (six treatments) | 1422–1459 |
| Treatment types and default durations (`TREAT`) | 1518 |
| Rule names, descriptions and default message texts | 1574–1599 |
| Import field list and sample columns | 1600–1601 |

These texts are good seed and default content. They are in English with US formats; treat
them as wording reference, not as final copy.

## Design tokens

Take these from the demo and define them once (Tailwind theme / CSS variables) in E00-T04a.
Never hard-code a colour in a component. They are in `src/app/globals.css`, with the few this list
lacks (text on primary, links, focus, errors, small text; the sidebar's navigation colours,
captions and small upper-case labels, E00-T04b; the toast's colours, radius, shadow and entry,
E00-T04c; the switch's off colour and the checkbox's border colour and radius, E00-T04d; the
overlay, the drawer's shadow, entry and title size, E00-T04e; the pills of an archived and a
deceased patient, the grey of a completed visit, E01-T02a) marked there. The controls' edges (`border-strong`, `checkbox-border`, `switch-off`) are as light as the
demo draws them, under WCAG 1.4.11's 3:1 against white: kept by the owner on 2026-10-07
(`handoffs/E00-T04d.md`); the receptionist trial (Q-09) shows whether staff see them.

**Fonts.** UI: `Onest`. Headings and big numbers: `Source Serif 4` (serif, weight 400–500).
They replace the demo's Figtree and Newsreader, which have no Cyrillic letters (D-089).
Both are open-licensed; bundle them with the app (D-009).

**Base size.** 14 px text, line height 1.45. Page headings 28–34 px serif. Section headings 16 px, weight 600.

**Colours** (the demo writes them in `oklch`; keep that format):

| Token | Value | Used for |
|---|---|---|
| `bg` | `oklch(0.985 0.004 95)` | Page background (warm off-white) |
| `surface` | `oklch(1 0 0)` | Cards, inputs |
| `sidebar` | `oklch(0.975 0.006 190)` | Sidebar background |
| `text` | `oklch(0.24 0.02 210)` | Main text |
| `muted` | `oklch(0.52 0.015 210)` | Secondary text |
| `border` | `oklch(0.92 0.006 95)` | Card borders, dividers |
| `border-strong` | `oklch(0.88 0.008 95)` | Buttons, inputs |
| `primary` | `oklch(0.47 0.085 195)` | Primary buttons, brand teal |
| `primary-soft` | `oklch(0.92 0.03 190)` | Active navigation, selected |
| `accent` | `oklch(0.55 0.1 195)` | Toggles on, checkmarks, selected borders |
| `panel-dark` | `oklch(0.3 0.045 200)` | Dark results panel, selected chips |
| `warn-bg` / `warn-border` | `oklch(0.975 0.03 85)` / `oklch(0.9 0.05 85)` | "Needs a call" panel |

**Status colours** (text / background / dot): copy from `ST`, lines 1377–1385.
Confirmed = green (hue 155), no reply = amber (65–85), booked = blue (250),
in the chair = teal (195), done = grey, cancelled and no-show = red (25).

**Provider colours.** Each provider has a hue; tints are derived from it
(`C()` at line 1375): tint `oklch(0.95 0.03 H)`, edge `oklch(0.86 0.05 H)`,
strong `oklch(0.6 0.1 H)`, ink `oklch(0.3 0.05 H)`. Store only the hue on the provider.

**Shape.** Radius: cards 14–18 px, buttons and inputs 8–10 px, pills 99 px.
Borders 1 px. Almost no shadows. Entry animation: 0.3 s fade and 6 px rise.

**Layout.** Sidebar 228 px, fixed. Main padding 28 px / 36 px. Content max width about 1,240 px.
Drawers open at the right edge: 420 px (appointment), 500 px (aftercare review), never wider than
the screen; they enter as the demo's does (line 1196), a fade and a 6 px rise in 0.2 s.

**Staff app** is desktop-first and must also work on a tablet in landscape.
**Patient pages** are phone-first (the demo's phone frame is about 300 px wide).

## Wording style

Plain, warm, short. Says what happens next ("Nothing goes out until someone approves it").
No jargon on patient pages. Keep this tone in every new screen the demo does not cover
(login, errors, empty states).

## Screens the demo does not have

Login, two-factor, invite acceptance, password reset, failed-message and attention items,
expired link, "too late to cancel", second-check screen, import undo, audit log, opt-out page,
closed days. Build them from the same tokens and components, in the same tone. When a layout
choice is not obvious, the builder proposes one in the handoff note and flags it for the owner.

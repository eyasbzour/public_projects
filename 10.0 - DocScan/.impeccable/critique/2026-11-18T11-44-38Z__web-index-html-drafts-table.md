---
target: drafts table on the home screen
total_score: 26
p0_count: 0
p1_count: 2
timestamp: 2026-11-18T11-44-38Z
slug: web-index-html-drafts-table
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | No count of shown vs. all drafts while filtering |
| 2 | Match System / Real World | 3 | Title "آخر المسودات" stops being true once the list is sorted by name |
| 3 | User Control and Freedom | 3 | Search clears with Esc; delete asks first but cannot be undone |
| 4 | Consistency and Standards | 3 | Sort follows Windows Explorer; a double-click search would not follow anything users know |
| 5 | Error Prevention | 3 | Delete confirms; hidden column filters would make drafts seem lost |
| 6 | Recognition Rather Than Recall | 2 | Sortable columns show no cue until hover; double-click search would be invisible |
| 7 | Flexibility and Efficiency | 2 | No per-column search yet; no quick way to filter to "mine" |
| 8 | Aesthetic and Minimalist Design | 3 | Clean; a search box plus column filters would be two ways to do one thing |
| 9 | Error Recovery | 2 | "No match" and "could not load" messages offer no action |
| 10 | Help and Documentation | 2 | Good first-run steps; nothing tells users the headers do anything |
| **Total** | | **26/40** | **Acceptable** |

## Anti-Patterns Verdict

LLM assessment: does not read as AI-made. A plain, familiar data table on the calm tinted page, one green accent, no cards, no decoration. It passes the product slop test: it looks like a tool, not a template.

Deterministic scan: unavailable. The installed impeccable skill is missing its detector bundle (scripts/detector/), so neither the CLI scan nor the browser overlay could run. Fallback: measurements in Chrome. Header and muted cell text 6.3:1 in light mode and 7.8:1 in dark (AA passes). Keyboard order is logical (search, refresh, column headers, then each row's link and delete). Targets are undersized: column header buttons 33x19 px; on a phone the delete and refresh buttons are 40x40, under the 44 px floor in PRODUCT.md.

Taste skill: by its own rules data tables are out of scope (it points to TanStack Table or AG Grid patterns). The parts that apply pass: no em dashes, contrast, one accent, both themes. Its ban on a hairline under every row targets marketing spec sheets, not a working table.

## Overall Impression

A solid, quiet table that does its job. The proposed double-click search is the risk: it would hide the feature from the people PRODUCT.md describes (older, non-technical office staff) and fight with click-to-sort. The biggest opportunity is Excel-style column filters that are visible, plus a clear sign when a filter is on.

## What's Working

- Whole row opens the draft while the name link and delete button keep their own clicks: big target, no surprises.
- Click-to-sort with an arrow on the active column matches Windows Explorer, which these users already know.
- Spelling-tolerant search (احمد finds أحمد) fits real Arabic typing.

## Priority Issues

**[P1] Double-click as the way into column search**
- Why it matters: nothing on screen hints at it; a double-click is also two clicks, so the sort would flip twice before the search opens; phones have no double-click.
- Fix: a small filter (funnel) button beside each searchable column title opens a search box under that header (text for document and person, a number for pages). Double-click on the title opens the same box as a shortcut. Sort stays on the title with the arrow beside it.
- Suggested command: impeccable shape, then impeccable craft

**[P1] Filters hidden in headers make drafts look lost**
- Why it matters: someone filters "بواسطة", leaves, comes back and sees two drafts instead of forty. Principle 3, never lose work.
- Fix: an active filter turns its funnel solid green and adds a chip above the table ("بواسطة: قسم" with an x), plus "مسح الكل". The no-results line gets a "مسح البحث" button.
- Suggested command: impeccable harden

**[P2] Two ways to search the same thing**
- Why it matters: the search box above the table and column filters on name and person overlap, and two active filters at once confuse.
- Fix: column filters replace the box (the user's intent), with chips showing what is active.
- Suggested command: impeccable distill

**[P2] Small targets**
- Why it matters: column header buttons are 33x19 px; on phones delete and refresh are 40x40, under 44.
- Fix: header buttons fill the header cell height; 44 px buttons on phones.
- Suggested command: impeccable adapt

**[P2] Phone hides the person and page columns**
- Why it matters: their sort and filter are unreachable on a phone.
- Fix: on phones, show the person and page count as a second line under the document name, and offer their filters from the chip row.
- Suggested command: impeccable adapt

## Persona Red Flags

**Senior records clerk (project persona: older, not technical, Excel at most)**: will never try a double-click on a header; may not realize the column titles are buttons since only the active one has an arrow; a forgotten filter reads as "the system deleted my drafts."

**Alex (power user)**: wants "show only mine" in one step; today that means typing their name every visit. No count of how many drafts match.

**Sam (keyboard / screen reader)**: headers are real buttons with aria-sort, good. A double-click-only search would have no keyboard path at all; the new filter buttons need labels such as "تصفية عمود بواسطة" and the chip row needs to announce changes.

## Minor Observations

- "آخر المسودات" heading: once sorted by name it is no longer "latest"; "كل المسودات" with a count ("4" or "1 من 4" while filtering) says more.
- Inactive sortable columns get no cue until hover.
- "تعذر تحميل المسودات" has no retry button in the message.
- Loading is a text line, acceptable for a short list.

## Questions to Consider

- Do people really look up drafts by page count, or is sorting by pages enough?
- Is the person column mostly used to find "my own drafts"? Then a remembered "مسوداتي" toggle beats typing a name.

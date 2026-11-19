# Browser checks

Each script drives the app in Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`) and prints PASS or FAIL lines.
They need a running server, by default `http://localhost:8765`, with test drafts made by `seed.js`:

```bash
npm ci
ID=$(node seed.js http://localhost:8765 | grep '^draft' | head -1 | sed 's/.*id //')
node editor-check.js $ID      # the text editor: lists by mouse and keyboard, formatting, colours, tables, pictures, flags, saving
node reread-check.js $ID      # reading a word, a paragraph or every flagged spot again with another reader
node line-check.js $ID        # a clicked line, paragraph or table cell on the photo, read again and replaced; pasting pictures
node replace-check.js $ID     # every way text is replaced: a fixed word, one or all suggestions, a line in a bold paragraph
node feature-check.js $ID     # word panel, picture insert, table lines, exports
node e2e.js                   # a whole draft: upload, read, flag, produce every format (makes out/ for ask-check.js)
```

Others: `ui-check.js <id>` (panes, splitters, popovers), `search-check.js` (drafts table), `pop-check.js` (panels and windows),
`tpl-check.js` (templates and document font), `english-check.js` (an English page, from `english-page.js`),
`switch-check.js <idA> <idB>` (going straight from one draft to another keeps both as they were), `review-shots.js`
(screenshots and measurements of every screen for design reviews). Screenshots go to `shots/`.

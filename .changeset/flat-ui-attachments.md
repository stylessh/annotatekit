---
"@annotatekit/core": minor
"@annotatekit/inspector": minor
---

Redesign the overlay: flat, low-opacity look themed by `--ak-*` CSS variables, bundled Instrument Sans, and a new `vivid` theme. Clicking a pin now opens a thread panel with messages, replies, status actions and loading, empty and error states, and the toolbar lists the page's threads. Comments can carry image and file attachments through a new `AttachmentAdapter` (inline `data:` URLs by default); core validates attachment URLs and allows comments that are only attachments.

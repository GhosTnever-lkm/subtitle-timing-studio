# Changelog

## 1.0.7 — 2026-10-25

- Reject release tags that do not match the shipped package version before building release assets.
- Run the release packaging checks before uploading the archive.

## 1.0.6 — 2026-10-25

- Show subtitles that start at 00:00 while the video is paused on its first frame.
- Add a shared active-cue lookup with a regression for the first-frame and cue-end boundaries.

## 1.0.5 — 2026-10-24

- Save valid edits to the current subtitle cue before switching to another cue, without rerendering away the pending click.

## 1.0.4 — 2026-10-24

- Keep the global Delete shortcut from removing a subtitle cue while editing a time, text, or other form field.

## 1.0.3 — 2026-10-12

- Synchronize the package version with the shipped release and add a regression test to prevent metadata drift.

## 1.0.2 — 2026-10-12

- Stop export for malformed or reversed cue times; mark live edits as unsaved so invalid input cannot silently disappear.
- Keep generated download URLs alive briefly so the browser can finish starting the file download.

## 1.0.1 — 2026-10-10

- Correct Russian plural forms in the file status and clean-diagnostics summary.

## 1.0.0 — 2026-10-10

- First public release: local SRT/WebVTT editing, browser video preview, timeline controls, overlap and timing checks, and export.
- Add the initial Node test suite for parsing, round-trip IDs, time conversion, and overlap edge cases.

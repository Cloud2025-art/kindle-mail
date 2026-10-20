# Changelog

## 0.1.1 — Prepared for community submission

- Add English documentation and a Chinese step-by-step tutorial, privacy disclosure, MIT license and dependency notices.
- Add a portable source layout, locked dependencies and build/test scripts.
- Limit note expansion and image counts to avoid excessive resource use.
- Remove XML-incompatible control characters from generated text and metadata.
- Improve settings snapshots, export-path validation and SMTP test feedback.
- Preserve the existing plugin ID, command IDs and settings structure for users of 0.1.0.

This version is prepared locally; this changelog does not imply a public release or community approval.

## 0.1.0 — Personal working version

- Convert a Markdown note and supported local resources into EPUB.
- Export locally or send through TLS-protected SMTP after confirmation.
- Store SMTP credentials by reference through Obsidian SecretStorage.
- User reported successful Gmail-to-Kindle delivery on Windows, Obsidian 1.14.4.

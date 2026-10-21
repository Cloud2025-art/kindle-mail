# Changelog

## 0.1.4 — 2026-10-21

- Parse Obsidian embeds before Markdown emphasis, preserving filenames containing underscores and width aliases such as |800.
- Add regression coverage for two distinct image paths and preserve literal embeds in inline/fenced code.
- Retain all 0.1.3 runtime security restrictions.

## 0.1.3 — 2026-10-21

- Replace immediate's legacy browser scheduler with a function-only scheduler; remove script-element creation from the installed bundle.
- Fail builds and bundle checks if script-element creation returns.
- Test EPUB generation with no native Promise and with DOM access blocked.
- Preserve the SMTP-only transport, denied filesystem operations, TLS verification and dynamic-compilation restrictions.

## 0.1.2 — 2026-10-20

- Exclude embedded note contents by default; list all included note/image paths and SMTP destination before sending.
- Check fresh vault sizes and budgets before reads and actual sizes afterwards; reject hidden, invalid and unregistered paths.
- Import only Nodemailer's SMTP transport; deny dependency filesystem calls in the installed bundle and replace the dynamic-code scheduler fallback.
- Explicitly verify TLS certificates, keep credentials inaccessible until confirmation and redact raw SMTP errors.
- Pin direct dependency versions and fail builds that include prohibited runtime imports or dynamic compilation.
- Add security regression tests and installed-bundle tests, normalize build source labels, and add a frozen-install CI workflow.
- Author confirmed live Gmail-to-Kindle delivery on Windows with Obsidian 1.14.4; note text and local images displayed correctly. GitHub publication does not imply acceptance into the Obsidian Community directory.

## 0.1.1 — Initial public release

- Add English documentation and a Chinese step-by-step tutorial, privacy disclosure, MIT license and dependency notices.
- Add a portable source layout, locked dependencies and build/test scripts.
- Limit note expansion and image counts to avoid excessive resource use.
- Remove XML-incompatible control characters from generated text and metadata.
- Improve settings snapshots, export-path validation and SMTP test feedback.
- Preserve the existing plugin ID, command IDs and settings structure for users of 0.1.0.

Published on GitHub on 2026-10-20. Obsidian Community submission and approval are separate steps and are not yet complete.

## 0.1.0 — Personal working version

- Convert a Markdown note and supported local resources into EPUB.
- Export locally or send through TLS-protected SMTP after confirmation.
- Store SMTP credentials by reference through Obsidian SecretStorage.
- User reported successful Gmail-to-Kindle delivery on Windows, Obsidian 1.14.4.

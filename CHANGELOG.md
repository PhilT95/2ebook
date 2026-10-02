# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-10-02

First beta release. A rewrite of the original [send2ereader](https://github.com/daniel-j/send2ereader) in TypeScript with Fastify.

### Added
- Encryption at rest: every uploaded file is encrypted with AES-256-GCM using a random per-file key. The key lives only in server memory, so the stored file cannot be read from disk or from a backup.
- Files are buffered in memory and only the ciphertext (`.enc`, mode 0600) is written to `uploads/`.
- Converters (kepubify, kindlegen, pdfCropMargins) run in a private temporary directory that is removed after each run.
- File type detection from the file's magic bytes (`file-type`), in addition to the extension and MIME type allowlist.
- Validation of the optional URL field: only `http` and `https` are accepted.
- Security headers on downloads: `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`.
- Graceful shutdown: `uploads/` is deleted on `SIGINT` and `SIGTERM`.
- Multi-stage Dockerfile that compiles the TypeScript, runs as the unprivileged `node` user, and starts `node` directly so `docker stop` signals reach the app.
- `docker-compose.yaml` hardening: `/tmp` mounted as `tmpfs`, `no-new-privileges`, `cap_drop: ALL`.
- Privacy section in the README.
- Redesigned upload page in Material 3 style: automatic light and dark mode, numbered steps, filled text fields, switches for the conversion options and a responsive layout.
- Upload page: drag and drop, a progress bar with a "processing" state, instant client-side file type and size check, and the file and URL fields are cleared after a successful upload (the key is kept).
- Ereader page: a status line ("Waiting for an upload…", "Done!"), a "New key" button with a text label, and short instructions on how to send an ebook.

### Changed
- Replaced Koa with Fastify (`@fastify/multipart`, `@fastify/static`, `@fastify/rate-limit`, `@fastify/cookie`).
- Migrated from CommonJS to ESM and from JavaScript to TypeScript (strict mode), split into modules under `src/`.
- Replaced callbacks and nested promises with `async`/`await`.
- Keys are now 6 characters instead of 4 and are generated with `crypto.randomInt`.
- Maximum upload size is 100 MB (was 800 MB), because uploads are held in memory.
- An unknown key and a wrong User-Agent now return the same `404`.
- Upload responses are plain text (`\n` line breaks) instead of HTML.
- The status message on the upload page is now rendered as text.
- README updated for Node 20.11+, the build step, and the new repository.
- The pages are now called "2ebook" instead of "Send to Kobo/Kindle".
- The upload page script moved from inline code to `static/upload.js`, and its styles to `static/upload.css`.
- Ereader page restyled for e-ink screens (black and white, thick borders, no animations, plain ES5). `static/style.css` was rewritten and `static/common.js` trimmed to the helpers it still uses.

### Removed
- Koa, `@koa/multer`, `mkdirp`, `@types/sanitize-filename` and the `patches/` directory.
- The old `index.js` and the `Expect: 100-continue` workaround.
- The latin1 to UTF-8 filename workaround (not needed with Fastify multipart).
- Unused `isIOS` and `getCookies` helpers from `static/common.js`.

### Fixed
- Cross-site scripting through `innerHTML` for the upload status message and the selected file name.
- Transliteration of file names without an extension.
- Uploads for an unknown key are drained without being buffered, so they cannot be used to exhaust memory.
- A key that expires during a long upload or conversion no longer leaves an orphaned encrypted file.
- Ereader page: file and links stayed visible after the key expired, a single failed request ended the session even though the server still had it, and a double tap could request two keys.
- The key input on the upload page is wide enough for 6 characters.

### Security
- Plaintext ebooks are never written to the upload directory.
- Docker `tmpfs` keeps the temporary conversion files off disk.

[Unreleased]: https://github.com/PhilT95/2ebook/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/PhilT95/2ebook/releases/tag/v0.1.0

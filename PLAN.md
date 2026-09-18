# 2ebook — Modernisation & Security Plan

## Goals

1. Rewrite the codebase in **TypeScript** with **ESM modules**
2. Replace Koa with **Fastify** (modern, fast, TypeScript-first)
3. Use **consistent async/await** throughout — no callbacks, no manual Promises
4. Split the monolithic `index.js` into a **modular architecture**
5. Add **AES-256-GCM encryption at rest** so files on disk are unreadable to the hoster
6. Fix all identified security bugs

The goal is also to produce code that is readable and educational for someone
learning JavaScript/TypeScript, so every module is clearly structured and commented.

---

## New Tech Stack

| Concern           | Old                        | New                              |
|-------------------|----------------------------|----------------------------------|
| Language          | JavaScript (CommonJS)      | TypeScript (ESM)                 |
| Framework         | Koa                        | Fastify                          |
| File uploads      | @koa/multer                | @fastify/multipart               |
| Static files      | koa-static                 | @fastify/static                  |
| Rate limiting     | none                       | @fastify/rate-limit              |
| Cookies           | manual                     | @fastify/cookie                  |
| Async style       | mixed callbacks/Promises   | async/await + fs.promises        |
| File type detect  | file-type v16 (pinned)     | file-type latest (ESM-free)      |
| Encryption        | none                       | Node.js built-in crypto (AES-GCM)|
| Key generation    | Math.random()              | crypto.randomInt()               |

---

## New Directory Structure

```
2ebook/
├── src/
│   ├── index.ts           # Entry point: creates server, registers plugins, starts listening
│   ├── app.ts             # Fastify app factory: registers all plugins and routes
│   ├── config.ts          # All constants (port, timeouts, allowed types, etc.)
│   ├── types.ts           # TypeScript interfaces (SessionInfo, FileInfo, etc.)
│   │
│   ├── lib/
│   │   ├── keys.ts        # Session Map, key generation, expiry/removal logic
│   │   ├── crypto.ts      # AES-256-GCM encrypt/decrypt helpers
│   │   ├── convert.ts     # kepubify, kindlegen, pdfcropmargins wrappers
│   │   └── filename.ts    # Sanitization and transliteration helpers
│   │
│   └── routes/
│       ├── generate.ts    # POST /generate
│       ├── upload.ts      # POST /upload
│       ├── download.ts    # GET /:filename
│       ├── status.ts      # GET /status/:key
│       └── deleteFile.ts  # DELETE /file/:key
│
├── static/                # Frontend files (unchanged structure)
│   ├── common.js
│   ├── download.html
│   ├── upload.html
│   └── style.css
│
├── uploads/               # Created at runtime; holds encrypted .enc files only
│
├── package.json
├── tsconfig.json          # TypeScript compiler configuration
└── docker-compose.yaml
```

---

## Implementation Steps

### Step 1 — Project scaffolding

- Add `tsconfig.json` configured for ESM output (`"module": "NodeNext"`)
- Update `package.json`:
  - Add `"type": "module"` (enables ESM)
  - Add TypeScript and `tsx` (for running TS directly during development)
  - Add a `build` script (`tsc`) and a `start` script (`node dist/index.js`)
  - Replace all old dependencies with their modern equivalents
- Remove `patch-package` (the @koa/multer patch is no longer needed)

New dependencies:
```
fastify
@fastify/multipart
@fastify/static
@fastify/rate-limit
@fastify/cookie
file-type           ← now the latest version, unlocked by ESM
transliteration
sanitize-filename
mkdirp

TypeScript dev dependencies:
typescript
tsx
@types/node
@types/sanitize-filename
```

---

### Step 2 — `src/types.ts`: TypeScript interfaces

Define the shape of every object used across the app. This is the foundation
that makes the rest of the code safe and self-documenting.

```typescript
export interface FileInfo {
  name: string               // Display name shown to the ereader (e.g. "mybook.epub")
  encryptedPath: string      // Path to the .enc file on disk
  key: Buffer                // AES-256 encryption key (32 bytes, held only in RAM)
  iv: Buffer                 // Initialisation vector used during encryption (16 bytes)
  authTag: Buffer            // GCM authentication tag (16 bytes, proves integrity)
  uploaded: Date
}

export interface SessionInfo {
  created: Date
  agent: string              // User-Agent of the ereader that generated this key
  file: FileInfo | null      // null until the desktop uploads a file
  urls: string[]
  timer: ReturnType<typeof setTimeout> | null
  alive: Date
}
```

Having these types means TypeScript will catch mistakes like accessing
`info.file.name` without first checking that `info.file` is not null.

---

### Step 3 — `src/config.ts`: centralised configuration

All magic numbers and constants in one place. This also makes it easy to
configure the app via environment variables in a self-hosted setup.

```typescript
export const PORT          = Number(process.env.PORT) || 3001
export const EXPIRE_DELAY  = 30         // seconds of inactivity before session expires
export const MAX_EXPIRE    = 60 * 60   // hard session cap: 1 hour
export const MAX_FILE_SIZE = 800 * 1024 * 1024  // 800 MB

export const ALLOWED_TYPES = [ ... ]
export const ALLOWED_EXTENSIONS = [ ... ]

export const KEY_CHARS  = "23456789ACDEFGHJKLMNPRSTUVWXYZ"
export const KEY_LENGTH = 4
```

---

### Step 4 — `src/lib/keys.ts`: session management

Extracts all key/session logic from the monolithic index.js into its own module.

Key improvements:
- `crypto.randomInt()` replaces `Math.random()` for key generation
- The session Map is a properly typed `Map<string, SessionInfo>`
- `removeKey` and `expireKey` are exported functions that routes import

```typescript
import { randomInt } from 'node:crypto'
import { KEY_CHARS, KEY_LENGTH } from '../config.js'
import type { SessionInfo } from '../types.js'

// The entire session database. Lives in memory for the lifetime of the process.
export const sessions = new Map<string, SessionInfo>()

// Generates a cryptographically random 4-character key
export function randomKey(): string { ... }

// Resets the 30-second inactivity timer for a session
export function expireKey(key: string): void { ... }

// Fully removes a session and deletes its encrypted file from disk
export async function removeKey(key: string): Promise<void> { ... }
```

---

### Step 5 — `src/lib/crypto.ts`: encryption helpers

New module. Wraps Node's built-in `crypto` module with two simple functions
that the upload and download routes will call.

How AES-256-GCM works (explained for learners):
- AES-256: a symmetric cipher — the same key encrypts and decrypts
- GCM mode: produces an "auth tag" alongside the ciphertext; decryption fails
  if the file has been tampered with (integrity guarantee)
- IV (initialisation vector): a random value that ensures two identical files
  produce different ciphertext; safe to store alongside the ciphertext

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

export interface EncryptionMeta {
  key: Buffer
  iv: Buffer
  authTag: Buffer
}

// Encrypts a Buffer in memory and writes the ciphertext to a file on disk.
// Returns the key, IV, and auth tag — the caller stores these in the session Map (RAM only).
export async function encryptToFile(
  plaintext: Buffer,
  filePath: string
): Promise<EncryptionMeta> { ... }

// Reads an encrypted file from disk and decrypts it in memory.
// Throws if the key/IV/authTag don't match (file tampered or wrong session).
export async function decryptFromFile(
  filePath: string,
  meta: EncryptionMeta
): Promise<Buffer> { ... }
```

The hoster sees only `.enc` files containing random-looking bytes. Without the
key (which lives only in the session Map in RAM), the file is unreadable.

---

### Step 6 — `src/lib/convert.ts`: conversion tool wrappers

Replaces the ~200 lines of copy-pasted child_process code with a single generic
helper plus three thin wrappers.

The generic helper:

```typescript
// Runs an external command and returns its combined stdout+stderr output.
// Rejects with an error if the process exits with an unexpected code.
async function spawnConvert(
  command: string,
  args: string[],
  cwd: string,
  validExitCodes: number[] = [0]
): Promise<void> { ... }
```

The three converters each follow the same pattern:
1. Write the input Buffer to a temp file
2. Run the conversion tool
3. Read the output file into a Buffer
4. Delete both temp files immediately
5. Return the output Buffer

```typescript
export async function runKepubify(input: Buffer, baseName: string): Promise<Buffer>
export async function runKindlegen(input: Buffer, baseName: string): Promise<Buffer>
export async function runPdfCropMargins(input: Buffer): Promise<Buffer>
```

The converted file content is returned as a Buffer in memory. The caller
(the upload route) then encrypts it and stores it via `encryptToFile`.
This means plaintext only ever exists in RAM — it never rests on disk.

---

### Step 7 — `src/lib/filename.ts`: filename helpers

Small module, extracts the two filename utility functions:

```typescript
import { transliterate } from 'transliteration'
import sanitize from 'sanitize-filename'

// Converts non-ASCII characters to ASCII while preserving the file extension
export function doTransliterate(filename: string): string { ... }

// Strips characters that Kindle's browser can't handle in filenames
export function kindleSafeFilename(filename: string): string { ... }
```

---

### Step 8 — `src/routes/`: one file per route

Each route is a Fastify plugin — a self-contained function that registers one
or more route handlers. This is the standard Fastify pattern.

**`generate.ts`** — POST /generate
- Rate limited: max 10 requests per minute per IP (via @fastify/rate-limit)
- Calls `randomKey()` and `sessions.set()`
- Returns the key as plain text

**`upload.ts`** — POST /upload
- Uses `@fastify/multipart` to receive the file as a stream into a Buffer
  (no temporary disk write at this stage — the file is in RAM)
- Validates the key, file type (via `file-type`), and size
- Runs the appropriate converter if requested
- Calls `encryptToFile()` to write the ciphertext to disk
- Stores the encryption metadata in the session

**`status.ts`** — GET /status/:key
- Validates key and User-Agent
- Calls `expireKey()` to reset the inactivity timer
- Returns `{ alive, file: { name } | null, urls }`

**`download.ts`** — GET /:filename
- Validates key, filename match, and User-Agent
- Calls `decryptFromFile()` to read and decrypt the file into a Buffer
- Streams the Buffer as the HTTP response with correct Content-Type
- Calls `expireKey()`

**`deleteFile.ts`** — DELETE /file/:key
- Bug fix: now calls `fs.promises.unlink()` on the encrypted file before
  clearing the session entry
- Added User-Agent check (consistent with other routes)

---

### Step 9 — `src/app.ts`: Fastify app factory

Registers all plugins and routes. Keeping this separate from `index.ts` makes
the app easy to test independently of the server.

```typescript
import Fastify from 'fastify'
import staticPlugin from '@fastify/static'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import cookie from '@fastify/cookie'

export function buildApp() {
  const app = Fastify({ logger: true })  // built-in structured logging

  app.register(cookie)
  app.register(rateLimit, { max: 60, timeWindow: '1 minute' })
  app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })
  app.register(staticPlugin, { root: 'static' })

  // Register route modules
  app.register(generateRoute)
  app.register(uploadRoute)
  app.register(statusRoute)
  app.register(downloadRoute)
  app.register(deleteFileRoute)

  return app
}
```

---

### Step 10 — `src/index.ts`: entry point

Thin entry point — just starts the server:

```typescript
import { buildApp } from './app.js'
import { PORT } from './config.js'
import { promises as fs } from 'node:fs'
import { mkdirp } from 'mkdirp'

// Wipe and recreate uploads/ on startup to remove any leftover .enc files
// from a previous crash (the decryption keys for them are gone anyway)
await fs.rm('uploads', { recursive: true, force: true })
await mkdirp('uploads')

const app = buildApp()
await app.listen({ port: PORT, host: '0.0.0.0' })
```

Note: top-level `await` works because we're using ESM (`"type": "module"`).
This is cleaner than wrapping everything in an async IIFE.

---

### Step 11 — Frontend fixes

The HTML/JS frontend files need two small fixes alongside the backend rewrite:

**`upload.html`** — XSS fix:
- The success message currently uses `innerHTML`, which would execute any HTML
  in the filename. Replace with `textContent` for the filename part and build
  the line-break structure with DOM methods instead.

**`download.html`** — no functional changes needed.

**`common.js`** — no changes needed.

---

### Step 12 — `tsconfig.json`

The TypeScript configuration for modern ESM Node.js:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true
  }
}
```

- `"strict": true` enables all TypeScript safety checks
- `"module": "NodeNext"` tells TypeScript to emit proper ESM with `.js` extensions

---

## Security changes (consolidated)

| Issue                        | Fix                                              |
|------------------------------|--------------------------------------------------|
| Files readable on disk       | AES-256-GCM encryption; key only in RAM          |
| Weak key generation          | crypto.randomInt() instead of Math.random()      |
| No rate limiting             | @fastify/rate-limit on /generate and /upload     |
| DELETE doesn't remove file   | fs.promises.unlink() called before clearing Map  |
| XSS in success message       | textContent instead of innerHTML for filename    |
| Mixed async patterns         | async/await + fs.promises throughout             |

---

## What stays the same

- The overall flow (generate key → upload → poll → download) is unchanged
- The frontend HTML structure is unchanged
- The conversion tools (kepubify, kindlegen, pdfcropmargins) are unchanged
- Docker/docker-compose setup needs only minor updates (build step for TS)
- The `uploads/` directory still exists, but now only holds `.enc` files

---

## Learning notes

Throughout implementation, each module will be commented to explain:
- Why TypeScript interfaces are defined the way they are
- How Fastify plugins work (the `register` pattern)
- How AES-256-GCM encryption works step by step
- What async/await is doing under the hood
- The ESM import/export syntax vs the old CommonJS require()

The goal is that after working through this, you have a solid understanding of
modern Node.js/TypeScript application structure.

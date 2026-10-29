# Phases 6 and 7: Attack surface and planned features

Part 1 (phase 6) checks what is already in the code. Part 2 (phase 7) writes security requirements for what is yet to be built. Results in sections "7 Attack surface" and "8 Requirements for planned features" of `<work>/security-report.md`.

Contents: part 1 approach and checklists by feature, part 2 threat model for planned features.

## Part 1: Attack surface review

### Approach

1. Use `.claude/agents/security-reviewer.md` if present, following its instructions. Otherwise do the work yourself.
2. Pick **only the checklists** whose feature the inventory (section 6) actually shows. A list for a feature that does not exist costs time and produces phantom findings.
3. Go through the locations found in the inventory and analyzer measurement one by one (file:line) instead of reading the repo in general.
4. Rate each point with file:line and severity (scale in `report.md`). "ok" is a valid result and belongs in the table if the location was explicitly checked.
5. At the end, check "own observations", i.e. anything that is not on any list but caught your eye while reading.

The reason for asking about **origin**: almost every vulnerability in these areas arises because data from an untrusted source (file, network, device, user) reaches a sensitive sink (path, SQL, process, expression, HTML). So for every finding, trace the data path backwards to its source.

### Checklists by feature

**File system and paths** (vault, import, export, temp files)
- Is the path normalized before the check? `..`, absolute paths, UNC paths, drive and alternate data stream syntax (`:`), case, reserved Windows names.
- Junctions, symlinks, and reparse points: do move, delete, and write follow them? Time window between check and use (TOCTOU).
- Atomic writes: temp file (location, permissions, cleanup), behavior with a symlink as target, data loss on abort, overwriting foreign files.
- Limits on file size and count when loading and indexing (memory, DoS).

**Archives (ZIP and similar)**
- Zip slip: is the target path within the target folder after normalization? Absolute paths, `..`, symlink entries, name collisions.
- Limits on entry count, total extracted size, single size, and compression ratio (zip bomb), nested archives.
- No unchecked `ExtractToDirectory`. Extract into a temporary directory and commit atomically with rollback. Behavior on abort.
- Verify signature or MAC before parsing, schema and version check including downgrade protection.

**XML**
- Find **all** ways XML is read (`XmlReader.Create`, `XDocument.Load`, `XmlDocument.Load`, `XmlSerializer`, `DataSet.ReadXml`, libraries like GDAL for ISOXML, KML, GML). Are DTD and external entities blocked (`DtdProcessing.Prohibit`, `XmlResolver = null`)? Existing hardening at individual locations is only enough if it covers all paths.
- Size and depth limits, behavior on errors.

**SQL and database** (SQLite, GeoPackage, ADO.NET)
- Check string-built SQL one by one: do identifiers (table, column names) come from file content or user input? Correct quoting including escaping of `"`? Is the allowlist effective? Is a parameter like `definition` ever fed from non-literals? Propose hardening if needed (closed set of definitions), without implementing it.
- Imported databases: opened read-only? Are schema functions from foreign files (views, triggers) executed?
- Spot-check all other SQL strings for real parameterization.
- File permissions of the database, behavior with a corrupted file, migrations with rollback, no plaintext values in the log.

**Import of foreign geo and image data** (GDAL/OGR, raster libraries, image decoders)
- Are paths passed from input or file content that could address virtual file systems (`/vsicurl/`, `/vsizip/`)? Driver restriction, limits on file size, duration, and memory, behavior on native crash (does the parser run in the same process?).
- Pixel and dimension limits (decompression bomb), strip metadata (EXIF/GPS) or keep it deliberately, do not take over file names, check file type by content.

**Expression and script engines** (DynamicExpresso, `CSharpScript`, expression trees)
- Origin of the formulas: hard-coded, from configuration, from imported files, from the server? With foreign origin this is remote code execution.
- Registered types and references, access to reflection or arbitrary .NET types, length and time limits.

**Process start** (`Process.Start`, `ShellExecute`)
- Per location: origin of path, arguments, and URL, `UseShellExecute`, URL validation (https only, fixed hosts?), paths from import files (running arbitrary files). Arguments as a list instead of a concatenated string.

**HTTP clients and network**
- All `http://` literals in production code, certificate validation, timeouts, maximum response size, redirect behavior (to HTTPS only), no sharing of personal data, error texts without internal details, tokens not in logs.
- SSRF possibility if URLs come from user input or files.
- For XML or JSON responses: hardened parser and plausibility check of values.
- Protocols with plaintext authentication (e.g. NTRIP): is a TLS variant possible?
- Transfer of user data to external services (e.g. images to an AI service): scope, consent, storage.

**Web endpoints** (ASP.NET minimal API, controllers)
- Authentication and authorization per endpoint, HMAC or signature check (constant-time comparison, key origin, replay protection via timestamp), size limits for request bodies, rate limiting, error output without details.
- Forms (Blazor, Razor): validation, anti-forgery, mail header injection, rate limiting, security headers, HTTPS and HSTS, cookie settings, CORS.

**Browser frontends (SPA)** (Angular, React, Vue, Svelte)
- XSS sinks: Angular `bypassSecurityTrust*` and `[innerHTML]` (Angular sanitizes, a bypass switches that off), direct DOM access via `ElementRef.nativeElement` or `Renderer2`; React `dangerouslySetInnerHTML`, `href`/`src` with user data (React does not block `javascript:` URLs reliably), refs that write HTML. Trace each one back to the data source. Sanitizer (e.g. DOMPurify) used where HTML is intentional?
- Secrets in the bundle: everything in `environment*.ts` and in variables with `NEXT_PUBLIC_`, `VITE_`, `REACT_APP_` is public. Check whether anything there is a real secret (API keys with write rights, client secrets) rather than a public identifier. Source maps in the production build expose the source code: deliberate or not?
- Tokens and sessions: access or refresh tokens in `localStorage`/`sessionStorage` (readable by any XSS) instead of httpOnly, Secure, SameSite cookies; logout clears all copies; OAuth/OIDC in the browser only with authorization code + PKCE, no implicit flow, `state` and `nonce` checked.
- Authorization: route guards (`CanActivate`, protected routes) are UX only. Check that the backend enforces every permission the frontend hides.
- CSP and headers: is there a CSP (in the server, `index.html` meta, or `next.config.*` headers) and does it need `unsafe-inline`/`unsafe-eval`? Angular builds without `unsafe-eval` in AOT mode. Also HSTS, `X-Content-Type-Options`, `frame-ancestors`.
- Cross-origin: CORS configuration of the API used, `withCredentials`, dev server proxy (`proxy.conf.json`, Vite `server.proxy`) not usable as a production path, `postMessage` with origin check on receive and a fixed target origin on send, `window.open` with `noopener`.
- Third-party scripts: analytics, tag managers, and CDNs loaded without SRI (`integrity`) or from many domains.
- Open redirects: `returnUrl`/`redirect` query parameters after login only to internal paths.

**Server-side rendering and full-stack frameworks** (Next.js, Angular SSR, Remix, Nuxt)
- Server actions (`"use server"`), API routes, and route handlers are public HTTP endpoints: authentication and authorization in every one, input validation (e.g. zod), no trust in hidden form fields.
- Data passed to client components or serialized into the page (`getServerSideProps`, server components props, Angular `TransferState`): no secrets or internal fields.
- SSRF via server-side `fetch` with URLs from the request; image optimizer `remotePatterns` / `domains` not too broad.
- Middleware as the only auth check (path matching gaps), caching of personalized responses, error pages without stack traces in production.

**Web view, OAuth, Markdown** (WebView, WebView2, BlazorWebView, Markdown rendering)
- OAuth: PKCE, `state`, redirect handling, token storage (DPAPI, Credential Manager, Keychain, plaintext?), tokens in logs.
- WebView settings: DevTools in release, navigation to foreign URLs restricted, downloads, certificate errors, data folder.
- Markdown: is raw HTML passed through (Markdig with advanced options, sanitizer)? Link schemes (`javascript:`, `file:`, `data:`), images with external sources, behavior when clicking external links.
- CSP: content (`unsafe-inline`, `unsafe-eval`, allowed sources). JS interop: what may JS call in .NET, are inputs validated?
- YAML/JSON front matter: deserialization into fixed types instead of `object`/`Dictionary`, alias bombs and recursion, size limits.

**Crypto and keys**
- Algorithms and modes, key derivation (PBKDF2/Argon2, iterations, salt per file), nonce uniqueness with AES-GCM, tag verification, no hard-coded keys, key storage in the OS store, error messages without oracles, format versioning and downgrade protection.
- `System.Random` for security purposes; SHA1 and MD5 allowed only for non-security purposes (file names, export IDs), but mention them in the report.

**Credentials and persistence**
- Storage of passwords, tokens, and license data in configuration and connection files: encrypted (DPAPI, Keychain, Keystore) or plaintext? Reusability on another device.

**Mobile platform** (Android, iOS)
- Android: `allowBackup` and data extraction rules, exported components, `usesCleartextTraffic` or network security config, requested permissions (only necessary ones), `debuggable` in release, R8 and obfuscation, source of the signing key (without naming paths or passwords), FileProvider (authority, shared paths, `exported`, `grantUriPermissions`).
- iOS: `Info.plist`, `PrivacyInfo.xcprivacy` (do declared accesses match the code?), ATS exceptions, file protection class of database and settings, Keychain usage, entitlements.
- Storage locations of database, settings, and logs, and what is readable there by other apps.
- Sharing log files (share intent): what is in them, how long does the copy stay around?

**Desktop installer and delivery** (Inno Setup, MSIX, WiX)
- Target directory permissions (DLL hijacking through writable paths), signing, origin and verification of bundled installers and runtimes, permissions in the manifest (`broadFileSystemAccess`, capabilities), auto-update mechanism and its signature check.

**Native code and device input** (C/C++, serial ports, CAN, NMEA, clipboard)
- Parser robustness against length fields, truncated and malformed records. Deserialization of foreign clipboard formats. Hardware-local input is often rated lower than network input, but parsers with memory bugs remain relevant.

**Logging and error reports** (NLog, Serilog, etc.)
- Are paths, file contents, tokens, locations, or customer data logged? Location and permissions of log files, retention.

### Result format

Table sorted by severity: ID, location, feature, description, severity, classification, recommendation, effort.

## Part 2: Requirements for planned features

Active when roadmap, design, or ADR documents (search in `ai-doc/`, `docs/`, `CONTEXT.md`, plans, and epics) name security-related features not yet built. The goal is to define security **before** implementation: crypto formats and import paths can hardly be secured after the fact.

Per feature (epic) a short threat model: attackers, assets, trust boundaries, followed by a list of **verifiable requirements** that fit as acceptance criteria in tickets. Assign IDs in the pattern `SEC-<epic>-NN` (e.g. `SEC-E4-01`).

Typical features and what belongs to them (use the parts of the checklist from part 1 as a basis and adapt them to the feature):

- **Backup or file import (ZIP):** archive list from part 1, plus import abort without partial state, verification before parsing, behavior with foreign backup versions.
- **Encryption:** crypto list from part 1, plus behavior on password loss (document the deliberate decision), key rotation, key storage location, security of backups.
- **Photo and image import:** import list from part 1, plus minimal permissions (photo picker instead of full access) and a copy into app storage.
- **HTTP client to an external service:** network list from part 1, plus offline fallback, plausibility check of the response, cache behavior, no sending of personal data.
- **Accounts, sign-in, synchronization:** authentication, session management, token storage, conflict handling, data deletion.
- **Cross-cutting:** logging without sensitive data, deleting temporary files, storage location and backup flag of the data.

Result per feature as a checklist with IDs. It feeds into `<work>/proposals/follow-up-tickets.md`. **Creating tickets in the ticket system is not part of this skill** (ground rule 6), at most as a proposal after stop 2.

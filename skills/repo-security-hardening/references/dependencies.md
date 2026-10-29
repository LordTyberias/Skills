# Phase 3: Dependencies, binaries, native components

Result in section "3 Dependencies" of `<work>/security-report.md`. The numbers for `--vulnerable`, `--deprecated`, and `--outdated` are already in the inventory. This phase covers everything that command does not see, and the origin of the findings.

Contents: A NuGet in depth, B legacy projects with `packages.config`, C shipped binaries, D native components, E npm, yarn, pnpm, F other ecosystems (Python, Java, Go, Rust, Ruby, PHP, containers), G supply chain hardening proposals.

## A. NuGet in depth (active for .NET)

1. **Origin of deprecated packages.** For every transitive deprecated package, find out which package pulls it in:

   ```powershell
   dotnet nuget why <project> <PackageId> 2>&1 | Hide-Secrets
   ```

   If the installed SDK does not have this command, read the dependency tree from `obj/project.assets.json`. Propose a fix (update the package, replace the package pulling it in, explicit reference to a newer version).
2. **Classify outdated packages.** Separate patch and minor updates (low risk, candidates for Dependabot groups) from major jumps (separate ticket). You recognize deliberate pins (license, compatibility, security pin) by comments and docs. Do not update them and list them as "deliberate".
3. **Commercial packages.** Check whether the vendor publishes security notes for newer versions (release notes, security advisories). Use available docs MCPs (e.g. vendor docs) or web research for this.
4. **Feed credentials.** Private feeds often carry the key in the URL. Research in the vendor docs what the recommended secure storage looks like (e.g. `packageSourceCredentials`, environment variables, credential provider). Document only, change nothing, do not read the user config.
5. **Unneeded or unusual packages** (e.g. web adapters in a desktop app, reference assemblies in a modern project): check by searching the code whether they are used. Unused packages increase the attack surface and belong in the proposals.
6. **NuGet audit settings.** Check the Microsoft docs for the default of `NuGetAudit` and `NuGetAuditMode` for the target framework, and propose setting both explicitly (mode `all` also covers transitive packages) if not already done. The proposal goes into `<work>/proposals/Directory.Build.props.snippet`.
7. **Unresolvable targets.** Record platform TFMs that do not resolve on the current OS (iOS, Mac Catalyst on Windows) in the report as "only checkable on the Mac host".

## B. Legacy projects with `packages.config` (active if present)

`dotnet list package` does not support `packages.config`. The packages can still be checked without touching the repo:

1. Read package IDs and versions from the `packages.config` files.
2. In `<work>/legacy-audit/<project name>/`, create a throwaway SDK project with `TargetFramework` `net48` that contains exactly these packages as `PackageReference`.
3. Next to it, create a separate `nuget.config` with `<clear />` and only `https://api.nuget.org/v3/index.json`. That way a private feed with a key never shows up in the output.
4. `dotnet restore` and `dotnet list package --vulnerable --include-transitive` as well as `--deprecated` (always through `Hide-Secrets`).
5. Result per project. Note in the report whether the project is shipped (side tool, sample code, third-party code).

## C. Shipped binaries (active if present)

Versioned DLLs, EXEs, or installers without a package manager are invisible to scanners. Create a table:

| File | File version | ProductName/Company | Signature | SHA256 | Size | Presumed origin |
|---|---|---|---|---|---|---|

- Signature status with `Get-AuthenticodeSignature`, version info with `(Get-Item <file>).VersionInfo`, hash with `Get-FileHash`.
- Classify each file: own library, third-party component (with name and version), unclear.
- For third-party components, research known vulnerabilities on the web (name plus version). Name the source and how certain the match is. Mark hits without a confirmed version match as "unclear".
- Bundled installers (e.g. .NET runtime installers in setup scripts): check the signature and compare with the current servicing version. Note where the file comes from (checked in or downloaded in the workflow) and whether a hash is verified.

## D. Native components that process foreign files (active for matching packages)

Native parsers are the typical source of memory bugs. For each of the following components that appears in the repo, determine the version used and search the vendor's official release or security notes for vulnerabilities fixed in newer versions:

- GDAL, OpenCV or OpenCvSharp, Pdfium, SkiaSharp, ImageSharp, native SQLite bundles (`SQLitePCLRaw.*`, determine the bundled SQLite version), WebView2 (SDK and separate Evergreen runtime), PDF and archive libraries, Protobuf.

Table: component, version in the repo, known advisories with source, recommendation (update, monitor, nothing needed).

## E. npm, yarn, pnpm (active for `package.json` with lockfile)

Work in the manifest's folder (in monorepos at the workspace root). Use the package manager that matches the lockfile. Install nothing, do not change the lockfile:

| Lockfile | Audit | Outdated |
|---|---|---|
| `package-lock.json` | `npm audit --package-lock-only --audit-level=low` | `npm outdated` |
| `yarn.lock` (Yarn 1) | `yarn audit --groups dependencies devDependencies` | `yarn outdated` |
| `yarn.lock` (Yarn 2+, `.yarnrc.yml`) | `yarn npm audit --all --recursive` | `yarn upgrade-interactive` is interactive: use `osv-scanner` or skip, note it |
| `pnpm-lock.yaml` | `pnpm audit` | `pnpm outdated -r` |

All output through `Hide-Secrets`. Some of these commands need `node_modules` or contact the registry; if one fails without an install, fall back to `osv-scanner` on the lockfile and note it. Separate `dependencies` (shipped in the bundle or server) from `devDependencies` (build only) in the evaluation: a vulnerable dev tool is usually lower severity, unless it runs in CI with secrets.

- **Install scripts:** list packages with `preinstall`, `install`, or `postinstall` scripts (from the lockfile or `node_modules/*/package.json` if present). Check whether `ignore-scripts` is set (`.npmrc`) or pnpm's `onlyBuiltDependencies` / Yarn's `enableScripts` restrict them.
- **Typosquatting and origin:** flag direct dependencies with names close to well-known packages, very new or barely maintained packages, and packages from git URLs or tarballs instead of the registry.

- Check whether versions in `package.json` and the lockfile match exactly and whether `.npmrc` contains hardening (e.g. `ignore-scripts=true`, `save-exact=true`).
- **Bundle comparison** if a minified bundle is checked in: copy the folder without `node_modules` to `<work>/<name>-rebuild`, run `npm ci --ignore-scripts` there, then the build script from `package.json` with output into that folder. Compare the SHA256 of the new bundle with the checked-in one. Identical, different, or not reproducible, each with a short cause (different tool version, timestamps). The checked-in bundle stays untouched.
- Whether `npm audit signatures` is feasible without an install; otherwise name the reason.

## F. Other ecosystems (active per manifest found in the inventory)

Run the audit tool of each ecosystem in the manifest's folder, output through `Hide-Secrets`. Use a tool that is already installed; anything that has to be downloaded first (including via `uvx`, `npx`, `go run`, Docker) only after consent at stop 1. Do not change lockfiles or manifests.

| Ecosystem | Audit (vulnerabilities) | Outdated |
|---|---|---|
| Python | `pip-audit -r requirements.txt` or `pip-audit` in the project (via `uvx pip-audit`) | `pip list --outdated` (only in an existing venv) |
| Java/Kotlin (Maven) | OWASP `dependency-check`, or `osv-scanner` on `pom.xml` | `mvn versions:display-dependency-updates` |
| Java/Kotlin (Gradle) | OWASP `dependency-check`, or `osv-scanner` on the Gradle lockfile | `gradle dependencyUpdates` only if the plugin is already configured |
| Go | `govulncheck ./...` (reports only vulnerable code that is actually reachable) | `go list -u -m all` |
| Rust | `cargo audit` | `cargo outdated` |
| Ruby | `bundler-audit check` | `bundle outdated` |
| PHP | `composer audit` | `composer outdated` |
| Containers | `trivy image` or `trivy fs`, `grype` | base image tag vs. current release, pinning by digest |

- **Fallback for every ecosystem:** `osv-scanner scan source -r .` reads most lockfiles (npm, pip, Poetry, uv, Go, Cargo, Maven, Gradle, Composer, Bundler, NuGet) and is a good single tool when the native one is missing.
- Without a lockfile, the resolved versions are unknown: note that, audit only the declared ranges, and propose a lockfile in `follow-up-tickets.md`.
- Mention scripts without a dependency file (Python inline metadata run via `uv run`, shell scripts that `curl | sh`) in the report: they are invisible to audit tools.
- Apply the same rules as for NuGet: classify patch/minor vs. major, respect deliberate pins, name the source of every advisory.

## G. Supply chain hardening proposals

Put into `<work>/proposals/`, where applicable:

- `Directory.Build.props.snippet`: NuGet audit and analyzer settings (details in `static-analysis.md`).
- A `global.json` proposal if the SDK is not pinned (with a `rollForward` recommendation and a note on CI and developer machines).
- `follow-up-tickets.md`: proposals for separate tickets that do not belong in this review. Typical: Central Package Management (with several packages at the same version, e.g. a vendor suite), lockfiles (only useful if all targets and feeds resolve on one machine and the private feed does not deliver differing hashes, otherwise locked mode fails), test framework migration for deprecated packages, major updates, removing unused packages, secure storage of feed credentials.

Do **not** recommend lockfiles for repos with platform targets that only resolve on another OS. A file generated on Windows would fail there in locked mode.

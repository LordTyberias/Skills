# Phase 4: Static analysis

Result in section "4 Static analysis" of `<work>/security-report.md`. Raw data (logs, SARIF) in the work dir, redacted.

Contents: A analyzer measurement (.NET), B Semgrep, C native libraries (C/C++), D language-native analyzers, E rating the findings.

## A. Analyzer measurement (.NET)

Goal: how many findings would security rules produce, before anything is locked in? In repos with `TreatWarningsAsErrors=true` every new warning breaks the build, so measure first and lock in only after approval at stop 2.

1. **Clarify the signing step.** If the release build fails locally after compiling because of a missing signing certificate (post-build step, e.g. SignTool), read the project file (read only) to find the mechanism. Choose a way that applies **only to this run via the command line** (e.g. overriding the property or condition). If there is none, ask. Analyzer messages are produced during compilation, i.e. before this step. The test project may only be built after the error: check whether it compiles with the override, and note its warnings separately.
2. **Measurement run**, without changing a file:

   ```powershell
   dotnet build <solution> -c Release --no-incremental `
     -p:AnalysisLevel=latest-recommended -p:AnalysisModeSecurity=All `
     -p:TreatWarningsAsErrors=false `
     -flp:"logfile=$work/roslyn-full.log;verbosity=normal" 2>&1 | Hide-Secrets
   ```

   Add the signing override if needed. If `AnalysisModeSecurity` does not take effect in this SDK version, check the correct spelling in the Microsoft docs (microsoft-docs MCP or web research) and name the source. Clean the log of secrets afterwards.
3. **Platform targets.** If the solution builds only part of the targets on the current OS (Android without iOS), state that in the report.
4. **Evaluation:** warnings per rule ID, per project, per severity. Separate production code from tests, tool projects, and third-party code. Compare the total with the baseline from the inventory and explain deviations. Create the top 20 rules by count.
5. **Rate security-relevant findings individually** (CA2xxx, CA3xxx, CA5xxx, path injection, XML and DTD, crypto, deserialization, regex timeouts): check them in the source and classify as real, false positive, or unclear, each with a one-sentence justification.
6. **Determine the relevant rule groups for the repo** via the Microsoft docs: crypto (weak algorithms, hard-coded keys and IVs, KDF iterations, AES-GCM usage), certificate validation, XML processing, path injection, insecure deserialization, regex timeouts. List rule ID, short description, and link. If there are planned features with crypto, ZIP, or HTTP (see `attack-surface.md`, part 2), the related rules belong in the proposal even if they have no findings today.
7. **Banned symbols:** if there is a `BannedSymbols.txt`, check whether it should be extended for the repo's attack surface (e.g. `ZipFile.ExtractToDirectory`, `System.Random` for security purposes, `HttpClientHandler` with disabled certificate validation, `XmlDocument` without a blocked resolver), and provide text proposals.
8. **Write the proposal:** `<work>/proposals/Directory.Build.props.snippet` and `<work>/proposals/analyzer-rules.md` (rule, justification, number of findings, starting severity per the rules in `SKILL.md`, stop 2). Check whether a rule collides with existing convention tests or banned symbols.

## B. Semgrep (active if semgrep is installed and languages with good coverage are present)

The skill does not install Semgrep. If it is not present, that is in the plan (stop 1) with the user's decision.

1. `semgrep --version`. Do **not** call `semgrep login`. Check whether a login exists without showing tokens. Always use `--metrics=off`. Loading rules from the registry does not upload code.
2. Find the matching registry rulesets (C#, C/C++, Python, JS/TS, React, Angular, Next.js, Java, secrets, Dockerfile, GitHub Actions) in the Semgrep docs and name them in the report.
3. Separate runs per language, SARIF into the work dir. Exclusions: third-party code (`Thirdparty/`, `vendor/`), local caches (`graphify-out/` or similar), export dumps, `bin/`, `obj/`, `node_modules/`, shipped binary folders, checked-in minified bundle. The test project runs separately.
4. **Limits for C#:** the Community Edition without login covers C# only up to version 7.0 and only within single functions. Newer C# produces parse errors and skipped files. List them separately under "Not analyzed" and do not count them as findings. For a pure C# repo, Semgrep is therefore only a coarse extra net; the Roslyn analyzers are the main check.
5. Outdated instructions: if older instructions mention `semgrep-mcp` or `uvx semgrep-mcp`: the standalone server is archived, and the MCP server now ships in the Semgrep binary (`semgrep mcp`). You do not need it for this review; the CLI is enough and produces a file you evaluate yourself.

## C. Native libraries (active for `Libs/`, `*.vcxproj`, CMake)

Parsers for external data (GPS/NMEA, file formats, network protocols) are the typical target for buffer overflows.

1. Semgrep run for C/C++ as in B, separate from C#.
2. Manual review of input paths: length fields from input, buffer sizes, `strcpy`/`sprintf`/`memcpy` without bounds checks, integer overflows in size calculations, handling of truncated or malformed records.
3. **Optional MSVC code analysis** (`/analyze`) with the existing Visual Studio toolchain via MSBuild: only run it if it works from the command line without changing project files. Otherwise only describe how it would work.
4. Tests present? (e.g. `Test.vcxproj`) Note whether fuzz or negative tests exist for parsers.

## D. Language-native analyzers (active for non-.NET languages)

Semgrep covers many languages broadly; each ecosystem also has a dedicated security linter that knows its idioms better. Run it if it is installed or was approved at stop 1, SARIF or JSON into the work dir, with the same exclusions as in B. Do not change the repo's linter configuration.

| Language | Tool |
|---|---|
| Python | `bandit -r . -f sarif` |
| Go | `gosec -fmt sarif ./...`, plus `go vet ./...` |
| Java/Kotlin | SpotBugs with Find Security Bugs (only if the build already integrates it, otherwise describe it) |
| JS/TS | ESLint with `eslint-plugin-security`, only if the repo already uses ESLint; run with an extra config from the work dir |
| Ruby on Rails | `brakeman -f sarif` |
| PHP | `psalm --taint-analysis` if Psalm is configured |
| Rust | `cargo clippy` (works without download); `unsafe` blocks reviewed manually |
| Shell | `shellcheck` |

If no dedicated tool is available, Semgrep is the main check for that language and the report says so. Proposals to integrate a tool permanently go into `<work>/proposals/analyzer-rules.md` or `ci-sast.md`, just like the .NET analyzers.

## E. Rating the findings

Every finding (analyzer, Semgrep, manual) gets: location (`file:line`), source (rule ID or "manual"), classification (real, false positive, unclear), a one-sentence justification, and a severity on the scale in `references/report.md`. Multiple reports of the same cause are merged.

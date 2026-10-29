# Phase 1: Inventory

Goal: a read-only report that records the current state of the repo and justifies the selection of check modules. Output: `artifacts/repo-inventory.md`.

Rules for this phase: read only (except `artifacts/`), counts without `bin/`, `obj/`, `node_modules/`, `.git/`, `packages/`, `.vs/`, and without local cache or graph folders (e.g. `graphify-out/`). No secret values. All command output through `Hide-Secrets`. If a command fails, note it under "Open points" and move on.

Contents: 1 Overview, 2 Structure, 3 Dependencies, 4 Vulnerability status, 5 Code quality, 6 Patterns, 7 Build and automation, 8 Claude Code environment, closing part.

## 1. Overview

- Repo name, remote (host and organization or account only, no credentials in the URL), current branch, default branch, state of the working tree.
- Number of commits (`git rev-list --count HEAD`), versioned files (`git ls-files`), size filtered and total.
- Largest folders (filtered) with file count, MB, and a short classification. Mention local untracked caches, but do not count them.
- Top 15 file extensions.
- Lines per language over the **versioned** files (`git ls-files`), physical lines. At least C#, XAML, Razor, JS/TS, Python, C/C++, Java, SQL, PowerShell/Shell, Markdown, other.
- **Working mode hints** for choosing the mode: branch name with a ticket pattern, number of distinct authors in the last 90 days (`git shortlog -sn --since=90.days HEAD`), organization instead of a personal account, signs of parallel sessions (new commits during the run).

## 2. Structure (for .NET projects)

- Solutions (`.sln`, `.slnx`) and projects with type (WinForms, WPF, MAUI, Blazor, ASP.NET, console, library, test, packaging project), TargetFramework(s), LangVersion, Nullable, ImplicitUsings. List legacy projects (old format, .NET Framework) separately.
- `dotnet --list-sdks` and the relevant excerpt of `dotnet --info`, `global.json` (pin and `rollForward`).
- Present or not, with short content: `Directory.Build.props`, `Directory.Build.targets`, `Directory.Packages.props` (Central Package Management), repo `nuget.config` (feed names and hosts only, redact paths containing keys), `packages.lock.json`, `packages.config`.
- The **user** NuGet.Config is not read. Only note that feeds (possibly with keys) may live there.
- Non-.NET repos: briefly describe the build system and structure (CMake, Gradle, npm workspaces, etc.) and adapt the sections accordingly.
- **JS/TS frontends:** framework and version from `package.json` (Angular, React, Next.js, Vue, Svelte), build tool (Angular CLI, Vite, webpack, Next.js), rendering (SPA only, SSR, static export), package manager by lockfile (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), workspaces/monorepo (Nx, Turborepo). From `angular.json`, `vite.config.*`, `next.config.*`, `webpack.config.*`: source maps in the production build, dev server proxy, configured security headers. Environment files (`environment*.ts`, `.env*`) with names only, never values.

## 3. Dependencies

- Direct PackageReferences per project, unique packages including transitive ones (`dotnet list package --include-transitive`).
- Detect commercial or private packages (prefixes like DevExpress, Telerik, Syncfusion, Infragistics, JetBrains.Annotations) and name the feed they come from, as far as visible without the user config.
- Conspicuous or unusual packages (e.g. web adapters in a desktop app, reference assemblies in a modern project, native wrappers like GDAL, OpenCV, SQLite bundles, WebView2, expression engines).
- **Non-NuGet dependencies:** `package.json`, `requirements.txt`, `pyproject.toml`, `pom.xml`, `Cargo.toml`, `go.mod`, `vcpkg.json`, `Gemfile`, noting whether a lockfile exists. Scripts (Python, PowerShell) without a dependency file. C/C++ projects without a manifest.
- **Shipped binaries:** `git ls-files '*.dll' '*.exe' '*.so' '*.jar' '*.dylib'` without `bin/obj/packages`, with count and folders. Bundled installers (e.g. runtime installers in setup scripts).

## 4. Existing vulnerability status

Per solution or, if `dotnet list` fails on a project (e.g. a `.wapproj` packaging project is reported as `packages.config`), per `.csproj`:

```powershell
dotnet list <target> package --vulnerable --include-transitive 2>&1 | Hide-Secrets
dotnet list <target> package --deprecated --include-transitive 2>&1 | Hide-Secrets
dotnet list <target> package --outdated 2>&1 | Hide-Secrets
```

- Count per category; for deprecated and outdated, the relevant packages in a table (top 10 by gap or relevance). For `--outdated`, separate direct and transitive packages.
- Note what is **not** covered: `packages.config` projects, shipped binaries, C/C++ code, platform TFMs that cannot be resolved on the current OS (e.g. iOS and Mac Catalyst on Windows).
- Check whether NuGet audit is active in the build (`NuGetAudit`, `NuGetAuditMode`) and whether hits NU1901 to NU1904 break the build.

## 5. Code quality and analysis

- `.editorconfig` (line count, number of `dotnet_diagnostic` entries, of which `error`, `warning`, `none`), `.globalconfig`, `*.ruleset`, `*.DotSettings`, `stylecop.json`, `BannedSymbols.txt`, `CodeMetricsConfig.txt`.
- Analyzer packages and the settings `AnalysisLevel`, `AnalysisMode`, `EnforceCodeStyleInBuild`, `TreatWarningsAsErrors`, `WarningsAsErrors`, `Nullable`, `IsAotCompatible`, `NoWarn` suppressions.
- Security analyzers present? (SecurityCodeScan, SonarAnalyzer, Meziantou with security rules, Roslynator.)
- Tests: projects, framework, number of test files and `[Fact]`/`[Theory]`/`[TestMethod]` attributes, coverage tool, convention tests.

## 6. Security-relevant patterns

Regex search in source and configuration files of the languages found in section 1 (e.g. `*.cs`, `*.vb`, `*.cshtml`, `*.razor`, `*.xaml`, `*.json`, `*.xml`, `*.yml`, `*.config`, `*.props`, `*.csproj`, `*.ps1`, `*.sh`, `*.plist`, `*.js`, `*.ts`, `*.py`, `*.java`, `*.kt`, `*.go`, `*.rs`, `*.rb`, `*.php`, `*.cpp`, `*.h`) with the exclusions above. Counts and paths only, **never values**. Separate production code from tests, tools, and third-party code (`Thirdparty/`, vendored code). Hits are indicators (ground rule 11).

| Group | Search patterns (examples) |
|---|---|
| Secret files | `appsettings*.json`, `.env`, `*.pfx`, `*.snk`, `*.p12`, `*.pem`, `*.key`, `*.keystore`, `*.jks`, `*.mobileprovision`, `*.config` |
| Secret assignments | assignment to `password`, `passwort`, `apikey`, `secret`, `token` (excluding `CancellationToken` and design tokens), connection string patterns. Name files only |
| SQL via strings | `$"` or `+` in strings with `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `FromSqlRaw`, `ExecuteSqlRaw` |
| Process start | `Process.Start`, `ProcessStartInfo`, `UseShellExecute` |
| Deserialization | `BinaryFormatter`, `NetDataContractSerializer`, `TypeNameHandling`, `XmlSerializer`, YamlDotNet with open types |
| XML | `XmlDocument`, `XDocument.Load`, `XmlReader.Create`, `XmlTextReader`, `DtdProcessing`, `XmlResolver` |
| Crypto | `MD5`, `SHA1`, `DES`, `RC2`, `System.Random`, `RandomNumberGenerator`, `AesGcm`, `Pbkdf2` |
| TLS and HTTP | `ServerCertificateCustomValidationCallback`, `DangerousAcceptAnyServerCertificateValidator`, `HttpClient`, `http://` literals |
| Reflection and code execution | `Assembly.Load`, `Activator.CreateInstance`, `Type.GetType`, DynamicExpresso, `CSharpScript`, `Expression.Compile` |
| Native interop | `unsafe`, `DllImport`, `LibraryImport`, `Marshal` |
| Web view and OAuth | `WebView`, `WebView2`, `BlazorWebView`, OAuth redirect handling |
| Archives and files | `ZipArchive`, `ExtractToDirectory`, `OpenFileDialog`, `File.Read*`, `File.Open*`, GDAL/OGR access |
| Web endpoints | `MapGet`, `MapPost`, `[ApiController]`, `Controller`, WCF/SOAP |
| Database | `SQLiteConnection`, `SqliteConnection`, EF, Dapper, ADO.NET |
| Clipboard, serial devices | `Clipboard`, `SerialPort`, `SerialPortStream`, NMEA, NTRIP, CAN |
| JS | `eval`, `new Function`, `innerHTML`, `dangerouslySetInnerHTML` (exclude the checked-in minified bundle, it produces false hits) |
| Angular | `bypassSecurityTrust` (Html, Url, ResourceUrl, Script, Style), `[innerHTML]`, `DomSanitizer`, `ElementRef` with `nativeElement`, `Renderer2`, `document.write`, `localStorage`/`sessionStorage` with tokens |
| React / Next.js | `dangerouslySetInnerHTML`, `href={`/`src={` with variables, `ref.current.innerHTML`, `"use server"`, `getServerSideProps`, API routes (`pages/api/`, `app/**/route.ts`), `NEXT_PUBLIC_`, `VITE_`, `REACT_APP_` |
| Browser APIs | `postMessage`, `addEventListener('message'`, `window.open`, `<script src=` without `integrity`, `localStorage.setItem` with tokens |
| Python | `pickle`, `yaml.load` without `SafeLoader`, `eval`, `exec`, `subprocess` with `shell=True`, `os.system`, `tarfile.extractall`, `verify=False`, raw SQL via f-strings |
| Java/Kotlin | `ObjectInputStream`, `Runtime.exec`, `ProcessBuilder`, `DocumentBuilderFactory` / `SAXParserFactory` without disabled DTDs, `Statement.execute` with concatenation, `TrustManager` that accepts all |
| Go | `os/exec`, `text/template` for HTML, `InsecureSkipVerify`, `database/sql` with `fmt.Sprintf`, `unsafe` |
| Rust | `unsafe`, `std::process::Command`, `danger_accept_invalid_certs` |
| Ruby, PHP | `eval`, `system`, backticks, `Marshal.load`, `YAML.load`, `unserialize`, `shell_exec`, raw SQL |
| Other languages | the equivalents of the groups above: deserialization, process start, dynamic code, string-built SQL, disabled TLS validation, XML with external entities |

Summarize: external input channels (file imports, HTTP, clipboard, serial devices), database access, endpoints, file system access.

## 7. Build and automation

- CI files: `.github/workflows/*`, `azure-pipelines.yml`, `.gitlab-ci.yml`, `Jenkinsfile`. One sentence per workflow: trigger, runner, what runs, whether actions are pinned by commit SHA.
- Dependabot or Renovate: configuration present, which ecosystems and directories, schedule.
- Whether a code scanning workflow exists (CodeQL, Semgrep, or similar).
- Local gate (e.g. `tools/gate.ps1`): what it checks.
- **Release build:** run `dotnet build <solution> -c Release --no-incremental` once (output redacted, summary instead of full text): success or failure with cause, number of errors and warnings, duration. A failure due to a missing signing certificate is a result, not a reason to abort. Note which projects compiled anyway. Build and restore write to `bin/` and `obj/`; that is normal and should be noted.

## 8. Claude Code environment

- Existing files and their purpose: `CLAUDE.md`, `ai-doc/`, `CONTEXT.md`, `.mcp.json`, `.claude/settings.json`, `.claude/agents/`, `.claude/commands/`, `.claude/skills/`, `.claude/hooks/`, `.github/copilot-instructions.md`. Whether versioned or ignored.
- `claude mcp list` (server, transport, status).
- Installed tools with version, where present: dotnet, git, gh, node, npm, python, pip, uv, uvx, pipx, semgrep, docker, gitleaks, wsl (`wsl --status`), claude. Record commands not found as "not installed".

## Closing part of the inventory

1. **Summary in 10 bullet points** (languages, frameworks, size, dependencies, vulnerabilities, analysis setup, attack surface, automation, gaps).
2. **Notable issues** with urgency. Nothing urgent is a valid result.
3. **Open points:** what could not be determined and why.
4. **Proposed plan:** table of the modules from the selection table in `SKILL.md` with "active" or "skipped" and the reason from this inventory, plus a list of missing tools with options. This part is the basis for stop 1.

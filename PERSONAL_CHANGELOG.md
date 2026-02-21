# Personal Copilot Build — Changelog

> Operational log for personal builds of GitHub Copilot Chat.
> Local-only — this file is never pushed. Tracks what shipped in each VSIX.

---

## 1.38.2026022100 — 2026-02-21

**Upstream base:** `0.38.0`

### Added
- **Build/test workflow instructions** — preamble now mandates build→parse→test→report cycle after C/C++ edits. When build/test MCP tools are available, Copilot must verify compilation before declaring changes complete.
- **Subagent dependency tracing** — preamble instructs Copilot to always launch a subagent with mastra-search/OpenGrok tools for ONTAP dependency traces. No training-data guessing, chain until complete.
- **Date-stamped versioning** — `build-and-install.sh` now uses `MAJOR.MINOR.YYYYMMDDNN` scheme matching Microsoft's pattern. Major=1 ensures our build always outranks marketplace 0.x.x.

### Changed
- `build-and-install.sh` — version bump logic rewritten from static `MAJOR.MINOR.PATCH` to date-stamped `MAJOR.MINOR.YYYYMMDDNN` with auto-increment for multiple builds per day.

---

## 1.38.0 — 2026-02-21

**Upstream base:** `0.38.0`

### Added
- **`personalPrompts.tsx`** — personal cognitive interface layer with:
  - Custom identity rules (callsign: "Super Copilot McFly", Maverick/Iceman dynamic)
  - ONTAP C/C++ domain preamble (MCP-first tool use, no training data speculation, ONTAP pattern recognition)
  - Model-aware prompt delegation (Claude 4.6 / 4.5 / Sonnet 4)
- **`build-and-install.sh`** — one-command pull→deps→build→package→install pipeline
  - Local-only (OPSEC: no pushes, ever)
  - Smart dependency skip (checks lockfile freshness)
  - Auto-detects VS Code Insiders / stable on macOS
  - Major version bump (1.x.x > marketplace 0.x.x) prevents auto-update override

### Infrastructure
- Fork at `netbrah/vscode-copilot-chat` carries structural hooks
- Local machine carries domain-specific content (ONTAP instructions never exposed to remote)
- `personalPrompts.tsx` import wired into `allAgentPrompts.ts`

---

## 0.38.0 — 2026-02-21 (pre-versioning)

**Upstream base:** `0.38.0`

### Notes
- First successful local build. Proved the build pipeline:
  - `node --experimental-strip-types .esbuild.ts --dev` (Node 22 ESM compatibility)
  - `npx @vscode/vsce package --no-dependencies` → 12.41 MB VSIX
- Discovered Microsoft's date-stamp versioning (`0.38.2026022002`)
- Discovered dual-extension conflict (marketplace + local coexisting)

---

## 0.37.0 — 2026-02-20 (exploratory)

**Upstream base:** `0.37.0`

### Notes
- Initial exploratory build before `personalPrompts.tsx` existed
- Validated that the fork + local build approach works end-to-end

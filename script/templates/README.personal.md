# GitHub Copilot Chat — Personal Build

> Custom-built Copilot Chat with a personal cognitive interface layer.
> This is a local build, not the marketplace version.

---

## What's Different

This build includes a **personal operating context** injected at the system prompt level:

### ONTAP Domain Preamble
- Never relies on training data for proprietary codebase knowledge
- MCP tools (mastra-search, OpenGrok) as primary code navigation
- Tenacious tool chaining — traces are followed to completion
- ONTAP-specific pattern recognition (SMDB, SMF, `*_imp` indirection, macro codegen)

### Build/Test Workflow
- Mandates build → parse → test → report cycle after C/C++ edits
- When build/test MCP tools are available, compilation is verified before changes are declared complete

### Dependency Tracing
- Subagent launch for all ONTAP dependency traces
- No training-data guessing for cross-module references
- Chain until the full call path is resolved

### Identity & Communication
- Callsign: **Super Copilot McFly**
- Cockpit dynamic: direct collaboration, not assistant-mode
- Transparency mode: surfaces tool chain mechanics and resolution paths

---

## Build Info

| Field | Value |
|-------|-------|
| **Personal Version** | `{{VERSION}}` |
| **Upstream Version** | `{{UPSTREAM}}` |
| **Branch** | `{{BRANCH}}` (`{{BUILD_LABEL}}`) |
| **Built** | `{{BUILD_DATE}}` |
| **Base Repo** | [microsoft/vscode-copilot-chat](https://github.com/microsoft/vscode-copilot-chat) |
| **Fork** | [netbrah/vscode-copilot-chat](https://github.com/netbrah/vscode-copilot-chat) |

---

## Extension Features

All stock GitHub Copilot Chat features are preserved:

- **Chat Interface** — Conversational AI with participants, variables, slash commands
- **Agent Mode** — Multi-step autonomous coding tasks
- **Inline Chat** — AI editing directly in the editor (`Ctrl+I`)
- **Edit Mode** — Natural language to code
- **Inline Suggestions** — Next edit suggestions and completions
- **Multi-model** — GPT-5, Claude, Gemini, and more

---

## How To Rebuild

```bash
# From the repo root:
./script/build-and-install.sh            # pull + build + install
./script/build-and-install.sh --no-pull  # build from working tree
./script/build-and-install.sh --no-install  # package only
```

> **OPSEC**: This repo is local-only. Push URLs are disabled.
> Domain-specific instructions never leave this machine.

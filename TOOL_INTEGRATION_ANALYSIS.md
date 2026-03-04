# Tool Integration Analysis — 3-Layer Architecture

> **Date**: March 4, 2026  
> **Branch**: `visible-buzzard`  
> **Authors**: Delta + APEX  
> **Status**: Planning — scaffolding next

---

## Architecture Overview

Three layers for integrating external tools into the Copilot Chat extension:

| Layer | Mechanism | Where It Runs | Best For |
|---|---|---|---|
| **Layer 1** | `mcp.json` (per-workspace) | Out-of-process sidecar | Manual, per-workspace config. What we use today. |
| **Layer 2** | Built-in MCP Definition Provider | Out-of-process sidecar, extension-managed | Settings-driven auto-start. No user wiring. Hot-reload on config change. |
| **Layer 3** | Native Tool (in-process) | Extension host | Pure-TS tools needing DI state (dirty buffers, diagnostics, git). Zero IPC. |

**Decision**: Layer 2 for all three server families (mastra, vsim, dev-tools). Layer 3 reserved for future lightweight tools.

**Pattern source**: `src/extension/githubMcp/vscode-node/githubMcp.contribution.ts` — GitHub's built-in MCP definition provider.

---

## Server Inventory

### 1. mastra (OpenGrok MCP)

- **Source**: `~/Projects/agent_tasks/opengrokmcp`
- **Runtime**: Node.js (tsx dev, tsc compiled). NOT bun-specific.
- **Transport**: STDIO (default) or HTTP/SSE (K8s)
- **Tool count**: 37 distinct tool IDs across 3 tiers (primitive, agent-wrapper, service)
- **Sidecar command**: `node`, args: `['/path/to/opengrokmcp/dist/mcp-server.js']`
- **Env vars for gating**:
  - Default STDIO: 12 tools (`STDIO_TOOLS` set)
  - `MASTRA_FULL_TOOLS=true`: all primitive tools
  - `MASTRA_ENABLE_EXTERNAL=true`: + Jira/Confluence/ReviewBoard
  - `MASTRA_ENABLE_AGENTS=true`: + agent wrappers
  - `MASTRA_ALL_TOOLS=true`: everything

### 2. vsim-mcp

- **What**: Agent assistant making calls on real ONTAP running vsim
- **Runtime**: Node.js
- **Transport**: STDIO
- **Classification**: Pure Layer 2 sidecar — talks to real ONTAP, native network
- **Sidecar command**: `node`, args: `['/path/to/vsim-mcp/dist/server.js']`

### 3. Dev Tools (Rust binary)

- **What**: `mastra` CLI for terminal-based code analysis
- **Runtime**: Compiled Rust binary
- **Transport**: STDIO
- **Classification**: Pure Layer 2 sidecar — binary handles its own I/O
- **Sidecar command**: `/path/to/mastra`, args pass-through

---

## mastra Tool Classification (37 tools)

### SIDECAR — Must Stay Out-of-Process (30+ tools)

#### OpenGrok-Dependent (Core Primitives)

| Tool | Description | Why Sidecar |
|---|---|---|
| `search` | OpenGrok definition/symbol/full-text search | Direct HTTP to OG server, adaptive concurrency, circuit breaker |
| `get_file` | Read source file content from OpenGrok | Fetches via OG API |
| `file_search` | Grep within a file (regex/substring) | Fetches file content via OG API |
| `analyze_symbol_ast` | OG references + tree-sitter AST callees | OG API + tree-sitter native bindings (C/C++ WASM) |
| `call_graph_fast` | Deterministic upstream call graph (BFS callers) | Multi-hop OG API calls |
| `smf_cli_mapping` | Iterator/table → CLI command via SMF parsing | OG search + file fetch |
| `swagger_rest_mapping` | CLI command → REST endpoint + curl examples | OG search in swagger YAML |
| `discover_subsystem_setup` | Find enable/setup/create commands | OG search for SMF patterns |
| `find_cits` | CLI command → CIT/pytest test mapping | OG search chain (SMF→NACL→usage→.stest) |
| `smf_iterator_fields` | Parse SMF schema for iterator fields | OG search + file fetch |
| `analyze_iterator` | Unified iterator analysis (5+ tools composed) | Composes multiple OG-hitting tools in parallel |
| `trace_call_chain` | Bidirectional: function ↔ tables ↔ CLI | Multi-hop OG BFS with tool composition |

#### Compound / Code Generation Tools

| Tool | Description | Why Sidecar |
|---|---|---|
| `generate_test_plan` | Unit test context: fixtures, mocks, FIJI faults | Composes `analyze_symbol_ast` + `call_graph_fast` + `prepare_unit_test_context` |
| `generate_unit_test` | C++ unit test scaffolding with mock patterns | OG search + `analyze_symbol_ast` + source extractors |
| `prepare_unit_test_context` | Raw context for LLM-based UT generation | OG search + `analyze_symbol_ast` |
| `verify_generated_code` | Verify code against live codebase (meta-graph) | `analyze_symbol_ast` + `call_graph_fast` |

#### MetaGraph Tools (Stateful — Graph Lives in Sidecar Process)

| Tool | Description | Why Sidecar |
|---|---|---|
| `graph_expand` | Expand single node from OG into MetaGraph | 1 OG API call |
| `graph_expand_batch` | Expand N nodes in parallel | N OG API calls |
| `graph_find_or_expand` | Check graph first, expand if missing | 0-1 OG API calls |
| `graph_search` | Agent-as-tool: graph-search agent | LLM orchestration + OG |
| `graph_query` | Query MetaGraph (neighbors, paths, filter) | Pure in-memory BUT graph state lives here |
| `graph_stats` | Node/edge counts | In-memory read, same process as graph |
| `graph_export` | Export graph as JSON | Serialization, same process |
| `graph_walk` | BFS traversal of MetaGraph | In-memory BFS, same process |

> **Note**: `graph_query`, `graph_stats`, `graph_export`, `graph_walk` are pure computation but operate on MetaGraph state that's populated by the sidecar. Extracting them to native would require IPC state sharing — not worth the complexity.

#### LLM Agent Wrappers

| Tool | Description | Why Sidecar |
|---|---|---|
| `ask_codeAnalyst` | LLM agent for ONTAP code analysis | LLM proxy + OG tools |
| `analyze_defect` | LLM agent for defect/panic root-cause | LLM proxy + OG tools |
| `agent_graph_search` | MCP wrapper for graph-search agent | LLM proxy + OG tools |
| `agent_investigate` | Multi-turn session-persistent investigation | LLM proxy + OG + session state |
| `ask_confluence` | LLM agent for Confluence doc analysis | LLM proxy + Confluence MCP bridge |
| `ask_jira` | LLM agent for Jira issue analysis | LLM proxy + Jira MCP bridge |
| `ask_reviewboard` | LLM agent for ReviewBoard analysis | LLM proxy + ReviewBoard API |

#### External Service Bridges

| Tool | Description | Why Sidecar |
|---|---|---|
| `search_confluence` | Direct Confluence search (no LLM) | MCP bridge to `confluence_oss` |
| `get_confluence_page` | Fetch single Confluence page | MCP bridge |
| `search_jira` | Direct Jira JQL search (no LLM) | MCP bridge to `jira_oss` |
| `get_jira_issue` | Fetch single Jira issue | MCP bridge |
| `jira_search` | JQL search (agent-internal) | MCP bridge |
| `jira_get_issue` | Get issue details (agent-internal) | MCP bridge |
| `jira_get_project_issues` | Get project issues (agent-internal) | MCP bridge |

#### ReviewBoard Tools

| Tool | Description |
|---|---|
| `rb_get_review_request` | Get review request details |
| `rb_get_review_requests` | List/search review requests |
| `rb_get_reviews` | Get reviews and ship-its |
| `rb_get_diff_patch` | Get actual code diff |
| `rb_get_diff_files` | List changed files in diff |
| `rb_get_diff_comments` | Get inline code comments |
| `rb_get_diff_revisions` | List diff revisions |
| `rb_compare_revisions` | Compare two diff revisions |
| `rb_search` | Search ReviewBoard |

#### Memory & Job Tools

| Tool | Description | Why Sidecar |
|---|---|---|
| `save_memory` | Save to semantic memory | Embedding API (OpenAI) + Vectra local vector store |
| `remember` | Semantic search of saved memories | Embedding API + Vectra |
| `list_memories` | List recent memories | Vectra local store |
| `forget` | Delete memories | Vectra local store (stateful) |
| `get_job_result` | Poll async job results | In-process job store (stateful) |
| `list_jobs` | List all session jobs | In-process job store (stateful) |

---

### NATIVE CANDIDATES — Theoretically Extractable But Not Worth It

| Tool | Description | Analysis |
|---|---|---|
| `debug_ast` | Dump tree-sitter AST | Pure local parsing. VS Code has built-in tree-sitter. Low-value utility. |
| `test_pattern` | Test tree-sitter queries against code | Same — pure computation. Low-value. |
| `graph_query` | Query MetaGraph (neighbors, paths) | Pure in-memory but graph lives in sidecar process. IPC sharing defeats purpose. |
| `graph_stats` | Graph statistics | Same — state coupling. |
| `graph_export` | Export graph as JSON | Same. |
| `graph_walk` | BFS traversal | Same. |

**Verdict**: No tools worth extracting to Layer 3 from mastra. The sidecar is the right home for all of them.

---

### BORDERLINE — Could Go Either Way (But Shouldn't)

| Tool | Description | Analysis |
|---|---|---|
| `file_search` | Grep within a file | Currently fetches from OG. VS Code's `IFileSystemService` + regex works for local files. But OG needed for 3M+ file tree. Not worth two codepaths. |
| `get_file` | Read source file content | Same — local read is trivial but OG covers full ONTAP tree. |
| `search` | Full text / definition / symbol search | OG's Lucene index over 3M+ files can't be matched by VS Code local search. |
| `analyze_symbol_ast` | Def + callers + AST | AST is local tree-sitter, but callers need OG reference search. In-process only if full clangd + compile_commands.json. |
| `smf_iterator_fields` | Parse SMF schema | Parsing is pure regex, but file discovery goes through OG. |

**Verdict**: Keep in sidecar. Dual-path maintenance isn't worth the marginal IPC savings.

---

## Agent Orchestration Layers

| Agent | ID | Tools Chained | Runtime Deps |
|---|---|---|---|
| Code Analysis | `code-analysis-agent` | 18 agentTools + jira tools | LLM proxy + OG |
| Defect Analysis | `defect-analysis-agent` | Same agentTools set | LLM proxy + OG |
| Graph Search | `graph-search-agent` | graph_walk/expand/query + search + analyze_symbol_ast + call_graph_fast | LLM proxy + OG + MetaGraph |
| Confluence | `confluence-agent` | confluence_search, get_confluence_page | LLM proxy + Confluence MCP bridge |
| Jira | `jira-agent` | jira_search, jira_get_issue | LLM proxy + Jira MCP bridge |
| ReviewBoard | `reviewboard-agent` | All 9 rb_* tools | LLM proxy + ReviewBoard API |
| Investigation | (uses code-analysis) | Full agentTools + multi-turn session | LLM proxy + OG + session state |

---

## OpenGrok Communication Architecture

- **Protocol**: Direct HTTP `fetch()` to `OPENGROK_BASE_URL` (default `http://opengrok.eng.netapp.com/source/api/v1`)
- **Adaptive concurrency**: Vegas algorithm based on RTT (not fixed pool)
- **Circuit breaker**: Auto-open on sustained failures
- **Connection pooling**: Keep-alive
- **Multi-layer caching**: File content, symbol definitions, search results
- **Parallel batch fetching**: For compound tools

---

## Implementation Plan

### Phase 1: Built-in MCP Definition Provider (Layer 2)

**Files to create/modify** (following `githubMcp.contribution.ts` pattern):

1. **NEW**: `src/extension/ontapMcp/vscode-node/ontapMcp.contribution.ts`
   - `OntapMcpContrib extends Disposable`
   - DI-injected: `IConfigurationService`, `ILogService`
   - Settings listener for hot-reload
   - Calls `lm.registerMcpServerDefinitionProvider('ontap', provider)`

2. **NEW**: `src/extension/ontapMcp/vscode-node/ontapMcpDefinitionProvider.ts`
   - Implements `provideMcpServerDefinitions()` → returns server defs for mastra, vsim, dev-tools
   - Optional `resolveMcpServerDefinition()` for auth/env resolution

3. **MODIFY**: `src/extension/configuration/configurationService.ts`
   - Add settings schema for ONTAP MCP servers (paths, env vars, tool gating)

4. **MODIFY**: `package.json`
   - Register `mcpServerDefinitionProviders` contribution

5. **MODIFY**: `src/extension/extension/vscode/contributions.ts`
   - Wire `OntapMcpContrib` into contribution system

### Phase 2: Server Registration

Three server definitions in the provider:

```typescript
// mastra (OpenGrok MCP)
{
  label: 'ONTAP Code Analysis',
  id: 'ontap-opengrok',
  command: 'node',
  args: [settings.mastraServerPath],
  env: {
    OPENGROK_BASE_URL: settings.opengrokUrl,
    MASTRA_ALL_TOOLS: 'true', // or per-profile gating
    LLM_PROXY_URL: settings.llmProxyUrl,
    // ... auth env vars
  }
}

// vsim-mcp
{
  label: 'ONTAP vsim',
  id: 'ontap-vsim',
  command: 'node',
  args: [settings.vsimServerPath],
  env: { /* vsim connection details */ }
}

// dev-tools (Rust)
{
  label: 'ONTAP Dev Tools',
  id: 'ontap-devtools',
  command: settings.devToolsBinaryPath,
  args: ['mcp-server'],
  env: {}
}
```

### Phase 3: Native Tools (Layer 3) — Future

Reserve for tools that genuinely benefit from DI state sharing:
- Dirty buffer awareness (editing a file → tool sees unsaved content)
- Diagnostic integration (compiler errors available without IPC)
- Git status (changed files, branch context)
- Workspace-scoped search (only open project, not full ONTAP tree)

**No mastra tools qualify today.** Layer 3 is for future purpose-built tools.

---

## Key Decisions

| Decision | Rationale |
|---|---|
| All mastra tools stay sidecar | OG networking stack (concurrency, circuit breaker, caching) + LLM orchestration + stateful MetaGraph. No clean extraction boundary. |
| Three separate server entries | Independent lifecycle. mastra can restart without killing vsim. |
| Settings-driven paths | No hardcoded paths. User configures server locations via VS Code settings. |
| Tool gating via env vars | mastra already supports this. Provider passes env vars from settings. |
| No dual-path local/remote | Files could be read locally or via OG, but maintaining two codepaths isn't worth marginal IPC savings. |
| MetaGraph stays in sidecar | Graph state populated by OG. Sharing across IPC doubles memory and complexity. |

---

## Build & Validate

```bash
# After scaffolding:
./script/build-and-install.sh --no-pull

# Test MCP provider registration:
# 1. Open VS Code Insiders
# 2. Configure ONTAP MCP settings
# 3. Verify servers appear in MCP server list
# 4. Verify tools are discoverable in agent mode
```

---

## References

- Pattern: [githubMcp.contribution.ts](src/extension/githubMcp/vscode-node/githubMcp.contribution.ts)
- MCP API: `lm.registerMcpServerDefinitionProvider(id, provider)`
- mastra source: `~/Projects/agent_tasks/opengrokmcp`
- Prior work: `MAX_TOOL_RESPONSE_PCT` tuned 0.5 → 0.35, 10 unused tools disabled in `agentIntent.ts`

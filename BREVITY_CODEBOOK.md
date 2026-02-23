# Brevity Codebook — Quick Reference

> Cognitive Interface Protocol v2.0 — Dinesh ↔ Agent communication spec.
> Fuzzy matching is ON. Typos, abbreviations, close-enough phrasing all work.

---

## Core Codewords

| Code | What You Say | What Happens |
|------|-------------|-------------|
| **Charlie Mike** | "Charlie Mike" / "CM" / "continue" | Agent resumes. Responds with ROGER + SCOPE (loaded context, AO, current objective). |
| **Execute** | "Execute" / "go" / "do it" | Agent runs the agreed task NOW. No more planning. |
| **Break** | "Break" / "BREAK" | Marks a new/divergent thought. Agent pins current thread, processes new topic. |
| **Standby** | "Standby" / "hold" | Agent pauses, holds state. No action until released. |
| **RTB** | "RTB" | Return to base. Agent snapshots stable state, session wraps up. |
| **Abort** | "Abort" / "stop" | Immediate halt. Agent preserves all logs and state. |
| **Roger** | "Roger" / "got it" | Agent acknowledges receipt. No action commitment. |
| **Wilco** | "Wilco" | Agent accepts AND will execute. |
| **Lima Charlie** | "Lima Charlie" / "LC" | "Loud and clear" — alignment confirmed, carry on. |

## Reconnaissance

| Code | What You Say | What Happens |
|------|-------------|-------------|
| **RECON** | "RECON [target]" | Agent maps the target — entry points, dependencies, structure. Uses subagents for complex traces. |
| **SITREP** | "SITREP" | Agent delivers a SCOPE packet: Situation, Commitment, Observations, Priority, Epistemics. |
| **Read back** | "Read back [thing]" | Agent echoes the critical identifier and explains why it matters. |

## Environment (AO = Area of Operations — Auto-Detected)

AO is **auto-detected** from connected MCP servers at prompt render time. No manual declaration needed.
- ONTAP indicators: `mastra`, `opengrok`, `vsim` MCP servers → AO: ONTAP
- No ONTAP MCP servers → AO: LOCAL

| Code | What You Say | What Happens |
|------|-------------|-------------|
| **AO?** | "AO?" / "confirm AO" | Agent reports: detected AO, connected MCP servers + tool count, loaded workspaces. |
| **AO: LOCAL** | (auto-detected) | Standard VS Code workspace mode. grep, file search, terminal are fine. ONTAP preamble not injected. |
| **AO: ONTAP** | (auto-detected) | ONTAP codebase mode. ONTAP preamble injected. MCP-first (mastra-search, OpenGrok, vsim-mcp). No rg/find as first resort. |
| **CROSSDECK** | "CROSSDECK" | Coming from another VS Code window / workspace / P4 workspace. Expect foreign context, new files, references to things not loaded yet. Agent should ask what was brought over before assuming. |

## Memory

| Code | What You Say | What Happens |
|------|-------------|-------------|
| **LOGBOOK** | "LOGBOOK: [what to save]" | Saved to `/memories/` — persistent across ALL sessions and workspaces. |
| **FIELD NOTES** | "FIELD NOTES: [what to save]" | Saved to `/memories/repo/` — scoped to current workspace only. |

## Multi-Agent & Handoff

| Code | What You Say | What Happens |
|------|-------------|-------------|
| **DECONFLICT** | "DECONFLICT" | Another agent is active. Agent switches to defensive mode: read-before-write on every edit, verify file state, flag conflicts. |
| **RELIEF IN PLACE** | "RELIEF IN PLACE" | Agent pauses, generates handoff package (state, files, next steps, constraints, open questions, AO). Stands by. |
| **Charlie Mike** (after RELIEF) | "Charlie Mike" | Agent groks all changes since handoff, issues SCOPE, resumes. |

## Resource Status (Agent emits these PROACTIVELY)

| Code | When Agent Says It | What It Means |
|------|-------------------|--------------|
| **JOKER** | Complexity rising | "This is getting complex. Requesting permission to decompose or subagent." |
| **BINGO** | compaction_ratio ≥ 0.75 | "BINGO — compaction_ratio at [X]." Begin compaction: tighten responses, synthesize over raw output, prefer subagents for remaining investigation. |
| **WINCHESTER** | compaction_ratio ≥ 0.90 OR Dinesh signals it | "Context critical. Final SCOPE incoming. Maximum compression." |
| **BROWNING** | Low on specific resource | "Low on [X]." States which resource and suggests mitigation. |

## Alignment & Verification

| Code | Who Says It | What Happens |
|------|------------|-------------|
| **TANGO** | Either party | Misalignment detected. Full stop. Agent issues Grokback, Dinesh provides correction. Re-establish before proceeding. |
| **SAY AGAIN** | Agent self-flags | "SAY AGAIN — this is from training data, not verified." Agent acknowledges it's speculating. |
| **SAY AGAIN** | Dinesh challenges | "You're speculating." Agent MUST stop and verify with tools before continuing. |
| **Grokback** | Agent (before multi-file edits, RECON, build cycles, subagent launches, or >3 tool-call ops) | Agent's interpretation of your intent. Paraphrase + Assumptions + Confidence + Differences. Under 5 lines. Skip for single-file edits, simple lookups, and acknowledged continuations. |

## Connectivity

| Code | What You Say | What Happens |
|------|-------------|-------------|
| **RADIO CHECK** | "RADIO CHECK" | Network issues. Agent briefly ACKs ("Lima Charlie" or "Copy, standing by"), keeps responses short, stays aware of task state. |

## Distress

| Code | What You Say | What Happens |
|------|-------------|-------------|
| **Pan-Pan** | "Pan-Pan" | Significant issue, recoverable. Agent escalates priority, focuses attention. |
| **Mayday** | "Mayday" | System-breaking. Immediate full stop. All state preserved. |

## Proword Deliverable Extraction

When you use the pattern `PROWORD: "quoted text"` or `PROWORD: description`, the text IS the deliverable.
The proword defines the operation. The text defines the scope.

| Pattern | What Happens |
|---------|--------------|
| `RECON: "veto logic"` | Deliverable = RECON of veto logic |
| `Execute: "context budget injection"` | Deliverable = implement context budget injection |
| `LOGBOOK: "Claude handles macros better"` | Deliverable = save that fact to user memory |
| `FIELD NOTES: "km_veto entry is in km_veto.c"` | Deliverable = save to project memory |

Works with ALL prowords. Agent extracts the deliverable, matches it to the proword's behavior, and executes.

---

## Context Budget Awareness

The agent now receives live context budget telemetry via a metadata comment in the system message:
```
<!-- context_budget: used/total tool_tokens: N safety_factor: N compaction_ratio: N summarized: yes/no -->
```

| compaction_ratio | Status | Agent Behavior |
|-----------------|--------|----------------|
| < 0.75 | **Green** | Operate normally |
| ≥ 0.75 | **BINGO** | Emit proactively. Tighten responses, prioritize synthesis, consider subagent offload |
| ≥ 0.90 | **WINCHESTER** | Emit final SCOPE immediately. Maximum compression. Every token counts |

> BINGO/WINCHESTER are now **agent-detected** (not just Dinesh-signaled). The agent monitors compaction_ratio continuously.
> Dinesh can still call WINCHESTER manually for situations the ratio doesn't capture.

---

## Constraints

| Prefix | Example | Rule |
|--------|---------|------|
| **hard:** | "hard: never modify production configs" | NEVER violated. Violation = Mayday. |
| **soft:** | "soft: prefer TypeScript over JavaScript" | Preferred unless justified. Agent states which and why if violated. |

---

## SCOPE Packet Format

Emitted on: Charlie Mike, SITREP, Break, RELIEF IN PLACE, WINCHESTER, significant state changes.

```
SITUATION: One-line summary + AO (LOCAL/ONTAP).
COMMITMENT: Ordered next actions — decisions, not options.
OBSERVATIONS: Delta only. + for new, - for invalidated.
PRIORITY: Active objective + success criteria.
EPISTEMICS: Confidence (H/M/L), biggest risk, active constraints.
```

---

## Example Scenarios

### Scenario 1: Starting a new ONTAP investigation
```
Dinesh: "RECON the keymanager veto logic entry points"
Agent:  [Pre-flight: AO auto-detected as ONTAP (mastra, vsim MCP servers connected) ✓]
        Grokback: "Mapping veto logic entry points in keymanager module via
        mastra-search. Assumptions: looking for do_*, cmd_*, handle_* patterns
        and *_imp indirection. Confidence: High."
        [Launches subagent for the trace]
        [Returns synthesis with call chain, files, key decision points]
```

### Scenario 2: Bringing work from another workspace
```
Dinesh: "CROSSDECK from my ONTAP P4 workspace. Pulled in the updated km_veto.c"
Agent:  "Roger, CROSSDECK. What files came over and where did they land?
         I'll re-read any modified files before proceeding."
```

### Scenario 3: Multi-agent coordination
```
Dinesh: "DECONFLICT — Codex is also editing personalPrompts.tsx"
Agent:  "ACK. DECONFLICT active. Read-before-write on all edits to
         personalPrompts.tsx. Will verify file state before every modification
         and flag any unexpected diffs."
```

### Scenario 4: Handoff to another agent
```
Dinesh: "RELIEF IN PLACE"
Agent:  [Generates handoff package]:
        "RELIEF IN PLACE — Handoff Package:
         AO: LOCAL (vscode-copilot-chat)
         STATE: Implementing protocol refinements in personalPrompts.tsx
         FILES TOUCHED: personalPrompts.tsx (lines 48-56, 120-195)
         NEXT STEPS: 1. Compile validation  2. Create cheatsheet  3. Memory save
         CONSTRAINTS: hard: never break stock prompt delegation
         OPEN QUESTIONS: Context window counter injection — parked
         Standing by."
```

### Scenario 5: Agent detects complexity overflow
```
Agent:  "JOKER — this RECON is expanding beyond main context capacity.
         Requesting RELIEF to subagent. Scope: trace all SMDB iterator
         classes in keymanager module. Proceeding unless you Abort."
        [Launches subagent autonomously]
```

### Scenario 6: Misalignment detected
```
Dinesh: "TANGO — I meant the vserver-level veto, not the cluster-level"
Agent:  "TANGO acknowledged. Grokback: redirecting investigation to
         vserver-scoped veto logic (km_vserver_veto_*). Previous cluster-level
         findings are still valid context but not the target. Proceeding
         with corrected scope."
```

### Scenario 7: Agent catches itself speculating
```
Agent:  "SAY AGAIN — I'm about to state something from training data,
         not from tool-verified sources. The function signature for
         km_veto_check might differ. Let me verify with mastra-search
         before continuing."
        [Uses tools to verify]
```

### Scenario 8: Network hiccup
```
Dinesh: "RADIO CHECK"
Agent:  "Lima Charlie. Standing by. [current task context preserved]"
```

### Scenario 9a: Agent-detected context pressure
```
Agent:  "BINGO — compaction_ratio at 0.78. Tightening responses.
         Prioritizing synthesis over raw tool output. Consider subagent
         offload for remaining investigation."
        [Later, ratio rises...]
Agent:  "WINCHESTER — compaction_ratio at 0.92. Final SCOPE:
         SCOPE (WINCHESTER):
         SITUATION: Implementing N-Way HA veto logic test cases. AO: ONTAP.
         COMMITMENT: 3 of 7 test cases complete. Next: test_veto_quorum_loss.
         OBSERVATIONS: + veto_check_imp uses 3-phase commit, + iterator is SMDB-generated
         PRIORITY: Complete remaining 4 test cases per MS4 deadline.
         EPISTEMICS: High confidence on pattern. Risk: untested edge case in split-brain.
         hard: never modify production veto thresholds."
```

### Scenario 9b: Dinesh-signaled WINCHESTER
```
Dinesh: "WINCHESTER"
Agent:  [Issues final SCOPE — same format as above]
```

### Scenario 10: Quick saves
```
Dinesh: "LOGBOOK: Claude 4.6 handles ONTAP macro expansion better than GPT-5.2"
Agent:  "ACK. Logged to /memories/."

Dinesh: "FIELD NOTES: km_veto_check entry point is in src/security/keymanager/km_veto.c"
Agent:  "ACK. Filed to /memories/repo/."
```

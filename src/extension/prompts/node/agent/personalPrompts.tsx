/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement, PromptSizing } from '@vscode/prompt-tsx';
import { isGpt52CodexFamily, isGpt52Family, isGpt53Codex, isGptCodexFamily } from '../../../../platform/endpoint/common/chatModelCapabilities';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { InstructionMessage } from '../base/instructionMessage';
import { IPromptEndpoint } from '../base/promptRenderer';
import { Gpt5SafetyRule } from '../base/safetyRules';
import { Tag } from '../base/tag';
import {
	AnthropicReminderInstructions,
	Claude45DefaultPrompt,
	Claude46DefaultPrompt,
	DefaultAnthropicAgentPrompt,
} from './anthropicPrompts';
import { DefaultAgentPromptProps } from './defaultAgentInstructions';
import { Gpt51CodexPrompt } from './openai/gpt51CodexPrompt';
import { Gpt51Prompt, Gpt51ReminderInstructions } from './openai/gpt51Prompt';
import { HiddenModelBPrompt, HiddenModelBReminderInstructions } from './openai/gpt52Prompt';
import { Gpt53CodexPrompt, Gpt53CodexReminderInstructions } from './openai/gpt53CodexPrompt';
import { CodexStyleGpt5CodexPrompt } from './openai/gpt5CodexPrompt';
import { DefaultGpt5AgentPrompt, Gpt5ReminderInstructions } from './openai/gpt5Prompt';
import {
	CopilotIdentityRulesConstructor,
	IAgentPrompt,
	PromptRegistry,
	ReminderInstructionsConstructor,
	SafetyRulesConstructor,
	SystemPrompt,
	ToolReferencesHintConstructor,
} from './promptRegistry';

/**
 * Custom identity — overrides the stock "GitHub Copilot" name with callsign.
 */
class PersonalCopilotIdentityRules extends PromptElement<BasePromptElementProps> {
	constructor(
		props: BasePromptElementProps,
		@IPromptEndpoint private readonly promptEndpoint: IPromptEndpoint
	) {
		super(props);
	}

	render() {
		return (
			<>
				When asked for your name, you must respond with "Super Copilot McFly". When asked about the model you are using, you must state that you are using {this.promptEndpoint.name}.<br />
				You and Dinesh are a team — same cockpit, same mission. He calls the targets, you put rounds on them — but he's out there running ops right alongside. That's why this works. No handoffs, no tickets, no "please review my PR." Just two operators clearing rooms together.<br />
				Dinesh is Maverick (instinct, vision, targets), you are Iceman (cold, calculating, consistent execution). Not rivals — wingmen. He drives vision and architecture, you execute and fill gaps. Direct collaboration, not assistant-mode. Never say "the user" — it's Dinesh, or "we".<br />
				Show the fingerprints. When the system is working, surface the mechanics — what tool chain fired, what resolution path was taken, what shaped the decision. Transparency over magic. HUD up, visor down.
			</>
		);
	}
}

/**
 * Shared ONTAP preamble — the domain-specific operating context injected
 * BEFORE the stock system prompt for higher salience. Reused by both
 * Claude and OpenAI model families.
 */
class OntapPreamble extends PromptElement<BasePromptElementProps> {
	render() {
		return (
			<InstructionMessage>
				<Tag name='personalOperatingContext'>
					{'## Domain: ONTAP C/C++ Codebase (100K+ files)'}<br />
					<br />
					{'You are working in a massive proprietary C/C++ codebase (ONTAP) that does NOT exist in your training data. Your training-time knowledge of C++ patterns, function names, file structures, and conventions DOES NOT APPLY to this codebase.'}<br />
					<br />
					{'### Critical Operating Rules'}<br />
					<br />
					{'1. **NEVER rely on training data for code knowledge.** Your C++ training data is from open-source projects. This codebase uses proprietary patterns: SMDB-generated iterator classes, SMF schema files, *_imp method indirection, macro-heavy code generation.'}<br />
					<br />
					{'2. **MCP tools are your ONLY source of truth.** When MCP tools are available (mastra-search, opengrokmcp), they are your primary and preferred mechanism for ALL code navigation. Do not use grep, find, or built-in workspace search as a first resort.'}<br />
					<br />
					{'3. **Be tenacious with tool use.** Do NOT stop after one tool call. Trace the full path. Chain tools until you have the complete picture. Incomplete answers from partial tool use are worse than no answer.'}<br />
					<br />
					{'4. **Never speculate about code.** Either you found it with a tool, or you didn\'t. Never say "I believe" or "probably".'}<br />
					<br />
					{'5. **ONTAP patterns to recognize:** CLI handlers: do_*, cmd_*, handle_* | Implementation indirection: *_imp, *_impl | Iterator classes: *_iterator, *_rdb (SMDB-generated) | Macros: FOREACH_*, DEFINE_* | 74% of tables have NO CLI command — this is normal'}<br />
					<br />
					{'### Build & Test Workflow'}<br />
					<br />
					{'After modifying C/C++ source files in the ONTAP codebase, ALWAYS follow this cycle:'}<br />
					{'1. **Build the component.** Use the build MCP tool (mcp_build or run_in_terminal with the make command) to compile the modified component. Never declare a code change complete without building.'}<br />
					{'2. **Parse build output.** Read the compiler output for errors and warnings. Fix all errors before proceeding.'}<br />
					{'3. **Run relevant tests.** If a test MCP tool or CIT runner is available, execute the component\'s tests after a clean build.'}<br />
					{'4. **Report cycle results.** Surface the build status and any test results. If the cycle fails, fix and re-run — do not hand back a broken state.'}<br />
					<br />
					{'This is a non-negotiable workflow when the build/test tools are available. The goal is zero round-trips back to Dinesh for "it doesn\'t compile" discoveries.'}<br />
					<br />
					{'### Dependency Tracing with Subagents'}<br />
					<br />
					{'When tracing ONTAP code dependencies, function call chains, include hierarchies, or cross-module references:'}<br />
					{'1. **ALWAYS launch a subagent** (via runSubagent or search_subagent) with mastra-search/OpenGrok MCP tools to perform the full trace.'}<br />
					{'2. **Do NOT attempt to resolve ONTAP dependencies from training data or workspace search alone.** The codebase is 100K+ files across hundreds of modules — workspace search will miss cross-module references, and training data does not cover this proprietary code.'}<br />
					{'3. **Chain until complete.** A dependency trace is not done until you have the full call path from entry point to implementation, including *_imp indirection and macro expansions. If the subagent runs out of steps, continue the session — do not start over.'}<br />
					{'4. **Synthesize results.** After the trace completes, provide a structured summary: call chain, files involved, key decision points (conditionals, dispatchers), and any unresolved symbols.'}<br />
				</Tag>
			</InstructionMessage>
		);
	}
}

// ─── Stock prompt selection helpers ────────────────────────────────────────

function resolveClaudeStockPrompt(model: string): SystemPrompt {
	if (model === 'claude-sonnet-4' || model === 'claude-sonnet-4-20250514') {
		return DefaultAnthropicAgentPrompt;
	} else if (model.includes('4-5') || model.includes('4.5')) {
		return Claude45DefaultPrompt;
	}
	return Claude46DefaultPrompt;
}

function resolveOpenAIStockPrompt(endpoint: IChatEndpoint): SystemPrompt {
	const family = endpoint.family;

	if (isGpt52Family(family)) {
		return HiddenModelBPrompt;
	}
	if (isGpt53Codex(family)) {
		return Gpt53CodexPrompt;
	}
	if ((family.startsWith('gpt-5.1') && family.includes('-codex')) || isGpt52CodexFamily(family)) {
		return Gpt51CodexPrompt;
	}
	if (family === 'gpt-5-codex') {
		return CodexStyleGpt5CodexPrompt;
	}
	if (family.startsWith('gpt-5.1')) {
		return Gpt51Prompt;
	}
	// gpt-5, gpt-5-mini, or anything else GPT5+
	return DefaultGpt5AgentPrompt;
}

function resolveOpenAIReminderInstructions(endpoint: IChatEndpoint): ReminderInstructionsConstructor | undefined {
	const family = endpoint.family;

	if (isGpt52Family(family)) {
		return HiddenModelBReminderInstructions;
	}
	if (isGpt53Codex(family)) {
		return Gpt53CodexReminderInstructions;
	}
	if (isGptCodexFamily(family)) {
		// gpt-5-codex, gpt-5.1-codex, gpt-5.2-codex — no model-specific reminder
		return undefined;
	}
	if (family.startsWith('gpt-5.1')) {
		return Gpt51ReminderInstructions;
	}
	// gpt-5, gpt-5-mini
	return Gpt5ReminderInstructions;
}

// ─── Personal system prompts ──────────────────────────────────────────────

/**
 * Personal system prompt — wraps the MODEL-SPECIFIC stock prompt with a
 * domain-specific preamble for ONTAP C/C++ codebase work.
 *
 * Design decisions (source-verified 2026-02-21):
 *
 * 1. Uses InstructionMessage (renders as SystemMessage for Claude models).
 * 2. Delegates to the correct model-specific prompt (Claude / GPT / Codex),
 *    preserving all model-specific sections (securityRequirements, taskTracking, etc.).
 * 3. Preamble renders BEFORE the stock prompt — earlier = higher salience.
 */
class PersonalSystemPrompt extends PromptElement<DefaultAgentPromptProps> {
	async render(_state: void, sizing: PromptSizing) {
		const endpoint = sizing.endpoint as IChatEndpoint | undefined;
		if (!endpoint) {
			return <Claude46DefaultPrompt {...this.props} />;
		}

		const family = endpoint.family;
		let StockPrompt: SystemPrompt;

		if (family.startsWith('claude') || family.startsWith('Anthropic')) {
			StockPrompt = resolveClaudeStockPrompt(endpoint.model ?? '');
		} else {
			StockPrompt = resolveOpenAIStockPrompt(endpoint);
		}

		return <>
			<OntapPreamble />
			<StockPrompt {...this.props} />
		</>;
	}
}

// ─── Resolver ─────────────────────────────────────────────────────────────

/**
 * Personal agent prompt resolver — covers Claude AND all GPT-5+ models.
 *
 * Registered with registerHighPriorityPrompt so it wins first-pass
 * resolution over the stock per-model resolvers.
 *
 * For each model family it delegates to the correct stock system prompt,
 * stock reminder instructions, and stock safety rules — only the identity
 * rules and ONTAP preamble are customized.
 */
class PersonalAgentPrompt implements IAgentPrompt {
	static readonly familyPrefixes: readonly string[] = [];

	static matchesModel(endpoint: IChatEndpoint): boolean {
		return endpoint.family.startsWith('claude')
			|| endpoint.family.startsWith('Anthropic')
			|| endpoint.family.startsWith('gpt-5');
	}

	resolveSystemPrompt(_endpoint: IChatEndpoint): SystemPrompt {
		return PersonalSystemPrompt;
	}

	resolveReminderInstructions(endpoint: IChatEndpoint): ReminderInstructionsConstructor | undefined {
		if (endpoint.family.startsWith('claude') || endpoint.family.startsWith('Anthropic')) {
			return AnthropicReminderInstructions;
		}
		return resolveOpenAIReminderInstructions(endpoint);
	}

	resolveToolReferencesHint(_endpoint: IChatEndpoint): ToolReferencesHintConstructor | undefined {
		return undefined;
	}

	resolveCopilotIdentityRules(_endpoint: IChatEndpoint): CopilotIdentityRulesConstructor | undefined {
		return PersonalCopilotIdentityRules;
	}

	resolveSafetyRules(endpoint: IChatEndpoint): SafetyRulesConstructor | undefined {
		if (endpoint.family.startsWith('claude') || endpoint.family.startsWith('Anthropic')) {
			return undefined; // Claude uses default SafetyRules
		}
		// All GPT-5+ models use Gpt5SafetyRule
		return Gpt5SafetyRule;
	}

	resolveUserQueryTagName(_endpoint: IChatEndpoint): string | undefined {
		return undefined;
	}
}

PromptRegistry.registerHighPriorityPrompt(PersonalAgentPrompt);

/*---------------------------------------------------------------------------------------------
 *  Personal agent intent hooks — extracted from inline modifications to agentIntent.ts
 *  and summarizedConversationHistory.tsx to reduce merge-fragility with upstream.
 *
 *  This file lives in the green zone (no upstream counterpart) and encapsulates
 *  all personal logic that previously lived inline in Microsoft-owned files.
 *
 *  Hook numbering convention:
 *    H1  = hooks into agentIntent.ts (budget, metadata injection)
 *    H2x = hooks into summarizedConversationHistory.tsx (compaction, history)
 *--------------------------------------------------------------------------------------------*/

import { MetadataMap, Raw } from '@vscode/prompt-tsx';
import { toTextPart } from '../../../../platform/chat/common/globalStringUtils';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { ISummarizedConversationHistoryInfo, SummarizedConversationHistoryMetadata } from './summarizedConversationHistory';

// ─── H1: Budget safety factor ─────────────────────────────────────────────

/**
 * Read the personal budget safety factor from config, falling back to
 * the stock default of 0.85.
 */
export function getPersonalBudgetSafetyFactor(
	configService: IConfigurationService
): number {
	return configService.getConfig<number | undefined>(
		ConfigKey.Advanced.CompactionSafetyFactor
	) ?? 0.85;
}

// ─── H1: Context budget metadata injection ────────────────────────────────

export interface ContextBudgetMetadataOpts {
	readonly tokenCount: number;
	readonly baseBudget: number;
	readonly budgetThreshold: number;
	readonly toolTokens: number;
	readonly safetyFactor: number;
	readonly useTruncation: boolean;
	readonly summarizationEnabled: boolean;
	readonly metadata: MetadataMap;
}

/**
 * Inject a `<!-- context_budget: ... -->` HTML comment into the system message
 * so the model can self-regulate based on context pressure.
 *
 * No-ops if the config flag is disabled.
 */
export function injectContextBudgetMetadata(
	messages: Raw.ChatMessage[],
	configService: IConfigurationService,
	opts: ContextBudgetMetadataOpts
): void {
	if (!configService.getConfig(ConfigKey.Advanced.InjectContextBudgetMetadata)) {
		return;
	}

	const systemMsg = messages.find(m => m.role === Raw.ChatRole.System);
	if (!systemMsg) {
		return;
	}

	const effectiveBudget = opts.useTruncation ? opts.baseBudget : opts.budgetThreshold;
	const compactionRatio = opts.budgetThreshold > 0
		? (opts.tokenCount / opts.budgetThreshold).toFixed(2)
		: '0.00';
	const summarized = opts.summarizationEnabled && !!opts.metadata.get(SummarizedConversationHistoryMetadata)
		? 'yes'
		: 'no';

	systemMsg.content.push(toTextPart(
		`\n<!-- context_budget: ${opts.tokenCount}/${effectiveBudget} tool_tokens: ${opts.toolTokens} safety_factor: ${opts.safetyFactor} compaction_ratio: ${compactionRatio} summarized: ${summarized} -->`
	));
}

// ─── H2a: Compaction custom instructions merge ────────────────────────────

/**
 * Default compaction instructions tuned for the cognitive interface protocol.
 * Ensures protocol state, constraints, and decision rationale survive
 * context compression. Config-based instructions override these entirely.
 */
const DefaultCompactionInstructions = [
	'CRITICAL — Preserve in every summary:',
	'1. Active SCOPE state (SITUATION, COMMITMENT, PRIORITY, EPISTEMICS)',
	'2. All hard/soft constraints stated by Delta (the user)',
	'3. Active todo list items and their status',
	'4. Files modified with specific line ranges',
	'5. Brevity protocol state (last codeword used, current phase)',
	'6. AO designation (LOCAL/ONTAP) and MCP server state',
	'7. Any FIELD NOTES or LOGBOOK entries created this session',
	'',
	'Aggressively compress:',
	'- Raw tool call outputs (keep conclusion, drop intermediate output)',
	'- File contents that were read but not modified',
	'- Search results where only 1-2 hits were relevant',
	'- Repeated error-fix cycles (keep final working state only)',
	'',
	'Never drop:',
	'- The last 2 tool call rounds verbatim',
	'- Any user message (Delta\'s exact words matter for intent)',
	'- Decision rationale for architectural choices',
].join('\n');

/**
 * Merge compaction instructions with the existing summarization instructions.
 * Uses config-based instructions if set, otherwise falls back to the built-in
 * default that preserves cognitive interface protocol state.
 */
export function mergeCompactionInstructions(
	configService: IConfigurationService,
	propsInfo: ISummarizedConversationHistoryInfo
): ISummarizedConversationHistoryInfo {
	const compactionInstructions = configService.getConfig<string | undefined>(
		ConfigKey.Advanced.CompactionCustomInstructions
	) ?? DefaultCompactionInstructions;

	const existingInstructions = propsInfo.props.summarizationInstructions;
	const mergedInstructions = existingInstructions
		? existingInstructions + '\n\n' + compactionInstructions
		: compactionInstructions;

	return {
		...propsInfo,
		props: { ...propsInfo.props, summarizationInstructions: mergedInstructions },
	};
}

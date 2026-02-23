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
 * Merge config-based custom compaction instructions with the existing
 * summarization instructions in the props. Returns the original propsInfo
 * unchanged if no custom instructions are configured.
 */
export function mergeCompactionInstructions(
	configService: IConfigurationService,
	propsInfo: ISummarizedConversationHistoryInfo
): ISummarizedConversationHistoryInfo {
	const configInstructions = configService.getConfig<string | undefined>(
		ConfigKey.Advanced.CompactionCustomInstructions
	);
	if (!configInstructions) {
		return propsInfo;
	}

	const existingInstructions = propsInfo.props.summarizationInstructions;
	const mergedInstructions = existingInstructions
		? existingInstructions + '\n\n' + configInstructions
		: configInstructions;

	return {
		...propsInfo,
		props: { ...propsInfo.props, summarizationInstructions: mergedInstructions },
	};
}

/*---------------------------------------------------------------------------------------------
 *  Unit tests for personalAgentIntentHooks.ts — the green-zone extraction layer
 *  that encapsulates personal customizations away from upstream Microsoft code.
 *--------------------------------------------------------------------------------------------*/

import { MetadataMap, Raw } from '@vscode/prompt-tsx';
import { describe, expect, it, vi } from 'vitest';
import { toTextParts } from '../../../../../platform/chat/common/globalStringUtils';
import { ConfigKey, IConfigurationService } from '../../../../../platform/configuration/common/configurationService';
import {
	type ContextBudgetMetadataOpts,
	getPersonalBudgetSafetyFactor,
	injectContextBudgetMetadata,
	mergeCompactionInstructions,
} from '../personalAgentIntentHooks';
import type { ISummarizedConversationHistoryInfo } from '../summarizedConversationHistory';
import { SummarizedConversationHistoryMetadata } from '../summarizedConversationHistory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockConfigService(overrides: Map<unknown, unknown> = new Map()): IConfigurationService {
	return {
		getConfig: vi.fn((key: unknown) => overrides.get(key)),
	} as unknown as IConfigurationService;
}

function makeSystemMessage(text = 'You are a helpful assistant.'): Raw.ChatMessage[] {
	return [
		{ role: Raw.ChatRole.System, content: toTextParts(text) },
		{ role: Raw.ChatRole.User, content: toTextParts('Hello') },
	];
}

function makeDefaultOpts(overrides: Partial<ContextBudgetMetadataOpts> = {}): ContextBudgetMetadataOpts {
	return {
		tokenCount: 5000,
		baseBudget: 10000,
		budgetThreshold: 8500,
		toolTokens: 1500,
		safetyFactor: 0.85,
		useTruncation: false,
		summarizationEnabled: false,
		metadata: MetadataMap.empty,
		...overrides,
	};
}

function makeMinimalPropsInfo(summarizationInstructions?: string): ISummarizedConversationHistoryInfo {
	return {
		props: { summarizationInstructions } as ISummarizedConversationHistoryInfo['props'],
		summarizedToolCallRoundId: 'round-1',
	};
}

// ─── getPersonalBudgetSafetyFactor ────────────────────────────────────────────

describe('getPersonalBudgetSafetyFactor', () => {
	it('returns configured value when set', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.CompactionSafetyFactor, 0.75]]));
		expect(getPersonalBudgetSafetyFactor(config)).toBe(0.75);
	});

	it('returns 0.85 default when config is undefined', () => {
		const config = mockConfigService();
		expect(getPersonalBudgetSafetyFactor(config)).toBe(0.85);
	});

	it('returns 0.85 default when config is null', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.CompactionSafetyFactor, null]]));
		// null ?? 0.85 should still give 0.85
		expect(getPersonalBudgetSafetyFactor(config)).toBe(0.85);
	});
});

// ─── injectContextBudgetMetadata ──────────────────────────────────────────────

describe('injectContextBudgetMetadata', () => {
	it('injects metadata comment into system message when enabled', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.InjectContextBudgetMetadata, true]]));
		const messages = makeSystemMessage();
		const opts = makeDefaultOpts();

		injectContextBudgetMetadata(messages, config, opts);

		const systemContent = messages[0].content;
		const lastPart = systemContent[systemContent.length - 1] as Raw.ChatCompletionContentPartText;
		expect(lastPart.text).toContain('<!-- context_budget:');
		expect((lastPart as Raw.ChatCompletionContentPartText).text).toContain('5000/8500');
		expect((lastPart as Raw.ChatCompletionContentPartText).text).toContain('tool_tokens: 1500');
		expect((lastPart as Raw.ChatCompletionContentPartText).text).toContain('safety_factor: 0.85');
	});

	it('no-ops when config flag is disabled', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.InjectContextBudgetMetadata, false]]));
		const messages = makeSystemMessage();
		const originalLength = messages[0].content.length;

		injectContextBudgetMetadata(messages, config, makeDefaultOpts());

		expect(messages[0].content.length).toBe(originalLength);
	});

	it('no-ops when config flag is undefined (not set)', () => {
		const config = mockConfigService();
		const messages = makeSystemMessage();
		const originalLength = messages[0].content.length;

		injectContextBudgetMetadata(messages, config, makeDefaultOpts());

		expect(messages[0].content.length).toBe(originalLength);
	});

	it('no-ops when no system message exists', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.InjectContextBudgetMetadata, true]]));
		const messages: Raw.ChatMessage[] = [
			{ role: Raw.ChatRole.User, content: toTextParts('Hello') },
		];

		// Should not throw
		injectContextBudgetMetadata(messages, config, makeDefaultOpts());
		expect(messages.length).toBe(1);
	});

	it('uses baseBudget as effective budget when useTruncation is true', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.InjectContextBudgetMetadata, true]]));
		const messages = makeSystemMessage();
		const opts = makeDefaultOpts({ useTruncation: true, baseBudget: 10000, budgetThreshold: 8500 });

		injectContextBudgetMetadata(messages, config, opts);

		const lastPart = messages[0].content[messages[0].content.length - 1] as Raw.ChatCompletionContentPartText;
		// With useTruncation, effective budget = baseBudget (10000), not budgetThreshold (8500)
		expect(lastPart.text).toContain('5000/10000');
	});

	it('uses budgetThreshold as effective budget when useTruncation is false', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.InjectContextBudgetMetadata, true]]));
		const messages = makeSystemMessage();
		const opts = makeDefaultOpts({ useTruncation: false });

		injectContextBudgetMetadata(messages, config, opts);

		const lastPart = messages[0].content[messages[0].content.length - 1] as Raw.ChatCompletionContentPartText;
		expect(lastPart.text).toContain('5000/8500');
	});

	it('computes compaction_ratio correctly', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.InjectContextBudgetMetadata, true]]));
		const messages = makeSystemMessage();
		// tokenCount=6800, budgetThreshold=8500 → ratio = 6800/8500 = 0.80
		const opts = makeDefaultOpts({ tokenCount: 6800 });

		injectContextBudgetMetadata(messages, config, opts);

		const lastPart = messages[0].content[messages[0].content.length - 1] as Raw.ChatCompletionContentPartText;
		expect(lastPart.text).toContain('compaction_ratio: 0.80');
	});

	it('reports compaction_ratio 0.00 when budgetThreshold is zero', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.InjectContextBudgetMetadata, true]]));
		const messages = makeSystemMessage();
		const opts = makeDefaultOpts({ budgetThreshold: 0 });

		injectContextBudgetMetadata(messages, config, opts);

		const lastPart = messages[0].content[messages[0].content.length - 1] as Raw.ChatCompletionContentPartText;
		expect(lastPart.text).toContain('compaction_ratio: 0.00');
	});

	it('reports summarized: yes when summarization enabled and metadata present', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.InjectContextBudgetMetadata, true]]));
		const messages = makeSystemMessage();
		const metadata = MetadataMap.from([new SummarizedConversationHistoryMetadata('r1', 'summary text')]);
		const opts = makeDefaultOpts({ summarizationEnabled: true, metadata });

		injectContextBudgetMetadata(messages, config, opts);

		const lastPart = messages[0].content[messages[0].content.length - 1] as Raw.ChatCompletionContentPartText;
		expect(lastPart.text).toContain('summarized: yes');
	});

	it('reports summarized: no when summarization enabled but no metadata', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.InjectContextBudgetMetadata, true]]));
		const messages = makeSystemMessage();
		const opts = makeDefaultOpts({ summarizationEnabled: true, metadata: MetadataMap.empty });

		injectContextBudgetMetadata(messages, config, opts);

		const lastPart = messages[0].content[messages[0].content.length - 1] as Raw.ChatCompletionContentPartText;
		expect(lastPart.text).toContain('summarized: no');
	});

	it('reports summarized: no when summarization disabled even with metadata', () => {
		const config = mockConfigService(new Map([[ConfigKey.Advanced.InjectContextBudgetMetadata, true]]));
		const messages = makeSystemMessage();
		const metadata = MetadataMap.from([new SummarizedConversationHistoryMetadata('r1', 'summary text')]);
		const opts = makeDefaultOpts({ summarizationEnabled: false, metadata });

		injectContextBudgetMetadata(messages, config, opts);

		const lastPart = messages[0].content[messages[0].content.length - 1] as Raw.ChatCompletionContentPartText;
		expect(lastPart.text).toContain('summarized: no');
	});
});

// ─── mergeCompactionInstructions ──────────────────────────────────────────────

describe('mergeCompactionInstructions', () => {
	it('returns propsInfo unchanged when no custom instructions configured', () => {
		const config = mockConfigService();
		const propsInfo = makeMinimalPropsInfo('existing instructions');

		const result = mergeCompactionInstructions(config, propsInfo);

		expect(result).toBe(propsInfo); // same reference, not a copy
		expect(result.props.summarizationInstructions).toBe('existing instructions');
	});

	it('merges config instructions with existing instructions', () => {
		const config = mockConfigService(new Map([
			[ConfigKey.Advanced.CompactionCustomInstructions, 'custom compaction rules'],
		]));
		const propsInfo = makeMinimalPropsInfo('existing instructions');

		const result = mergeCompactionInstructions(config, propsInfo);

		expect(result.props.summarizationInstructions).toBe('existing instructions\n\ncustom compaction rules');
		expect(result).not.toBe(propsInfo); // new object, immutable
	});

	it('uses config instructions alone when no existing instructions', () => {
		const config = mockConfigService(new Map([
			[ConfigKey.Advanced.CompactionCustomInstructions, 'custom compaction rules'],
		]));
		const propsInfo = makeMinimalPropsInfo(undefined);

		const result = mergeCompactionInstructions(config, propsInfo);

		expect(result.props.summarizationInstructions).toBe('custom compaction rules');
	});

	it('preserves other props fields when merging', () => {
		const config = mockConfigService(new Map([
			[ConfigKey.Advanced.CompactionCustomInstructions, 'custom rules'],
		]));
		const propsInfo = makeMinimalPropsInfo('existing');

		const result = mergeCompactionInstructions(config, propsInfo);

		expect(result.summarizedToolCallRoundId).toBe('round-1');
	});
});

'use strict';

const {
  adaptClaudeAdvice,
  adaptCodexLocalAdvice,
} = require('../../../out/adviceEffectiveness/adapters.js');
const {
  prepareAdviceSnapshot,
} = require('../../../out/adviceEffectiveness/integration.js');
const {
  buildAdviceAggregateSnapshot,
} = require('../../../out/adviceEffectiveness/payload.js');
const { prepareAiInvocation, previewAiInvocation } = require('../../../out/adviceEffectiveness/preparedRequest.js');

const PROMPT_SENTINEL = 'SAFE_PROMPT_SENTINEL_測試_🚦';
const USER_CONTEXT_SENTINEL = 'SAFE_USER_CONTEXT_SENTINEL_私人_🔒';
const GENERATED_AT = '2026-07-20T12:00:00.000Z';

function numericUsage() {
  return {
    totalInputTokens: 47_600,
    totalOutputTokens: 8_300,
    totalCacheCreationTokens: 17_900,
    totalCacheReadTokens: 288_000,
    totalCost: 3.05,
    costBreakdown: {
      input: 0.44,
      output: 1.52,
      cacheWrite: 0.82,
      cacheRead: 0.27,
    },
    messageCount: 25,
    modelBreakdown: {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 38_200,
        outputTokens: 6_100,
        cacheCreationTokens: 14_800,
        cacheReadTokens: 236_000,
        cost: 2.74,
        count: 18,
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 9_400,
        outputTokens: 2_200,
        cacheCreationTokens: 3_100,
        cacheReadTokens: 52_000,
        cost: 0.31,
        count: 7,
      },
    },
  };
}

function requireAdapter(result, provider) {
  if (!result.ok) {
    throw new Error(`${provider} advice fixture failed: ${result.issues.join(', ')}`);
  }
  return result.value;
}

function requireSnapshot(result, mode) {
  if (!result.ok) {
    throw new Error(`${mode} advice snapshot failed: ${result.reason}`);
  }
  return result.value;
}

function snapshotMessage(snapshot, suffix) {
  const preview = previewAiInvocation(prepareAiInvocation({
    kind: 'advice', apiFormat: 'openai', apiUrl: 'https://example.invalid/v1', model: 'safe-model',
    systemPrompt: 'Return strict JSON.', userContent: snapshot.preview.body, dataMode: snapshot.preview.dataMode,
    sourceRevision: 'fixture', consentGeneration: 0, createdAtEpochMs: Date.parse(GENERATED_AT),
  }));
  return {
    command: 'adviceSnapshotResult',
    ok: true,
    snapshotId: `snapshot-${snapshot.preview.sha256.slice(suffix, suffix + 24)}`,
    provider: snapshot.provider,
    contentType: snapshot.preview.contentType,
    dataMode: snapshot.preview.dataMode,
    promptSampleCount: snapshot.preview.promptSampleCount,
    endpoint: preview.endpoint, apiFormat: preview.apiFormat, model: preview.model,
    utf8Bytes: preview.utf8Bytes,
    sha256: preview.sha256,
    body: preview.body,
  };
}

/**
 * Test-only vertical fixture built through the production adapters and sealed
 * snapshot helper. Inputs are numeric aggregates except for the single prompt
 * sentinel, which remains host-side until the explicit prompt-opt-in test.
 */
function buildAdviceEffectivenessFixture({ locale = 'en' } = {}) {
  const aggregate = buildAdviceAggregateSnapshot(numericUsage(), 'overall', 30);
  const claude = requireAdapter(adaptClaudeAdvice({
    adviceId: 'advice-claude-ui-fixture',
    generatedAt: GENERATED_AT,
    locale,
    aggregate,
    sessionSummary: {
      scope: 'overall',
      windowDays: 30,
      totalSessions: 8,
      longSessionCount: 3,
      largeContextSessionCount: 2,
    },
    frameworkOverhead: {
      frameworkEstimatedTokens: 4_760,
      observedInputEstimatedTokens: 47_600,
      classifiedEvents: 25,
    },
  }), 'Claude');

  const codex = requireAdapter(adaptCodexLocalAdvice({
    adviceId: 'advice-codex-ui-fixture',
    generatedAt: GENERATED_AT,
    locale,
    scope: '30d',
    insights: [
      {
        kind: 'effort-comparison',
        severity: 'normal',
        scope: '30d',
        evidence: { highEffortFresh: 700, lowMediumEffortFresh: 300 },
        proxy: true,
      },
      {
        kind: 'cache-context',
        severity: 'info',
        scope: '30d',
        evidence: { processedToFreshRatio: 3, cachedInputShare: 0.7 },
        proxy: true,
      },
    ],
    behavior: {
      childFreshShare: 0.2,
      approvalReviewerFreshShare: 0.1,
      highEffortFreshShare: 0.7,
      processedToFreshRatio: 3,
      cacheShare: 0.7,
      postPatchToolCallsPerPatchCall: 4,
    },
    quality: {
      indexComplete: true,
      identityComplete: true,
      periodComplete: true,
      qualityFlags: [],
    },
  }), 'Codex');

  const claudeState = {
    provider: 'claude',
    contract: claude.contract,
    remotePreviewEligible: claude.remoteEvidenceEligible,
    aggregate: claude.aggregate,
    userContext: USER_CONTEXT_SENTINEL,
    promptSamples: [{ text: PROMPT_SENTINEL }],
  };
  const codexState = {
    provider: 'codex',
    contract: codex.contract,
    remotePreviewEligible: codex.remoteEvidenceEligible,
    promptSamples: [],
  };
  const aggregateOnly = requireSnapshot(prepareAdviceSnapshot(claudeState, {
    aggregate: 'explicit',
    promptSamples: 'not-granted',
  }), 'aggregates-only');
  const withPromptSamples = requireSnapshot(prepareAdviceSnapshot(claudeState, {
    aggregate: 'explicit',
    promptSamples: 'explicit',
  }), 'aggregates-with-prompt-samples');

  return {
    promptSentinel: PROMPT_SENTINEL,
    userContextSentinel: USER_CONTEXT_SENTINEL,
    states: { claude: claudeState, codex: codexState },
    snapshotMessages: {
      aggregateOnly: snapshotMessage(aggregateOnly, 0),
      withPromptSamples: snapshotMessage(withPromptSamples, 8),
    },
  };
}

module.exports = {
  PROMPT_SENTINEL,
  USER_CONTEXT_SENTINEL,
  buildAdviceEffectivenessFixture,
};

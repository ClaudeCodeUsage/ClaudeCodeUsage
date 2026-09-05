import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  createCodexParserState,
  parseCodexLine,
} from '../providers/codex/codexParser';

interface TokenLineOptions {
  inputTotal: number;
  inputLast: number;
  cachedInput?: number;
  cachedInputLast?: number;
  outputTotal?: number;
  outputLast?: number;
  reasoningOutput?: number;
  reasoningOutputLast?: number;
  rateLimit?: {
    usedPercent: number;
    windowMinutes: number;
    resetsAtSeconds: number;
  };
}

function tokenLine(options: TokenLineOptions): string {
  const outputTotal = options.outputTotal ?? 20;
  const outputLast = options.outputLast ?? 20;
  return JSON.stringify({
    timestamp: '2026-07-20T00:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: options.inputTotal,
          cached_input_tokens: options.cachedInput ?? 0,
          output_tokens: outputTotal,
          reasoning_output_tokens: options.reasoningOutput ?? 0,
          total_tokens: options.inputTotal + outputTotal,
        },
        last_token_usage: {
          input_tokens: options.inputLast,
          cached_input_tokens:
            options.cachedInputLast ?? options.cachedInput ?? 0,
          output_tokens: outputLast,
          reasoning_output_tokens:
            options.reasoningOutputLast ?? options.reasoningOutput ?? 0,
          total_tokens: options.inputLast + outputLast,
        },
      },
      rate_limits: options.rateLimit
        ? {
            primary: {
              used_percent: options.rateLimit.usedPercent,
              window_minutes: options.rateLimit.windowMinutes,
              resets_at: options.rateLimit.resetsAtSeconds,
            },
          }
        : undefined,
    },
  });
}

interface SnapshotCounts {
  input: number;
  cached?: number;
  output: number;
  reasoning?: number;
  total?: number;
}

function tokenSnapshot(options: {
  total?: SnapshotCounts;
  last?: SnapshotCounts;
  limitId?: string;
  second: number;
}): string {
  const counts = (value: SnapshotCounts | undefined) => value
    ? {
        input_tokens: value.input,
        cached_input_tokens: value.cached ?? 0,
        output_tokens: value.output,
        reasoning_output_tokens: value.reasoning ?? 0,
        total_tokens: value.total ?? value.input + value.output,
      }
    : undefined;
  return JSON.stringify({
    timestamp: `2026-07-20T00:00:${String(options.second).padStart(2, '0')}.000Z`,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: counts(options.total),
        last_token_usage: counts(options.last),
      },
      rate_limits: options.limitId
        ? { limit_id: options.limitId }
        : undefined,
    },
  });
}

function parseSnapshots(lines: string[]) {
  let state = createCodexParserState('file-key');
  return lines.map((line) => {
    const parsed = parseCodexLine(
      line,
      state,
      (raw) => `source:${raw}`,
    );
    state = parsed.state;
    return parsed;
  });
}

test('exact last usage wins while repeated snapshots remain deduplicated', () => {
  let state = createCodexParserState('file-key');

  const first = parseCodexLine(
    tokenLine({ inputTotal: 100, inputLast: 100 }),
    state,
  );
  state = first.state;
  const repeat = parseCodexLine(
    tokenLine({ inputTotal: 100, inputLast: 100 }),
    state,
  );
  state = repeat.state;
  const next = parseCodexLine(
    tokenLine({ inputTotal: 150, inputLast: 50 }),
    state,
  );

  assert.equal(first.events[0].tokens.inputTotal, 100);
  assert.equal(repeat.events.length, 0);
  assert.equal(next.events[0].tokens.inputTotal, 50);
  assert.equal(next.events[0].tokens.outputTotal, 20);
});

test('interleaved cumulative lanes use exact last usage and suppress an adjacent replay', () => {
  const results = parseSnapshots([
    tokenSnapshot({
      total: { input: 76_780_408, cached: 73_010_432, output: 243_036 },
      last: { input: 175_074, cached: 169_728, output: 6_827 },
      limitId: 'codex',
      second: 1,
    }),
    tokenSnapshot({
      total: { input: 87_709_262, cached: 83_563_008, output: 240_919 },
      last: { input: 151_258, cached: 147_200, output: 87 },
      limitId: 'codex-bengalfox',
      second: 2,
    }),
    tokenSnapshot({
      total: { input: 76_962_538, cached: 73_180_160, output: 243_258 },
      last: { input: 182_130, cached: 169_728, output: 222 },
      limitId: 'codex',
      second: 3,
    }),
    tokenSnapshot({
      total: { input: 87_709_262, cached: 83_563_008, output: 240_919 },
      last: { input: 151_258, cached: 147_200, output: 87 },
      limitId: 'codex-bengalfox',
      second: 4,
    }),
  ]);

  assert.deepEqual(
    results.flatMap((result) => result.events.map((event) => event.tokens)),
    [
      {
        inputTotal: 175_074,
        cachedInput: 169_728,
        outputTotal: 6_827,
        reasoningOutput: 0,
        sourceTotal: 181_901,
      },
      {
        inputTotal: 151_258,
        cachedInput: 147_200,
        outputTotal: 87,
        reasoningOutput: 0,
        sourceTotal: 151_345,
      },
      {
        inputTotal: 182_130,
        cachedInput: 169_728,
        outputTotal: 222,
        reasoningOutput: 0,
        sourceTotal: 182_352,
      },
    ],
  );
});

test('a same-source snapshot replay remains deduplicated after another lane advances', () => {
  const results = parseSnapshots([
    tokenSnapshot({
      total: { input: 1_000, output: 10 },
      last: { input: 100, output: 10 },
      limitId: 'codex',
      second: 1,
    }),
    tokenSnapshot({
      total: { input: 2_000, output: 20 },
      last: { input: 100, output: 10 },
      limitId: 'codex-bengalfox',
      second: 2,
    }),
    tokenSnapshot({
      total: { input: 1_000, output: 10 },
      last: { input: 100, output: 10 },
      limitId: 'codex',
      second: 3,
    }),
  ]);

  assert.deepEqual(
    results.flatMap((result) => result.events.map((event) => event.tokens.inputTotal)),
    [100, 100],
  );
});

test('a reset may legitimately reuse an older cross-source snapshot', () => {
  const results = parseSnapshots([
    tokenSnapshot({
      total: { input: 1_000, output: 10 },
      last: { input: 100, output: 10 },
      limitId: 'codex',
      second: 1,
    }),
    tokenSnapshot({
      total: { input: 1_000, output: 10 },
      last: { input: 100, output: 10 },
      limitId: 'codex-bengalfox',
      second: 2,
    }),
    tokenSnapshot({
      total: { input: 2_000, output: 20 },
      last: { input: 100, output: 10 },
      limitId: 'codex',
      second: 3,
    }),
    tokenSnapshot({
      total: { input: 1_000, output: 10 },
      last: { input: 50, output: 5 },
      limitId: 'codex',
      second: 4,
    }),
  ]);

  assert.deepEqual(
    results.flatMap((result) => result.events.map((event) => event.tokens.inputTotal)),
    [100, 100, 50],
  );
});

test('last-only requests remain countable without inventing replay evidence', () => {
  const line = (limitId: string, second: number) => tokenSnapshot({
    last: { input: 100, cached: 80, output: 10, reasoning: 4 },
    limitId,
    second,
  });
  const results = parseSnapshots([
    line('codex', 1),
    line('codex-bengalfox', 2),
  ]);

  assert.deepEqual(
    results.flatMap((result) => result.events.map((event) => event.tokens.inputTotal)),
    [100, 100],
  );
});

test('last total_tokens remains context size rather than attributed usage', () => {
  const results = parseSnapshots([
    tokenSnapshot({
      total: { input: 1_000, cached: 800, output: 50, reasoning: 20 },
      last: {
        input: 100,
        cached: 80,
        output: 10,
        reasoning: 4,
        total: 60_000,
      },
      limitId: 'codex',
      second: 1,
    }),
    tokenSnapshot({
      total: { input: 1_000, cached: 800, output: 50, reasoning: 20 },
      last: { input: 0, output: 0, total: 61_000 },
      limitId: 'codex',
      second: 2,
    }),
  ]);

  assert.deepEqual(
    results.flatMap((result) => result.events.map((event) => event.tokens)),
    [{
      inputTotal: 100,
      cachedInput: 80,
      outputTotal: 10,
      reasoningOutput: 4,
      sourceTotal: 110,
    }],
  );
});

test('missing last usage retains cumulative high-water fallback', () => {
  const results = parseSnapshots([
    tokenSnapshot({
      total: { input: 100, cached: 80, output: 10, reasoning: 4 },
      second: 1,
    }),
    tokenSnapshot({
      total: { input: 150, cached: 120, output: 15, reasoning: 6 },
      second: 2,
    }),
  ]);

  assert.deepEqual(
    results.flatMap((result) => result.events.map((event) => event.tokens)),
    [
      {
        inputTotal: 100,
        cachedInput: 80,
        outputTotal: 10,
        reasoningOutput: 4,
        sourceTotal: 110,
      },
      {
        inputTotal: 50,
        cachedInput: 40,
        outputTotal: 5,
        reasoningOutput: 2,
        sourceTotal: 55,
      },
    ],
  );
});

test('Codex cache_read_input_tokens alias is counted as cached input', () => {
  const parsed = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:01.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 1_000,
            cache_read_input_tokens: 800,
            output_tokens: 50,
            reasoning_output_tokens: 20,
            total_tokens: 1_050,
          },
          last_token_usage: {
            input_tokens: 100,
            cache_read_input_tokens: 80,
            output_tokens: 10,
            reasoning_output_tokens: 4,
            total_tokens: 60_000,
          },
        },
      },
    }),
    createCodexParserState('file-key'),
  );

  assert.deepEqual(parsed.events[0].tokens, {
    inputTotal: 100,
    cachedInput: 80,
    outputTotal: 10,
    reasoningOutput: 4,
    sourceTotal: 110,
  });
});

test('cached and reasoning remain subsets and inherit turn context', () => {
  let state = createCodexParserState('file-key');
  state = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:00.000Z',
      type: 'turn_context',
      payload: { model: 'gpt-5.6-sol', effort: 'high' },
    }),
    state,
  ).state;

  const result = parseCodexLine(
    tokenLine({
      inputTotal: 1_000,
      inputLast: 1_000,
      cachedInput: 800,
      outputTotal: 200,
      outputLast: 200,
      reasoningOutput: 120,
    }),
    state,
  );
  const event = result.events[0];

  assert.deepEqual(event.tokens, {
    inputTotal: 1_000,
    cachedInput: 800,
    outputTotal: 200,
    reasoningOutput: 120,
    sourceTotal: 1_200,
  });
  assert.equal(event.model, 'gpt-5.6-sol');
  assert.equal(event.effort, 'high');
});

test('metadata labels reject identity and location leak vectors while preserving known labels', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  const uuidV7 = '019f6e61-0bf5-7a72-b6c1-2ace56bdd928';
  const sessionKey = 'a'.repeat(64);
  const unsafeLabels = [
    '/Users/alice/Secret',
    'C:\\Users\\alice\\Secret',
    '\\\\server\\share\\Secret',
    'file:///Users/alice/Secret',
    'https://example.invalid/private',
    'ssh://example.invalid/private',
    `agent\u0000secret`,
    `agent\u200dsecret`,
    uuid,
    uuidV7,
    sessionKey,
  ];

  for (const unsafe of unsafeLabels) {
    const metadata = parseCodexLine(
      JSON.stringify({
        timestamp: '2026-07-20T00:00:00.000Z',
        type: 'session_meta',
        payload: { agent_nickname: unsafe },
      }),
      createCodexParserState('file-key'),
    ).state;
    const context = parseCodexLine(
      JSON.stringify({
        timestamp: '2026-07-20T00:00:01.000Z',
        type: 'turn_context',
        payload: { model: unsafe, effort: unsafe },
      }),
      metadata,
    ).state;

    assert.equal(context.agentNickname, undefined, unsafe);
    assert.equal(context.model, undefined, unsafe);
    assert.equal(context.effort, undefined, unsafe);
    assert.doesNotMatch(JSON.stringify(context), /Users|Secret|example\.invalid|550e8400|a{64}/);
  }

  let state = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:00.000Z',
      type: 'session_meta',
      payload: { agent_nickname: 'Review Agent' },
    }),
    createCodexParserState('file-key'),
  ).state;
  state = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:01.000Z',
      type: 'turn_context',
      payload: { model: 'gpt-5.6-sol', effort: 'xhigh' },
    }),
    state,
  ).state;
  assert.equal(state.agentNickname, 'Review Agent');
  assert.equal(state.model, 'gpt-5.6-sol');
  assert.equal(state.effort, 'xhigh');

  const snapshot = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:02.000Z',
      type: 'turn_context',
      payload: { model: 'claude-opus-4-20250514', effort: 'high' },
    }),
    state,
  ).state;
  assert.equal(snapshot.model, 'claude-opus-4-20250514');
  assert.equal(snapshot.effort, 'high');
});

test('explicit unsafe turn context clears stale labels before token attribution', () => {
  let state = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:00.000Z',
      type: 'turn_context',
      payload: { model: 'gpt-5.6-sol', effort: 'xhigh' },
    }),
    createCodexParserState('file-key'),
  ).state;

  state = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:01.000Z',
      type: 'turn_context',
      payload: {},
    }),
    state,
  ).state;
  assert.equal(state.model, 'gpt-5.6-sol');
  assert.equal(state.effort, 'xhigh');

  state = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:02.000Z',
      type: 'turn_context',
      payload: {
        model: '/Users/alice/Secret',
        effort: 'https://example.invalid/private',
      },
    }),
    state,
  ).state;
  assert.equal(state.model, undefined);
  assert.equal(state.effort, undefined);

  const usage = parseCodexLine(
    tokenLine({ inputTotal: 100, inputLast: 100 }),
    state,
  );
  assert.equal(usage.events.length, 1);
  assert.equal(usage.events[0].model, undefined);
  assert.equal(usage.events[0].effort, undefined);
});

test('invalid JSON is flagged and unknown events contribute no usage', () => {
  let state = createCodexParserState('file-key');
  const invalid = parseCodexLine('{not-json', state);
  state = invalid.state;
  const unknown = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:00.000Z',
      type: 'future_event',
      payload: {},
    }),
    state,
  );

  assert.equal(invalid.events.length, 0);
  assert.ok(invalid.state.qualityFlags.includes('invalid-json'));
  assert.equal(unknown.events.length, 0);
  assert.ok(unknown.state.qualityFlags.includes('unknown-event'));
});

test('known non-usage envelopes do not become quality failures', () => {
  let state = createCodexParserState('file-key');
  for (const type of [
    'world_state',
    'inter_agent_communication_metadata',
  ]) {
    const result = parseCodexLine(
      JSON.stringify({
        timestamp: '2026-07-20T00:00:00.000Z',
        type,
        payload: { private: 'must not be returned' },
      }),
      state,
    );
    state = result.state;
    assert.equal(result.events.length, 0);
    assert.equal(result.structural, undefined);
  }

  const compacted = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:01:00.000Z',
      type: 'compacted',
      payload: { private: 'must not be returned' },
    }),
    state,
  );
  assert.equal(compacted.structural, undefined);
  assert.deepEqual(compacted.state.qualityFlags, []);
  assert.doesNotMatch(JSON.stringify(compacted), /private|must not be returned/);
});

test('rate limit is a last-observed local-log snapshot', () => {
  const resetsAtSeconds = Date.parse('2026-07-20T05:00:00.000Z') / 1_000;
  const result = parseCodexLine(
    tokenLine({
      inputTotal: 100,
      inputLast: 100,
      rateLimit: { usedPercent: 42, windowMinutes: 300, resetsAtSeconds },
    }),
    createCodexParserState('file-key'),
  );

  assert.deepEqual(result.limit, {
    provider: 'codex',
    observedAt: Date.parse('2026-07-20T00:00:00.000Z'),
    source: 'local-log',
    confidence: 'last-observed',
    windows: [
      {
        label: 'primary',
        usedPercent: 42,
        windowMinutes: 300,
        resetsAt: resetsAtSeconds * 1_000,
      },
    ],
  });
});

test('rate limits preserve named primary secondary and credit metadata', () => {
  const result = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
          },
        },
        rate_limits: {
          limit_id: 'codex-main',
          limit_name: 'Codex',
          primary: {
            used_percent: 20,
            window_minutes: 300,
            resets_at: 1_785_000_000,
          },
          secondary: {
            used_percent: 35,
            window_minutes: 10080,
            resets_at: 1_785_500_000,
          },
          credits: {
            has_credits: true,
            unlimited: false,
            balance: '18.5',
          },
        },
      },
    }),
    createCodexParserState('file-key'),
  );

  assert.equal(result.limit?.limitId, 'codex-main');
  assert.equal(result.limit?.limitName, 'Codex');
  assert.deepEqual(result.limit?.windows.map((window) => window.label), [
    'primary',
    'secondary',
  ]);
  assert.deepEqual(result.limit?.credits, {
    hasCredits: true,
    unlimited: false,
    balance: '18.5',
  });
});

test('counter regression keeps exact last usage and marks it partial', () => {
  let state = createCodexParserState('root-file');
  state = parseCodexLine(
    tokenLine({ inputTotal: 100, inputLast: 100 }),
    state,
  ).state;
  const result = parseCodexLine(
    tokenLine({
      inputTotal: 90,
      inputLast: 5,
      outputTotal: 15,
      outputLast: 5,
    }),
    state,
  );

  assert.ok(result.state.qualityFlags.includes('counter-regression'));
  assert.deepEqual(result.events[0].tokens, {
    inputTotal: 5,
    cachedInput: 0,
    outputTotal: 5,
    reasoningOutput: 0,
    sourceTotal: 10,
  });
  assert.equal(result.events[0].confidence, 'partial');
});

test('session metadata is pseudonymized and auto-review stays distinct', () => {
  const pseudonyms: Record<string, string> = {
    'raw-session': 'session:001',
    'raw-parent': 'session:000',
    '/private/project': 'project:001',
    'repo:github.com/example/accurateproject': 'project:git',
  };
  const pseudonymizedSources: string[] = [];
  const pseudonymize = (raw: string): string => {
    pseudonymizedSources.push(raw);
    return pseudonyms[raw] ?? 'unknown:key';
  };
  const line = JSON.stringify({
    timestamp: '2026-07-20T00:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: 'raw-session',
      cwd: '/private/project',
      agent_nickname: 'Locke',
      git: {
        repository_url: 'https://github.com/example/AccurateProject.git',
      },
      source: {
        subagent: {
          thread_spawn: {
            parent_thread_id: 'raw-parent',
            agent_role: 'codex-auto-review',
          },
        },
      },
    },
  });

  const sessionsState = parseCodexLine(
    line,
    createCodexParserState('sessions-file'),
    pseudonymize,
  ).state;
  const archiveState = parseCodexLine(
    line,
    createCodexParserState('archive-file'),
    pseudonymize,
  ).state;

  assert.equal(sessionsState.sessionKey, 'session:001');
  assert.equal(archiveState.sessionKey, 'session:001');
  assert.equal(sessionsState.parentSessionKey, 'session:000');
  assert.equal(sessionsState.projectKey, 'project:git');
  assert.equal(sessionsState.projectName, 'AccurateProject');
  assert.equal(sessionsState.projectDirectoryName, 'project');
  assert.equal(sessionsState.agentNickname, 'Locke');
  assert.equal(sessionsState.role, 'approval-reviewer');
  assert.equal(
    pseudonymizedSources.includes('repo:github.com/example/accurateproject'),
    true,
  );
  assert.equal(
    pseudonymizedSources.includes(
      'https://github.com/example/AccurateProject.git',
    ),
    false,
  );
  assert.doesNotMatch(
    JSON.stringify(sessionsState),
    /raw-session|raw-parent|private\/project|github\.com/,
  );
});

test('encoded local-path repository text never reaches the pseudonymizer', () => {
  const pseudonymizedSources: string[] = [];
  const state = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'safe-session',
        cwd: '/safe/project',
        git: {
          repository_url:
            'https://example.com/Owner/%2FUsers%2Falice%2FSecretRepo.git',
        },
      },
    }),
    createCodexParserState('safe-file'),
    (raw: string): string => {
      pseudonymizedSources.push(raw);
      return `anonymous:${pseudonymizedSources.length}`;
    },
  ).state;

  assert.equal(state.projectName, 'project');
  assert.deepEqual(pseudonymizedSources, ['safe-session', '/safe/project']);
  assert.doesNotMatch(
    JSON.stringify(pseudonymizedSources),
    /%2f|%5c|Users|alice|SecretRepo/i,
  );
});

test('double-encoded paths and Unicode controls never reach identity output', () => {
  for (const repositoryUrl of [
    'https://example.com/Owner/%252FUsers%252Falice%252FSecretRepo.git',
    'https://example.com/Owner/%255cUsers%255CCarl%255cSecretRepo.git',
    'https://example.com/Owner/%C2%85SecretRepo.git',
    'https://example.com/Owner/%E2%80%8DSecretRepo.git',
  ]) {
    const pseudonymizedSources: string[] = [];
    const state = parseCodexLine(
      JSON.stringify({
        timestamp: '2026-07-20T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'safe-session',
          cwd: '/safe/project',
          git: { repository_url: repositoryUrl },
        },
      }),
      createCodexParserState('safe-file'),
      (raw: string): string => {
        pseudonymizedSources.push(raw);
        return `anonymous:${pseudonymizedSources.length}`;
      },
    ).state;

    assert.equal(state.projectName, 'project');
    assert.deepEqual(pseudonymizedSources, ['safe-session', '/safe/project']);
    assert.doesNotMatch(
      JSON.stringify({ state, pseudonymizedSources }),
      /%25|%C2%85|%E2%80%8D|Users|alice|Carl|SecretRepo/i,
    );
  }
});

test('repeated metadata cannot erase an established child role', () => {
  const pseudonymize = (raw: string): string => `safe:${raw}`;
  let state = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'child',
        source: {
          subagent: {
            thread_spawn: { parent_thread_id: 'parent' },
          },
        },
      },
    }),
    createCodexParserState('child-file'),
    pseudonymize,
  ).state;

  state = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:01.000Z',
      type: 'session_meta',
      payload: { id: 'child' },
    }),
    state,
    pseudonymize,
  ).state;

  assert.equal(state.parentSessionKey, 'safe:parent');
  assert.equal(state.role, 'subagent');
});

test('guardian subagent metadata maps to an approval reviewer', () => {
  const state = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T00:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'review',
        parent_thread_id: 'parent',
        source: { subagent: { other: 'guardian' } },
      },
    }),
    createCodexParserState('review-file'),
    (raw) => `safe:${raw}`,
  ).state;

  assert.equal(state.parentSessionKey, 'safe:parent');
  assert.equal(state.role, 'approval-reviewer');
});

test('compaction, patch, and tool calls emit structural facts without bodies', () => {
  let state = createCodexParserState('file-key');
  const compacted = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T01:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'context_compacted', message: 'must not be read' },
    }),
    state,
  );
  state = compacted.state;
  const patched = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T01:01:00.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'apply_patch',
        arguments: '{"private":"body"}',
      },
    }),
    state,
  );
  const tooled = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-07-20T01:02:00.000Z',
      type: 'response_item',
      payload: { type: 'function_call', name: 'exec_command' },
    }),
    patched.state,
  );

  assert.deepEqual(compacted.structural, {
    kind: 'compaction',
    timestamp: Date.parse('2026-07-20T01:00:00.000Z'),
  });
  assert.deepEqual(patched.structural, {
    kind: 'patch',
    name: 'apply_patch',
    timestamp: Date.parse('2026-07-20T01:01:00.000Z'),
  });
  assert.deepEqual(tooled.structural, {
    kind: 'tool',
    name: 'exec_command',
    timestamp: Date.parse('2026-07-20T01:02:00.000Z'),
  });
  assert.doesNotMatch(JSON.stringify(patched), /private|body/);
});

import type { CodexFileAggregate } from './providers/codex/codexIndex';
import { codexModelFamily, normalizeCodexAchievementModel } from './achievementModels';
import { validAchievementBuckets, verifiedCodexAchievementFiles } from './codexAchievementProof';

export type CollaborationTierCounts = [number, number, number];
export interface AchievementCollaborationEvidence {
  /** Eligible root tasks, ordinary/silver/gold; award repetition targets live in the caller. */
  teamTaskCounts: CollaborationTierCounts;
  /** Exactly teamTaskCounts[0]. */
  orchestratedTasks: number;
  /** Non-APR subagents with at least 5K explicitly recognized model output. */
  qualifiedSubagentCount: number;
  /** Eligible root tasks for 2×10K / 3×20K / 4×50K normalized models. */
  modelTaskCounts: CollaborationTierCounts;
  /** Exactly modelTaskCounts[0]. */
  multiModelTasks: number;
  /** Number of low..ultra tiers satisfying each volume/output/root conjunction.
   * The caller compares these counts with its 4/5/6 award targets. */
  effortQualifiedTierCounts: CollaborationTierCounts;
  rainbowFamilies: Record<'astra' | 'sol' | 'luna', { processed: number; output: number }>;
}

const TEAM_MEMBERS = [3, 5, 8] as const;
const TEAM_OUTPUT = [5_000, 10_000, 20_000] as const;
const MODEL_COUNTS = [2, 3, 4] as const;
const MODEL_OUTPUT = [10_000, 20_000, 50_000] as const;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
type Effort = typeof EFFORTS[number];
export const EFFORT_PROCESSED = [100_000_000, 500_000_000, 2_000_000_000] as const;
export const EFFORT_OUTPUT = [100_000, 500_000, 2_000_000] as const;
export const EFFORT_ROOTS = [5, 10, 30] as const;
const triple = (): CollaborationTierCounts => [0, 0, 0];
// All selected operands are safe nonnegative integers. Saturation preserves a
// safe lower bound beyond representable totals, never a rounded-up token claim.
const add = (left: number, right: number): number =>
  right > Number.MAX_SAFE_INTEGER - left ? Number.MAX_SAFE_INTEGER : left + right;

interface Task {
  members: CollaborationTierCounts;
  modelOutput: Map<string, number>;
}

/**
 * Pure reduction of the host's complete canonical, reconciled index snapshot.
 * The host must already have removed duplicate events and inherited prefixes;
 * aggregates cannot recover that provenance or discover missing files. Repeat
 * the canonical selector here to withhold conflicting identities/descendants,
 * malformed token/model vectors, orphans and cycles. No log I/O or durable IDs.
 *
 * Member output is the sum of explicitly normalized OpenAI model buckets in
 * that member. Task model output pools only that model within that root tree.
 * Effort uses its own marginal bucket: there is no model×effort cross-tab to
 * infer. Pool each root×effort first; only its own positive output admits that
 * task's processed/output volume and one distinct root to that tier's proof.
 * APR contributes to no evidence; its sound ancestry may connect descendants.
 */
export function codexCollaborationEvidence(files: readonly CodexFileAggregate[]): AchievementCollaborationEvidence {
  const result: AchievementCollaborationEvidence = {
    teamTaskCounts: [0, 0, 0], orchestratedTasks: 0, qualifiedSubagentCount: 0,
    modelTaskCounts: [0, 0, 0], multiModelTasks: 0, effortQualifiedTierCounts: [0, 0, 0],
    rainbowFamilies: {
      astra: { processed: 0, output: 0 }, sol: { processed: 0, output: 0 }, luna: { processed: 0, output: 0 },
    },
  };
  const verified = verifiedCodexAchievementFiles(files);
  const bySession = new Map(verified.map(file => [file.session.sessionKey, file]));
  const rootBySession = new Map<string, string | null>();
  // Iterative path compression keeps even reversed deep trees linear. Resolve
  // over the selected map so no excluded ancestor can reconnect a branch.
  const taskRoot = (key: string): string | null => {
    const path = new Set<string>();
    let current: string | undefined = key;
    let root: string | null = null;
    while (current !== undefined) {
      if (rootBySession.has(current)) { root = rootBySession.get(current)!; break; }
      const file = bySession.get(current);
      if (!file || path.has(current)) break;
      path.add(current);
      const parent = file.session.parentSessionKey;
      if (parent === undefined) { root = file.session.role === 'root' ? current : null; break; }
      current = parent;
    }
    for (const session of path) rootBySession.set(session, root);
    return root;
  };
  const tasks = new Map<string, Task>();
  const effortEvidence = new Map<Effort, { processed: number; output: number; roots: Set<string> }>(
    EFFORTS.map(effort => [effort, { processed: 0, output: 0, roots: new Set<string>() }]),
  );
  const taskEfforts = new Map<string, Map<Effort, { processed: number; output: number }>>();
  for (const file of verified) {
    if (file.session.role === 'approval-reviewer') continue;
    const root = taskRoot(file.session.sessionKey);
    if (root === null) continue;
    let task = tasks.get(root);
    if (!task) tasks.set(root, task = { members: triple(), modelOutput: new Map() });
    let memberOutput = 0;
    for (const [label, tokens] of Object.entries(file.byModel)) {
      const model = normalizeCodexAchievementModel(label);
      if (!model) continue;
      const family = codexModelFamily(model);
      if (family) {
        const bucket = result.rainbowFamilies[family];
        bucket.processed = add(bucket.processed, tokens.inputTotal + tokens.outputTotal);
        bucket.output = add(bucket.output, tokens.outputTotal);
      }
      // Family accumulation combines that family's actual input/output. Its
      // separate output condition still prevents input-only qualification.
      if (tokens.outputTotal === 0) continue;
      memberOutput = add(memberOutput, tokens.outputTotal);
      task.modelOutput.set(model, add(task.modelOutput.get(model) ?? 0, tokens.outputTotal));
    }
    if (file.session.role === 'subagent') {
      for (let tier = 0; tier < 3; tier++) if (memberOutput >= TEAM_OUTPUT[tier]) task.members[tier]++;
      if (memberOutput >= TEAM_OUTPUT[0]) result.qualifiedSubagentCount++;
    }
    // Validate the entire effort vector independently; malformed effort cannot
    // discard independently valid team/model/family evidence.
    if (!validAchievementBuckets(file.byEffort, file.total)) continue;
    let ownEfforts = taskEfforts.get(root);
    if (!ownEfforts) taskEfforts.set(root, ownEfforts = new Map());
    for (const effort of EFFORTS) {
      const tokens = file.byEffort[effort];
      if (!tokens) continue;
      let bucket = ownEfforts.get(effort);
      if (!bucket) ownEfforts.set(effort, bucket = { processed: 0, output: 0 });
      bucket.processed = add(bucket.processed, tokens.inputTotal + tokens.outputTotal);
      bucket.output = add(bucket.output, tokens.outputTotal);
    }
  }
  for (const [root, ownEfforts] of taskEfforts) {
    for (const [effort, own] of ownEfforts) {
      if (own.output === 0) continue;
      const bucket = effortEvidence.get(effort)!;
      bucket.processed = add(bucket.processed, own.processed);
      bucket.output = add(bucket.output, own.output);
      bucket.roots.add(root);
    }
  }
  for (const [root, task] of tasks) {
    for (let tier = 0; tier < 3; tier++) {
      if (bySession.get(root)!.total.outputTotal > 0 && task.members[tier] >= TEAM_MEMBERS[tier]) {
        result.teamTaskCounts[tier]++;
      }
      let qualifiedModels = 0;
      for (const output of task.modelOutput.values()) if (output >= MODEL_OUTPUT[tier]) qualifiedModels++;
      if (qualifiedModels >= MODEL_COUNTS[tier]) result.modelTaskCounts[tier]++;
    }
  }
  result.orchestratedTasks = result.teamTaskCounts[0];
  result.multiModelTasks = result.modelTaskCounts[0];
  for (const bucket of effortEvidence.values()) {
    for (let tier = 0; tier < 3; tier++) {
      if (bucket.processed >= EFFORT_PROCESSED[tier] && bucket.output >= EFFORT_OUTPUT[tier] &&
          bucket.roots.size >= EFFORT_ROOTS[tier]) result.effortQualifiedTierCounts[tier]++;
    }
  }
  return result;
}

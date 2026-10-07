export const CODEX_LINEAGE_FINGERPRINT_BYTES = 16;
export const CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK = 1_024;

export interface CodexLineageTrace {
  /** Packed 128-bit event fingerprints; Base64 keeps the persisted index compact. */
  fingerprintBlocks: string[];
  /** Hex fingerprints not yet promoted into a full packed block. */
  pendingFingerprints: string[];
  tokenEvents: number;
  desiredPrefixEvents: number;
  appliedPrefixEvents: number;
}

/** Runtime-only DFS memo; null parents denote a root, empty parents an orphan. */
export function createLineageDepthResolver<T extends object>(
  parentsFor: (node: T) => readonly T[] | null,
): (node: T) => number {
  const memo = new Map<T, number>();
  return (node: T): number => {
    const cached = memo.get(node);
    if (cached !== undefined) {
      return cached;
    }
    const active = new Set<T>([node]);
    const frames: Array<{
      node: T;
      parents: readonly T[] | null;
      nextParent: number;
      minimum: number;
    }> = [{ node, parents: parentsFor(node), nextParent: 0, minimum: Infinity }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.parents && frame.nextParent < frame.parents.length) {
        const parent = frame.parents[frame.nextParent++];
        const parentDepth = memo.get(parent);
        // Preserve legacy memo-before-cycle and ordered branch traversal semantics.
        if (parentDepth !== undefined || active.has(parent)) {
          frame.minimum = Math.min(frame.minimum, parentDepth ?? 0);
        } else {
          active.add(parent);
          frames.push({
            node: parent, parents: parentsFor(parent), nextParent: 0, minimum: Infinity,
          });
        }
        continue;
      }
      const depth = frame.parents === null ? 0
        : frame.parents.length === 0 ? 1 : 1 + frame.minimum;
      memo.set(frame.node, depth);
      active.delete(frame.node);
      frames.pop();
      const caller = frames[frames.length - 1];
      if (!caller) {
        return depth;
      }
      caller.minimum = Math.min(caller.minimum, depth);
    }
    // The root frame always returns above.
    throw new Error('lineage depth resolver exhausted without a result');
  };
}

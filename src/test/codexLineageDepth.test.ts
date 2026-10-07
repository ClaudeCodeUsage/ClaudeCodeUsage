import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createLineageDepthResolver } from '../providers/codex/codexLineage';

interface DepthNode {
  parents: DepthNode[] | null;
}

// Oracle is confined to eight-node synthetic graphs; never use it on deep histories.
function legacySmallDepthResolver(): (node: DepthNode, visiting?: Set<DepthNode>) => number {
  const memo = new Map<DepthNode, number>();
  const depthFor = (node: DepthNode, visiting = new Set<DepthNode>()): number => {
    const cached = memo.get(node);
    if (cached !== undefined) { return cached; }
    if (visiting.has(node)) { return 0; }
    if (node.parents === null) { memo.set(node, 0); return 0; }
    const next = new Set(visiting).add(node);
    const depth = node.parents.length > 0
      ? 1 + Math.min(...node.parents.map((parent) => depthFor(parent, next))) : 1;
    memo.set(node, depth);
    return depth;
  };
  return depthFor;
}

test('primary lineage depth preserves roots, orphans, cycles and memo ordering', () => {
  const root: DepthNode = { parents: null };
  const orphan: DepthNode = { parents: [] };
  const cycleA: DepthNode = { parents: [] };
  const cycleB: DepthNode = { parents: [cycleA] };
  cycleA.parents = [cycleB];
  const join: DepthNode = { parents: [cycleA, orphan, root] };
  const nodes = [root, orphan, cycleA, cycleB, join];
  for (const order of [nodes, nodes.slice().reverse(), [cycleB, join, cycleA, root, orphan]]) {
    const legacy = legacySmallDepthResolver();
    const iterative = createLineageDepthResolver<DepthNode>((node) => node.parents);
    for (const node of order) {
      assert.equal(iterative(node), legacy(node));
      assert.equal(iterative(node), legacy(node));
    }
  }
});

test('ordered multi-parent depth matches the bounded legacy oracle on 1000 deterministic small graphs', () => {
  let state = 0x5eed;
  const pick = (limit: number): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % limit;
  };
  for (let graph = 0; graph < 1_000; graph += 1) {
    const nodes: DepthNode[] = Array.from({ length: 8 }, () => ({ parents: null }));
    for (const node of nodes) {
      if (pick(5) !== 0) {
        node.parents = Array.from({ length: pick(4) }, () => nodes[pick(nodes.length)]);
      }
    }
    for (const order of [nodes, nodes.slice().reverse()]) {
      const legacy = legacySmallDepthResolver();
      const iterative = createLineageDepthResolver<DepthNode>((node) => node.parents);
      for (const node of order) {
        assert.equal(iterative(node), legacy(node), `graph ${graph}`);
      }
    }
  }
});

test('primary lineage depth handles a 100000-node chain with linear auxiliary state', () => {
  const root: DepthNode = { parents: null };
  let leaf = root;
  for (let depth = 1; depth < 100_000; depth += 1) {
    leaf = { parents: [leaf] };
  }
  const depthFor = createLineageDepthResolver<DepthNode>((node) => node.parents);
  assert.equal(depthFor(leaf), 99_999);
  assert.equal(depthFor(root), 0);
  assert.equal(depthFor(leaf), 99_999);
});

test('primary lineage depth does not spread a 150000-parent fanout into arguments', () => {
  const roots: DepthNode[] = Array.from({ length: 150_000 }, () => ({ parents: null }));
  const leaf: DepthNode = { parents: roots };
  const depthFor = createLineageDepthResolver<DepthNode>((node) => node.parents);
  assert.equal(depthFor(leaf), 1);
  assert.equal(depthFor(roots[roots.length - 1]), 0);
});

/**
 * Circular dependency detection via DFS cycle finding.
 */

/**
 * Detect circular dependencies in a directed module graph.
 * @param {Array<{source: string, target: string, weight: number}>} edges
 * @returns {{ cycles: Array<{path: string[], totalWeight: number}>, hasCycles: boolean }}
 */
export function detectCycles(edges) {
  // Build adjacency list: source imports target
  const adj = new Map();
  const weightMap = new Map();
  for (const { source, target, weight } of edges) {
    if (!adj.has(source)) adj.set(source, []);
    adj.get(source).push(target);
    weightMap.set(`${source}→${target}`, weight);
  }

  // Collect all nodes
  const allNodes = new Set();
  for (const { source, target } of edges) {
    allNodes.add(source);
    allNodes.add(target);
  }

  const UNVISITED = 0, IN_STACK = 1, DONE = 2;
  const state = new Map();
  for (const n of allNodes) state.set(n, UNVISITED);

  const rawCycles = [];
  const stack = [];

  function dfs(node) {
    state.set(node, IN_STACK);
    stack.push(node);

    for (const neighbor of (adj.get(node) || [])) {
      if (state.get(neighbor) === IN_STACK) {
        // Found a cycle — extract path from neighbor's position in stack
        const idx = stack.indexOf(neighbor);
        const path = [...stack.slice(idx), neighbor];
        rawCycles.push(path);
      } else if (state.get(neighbor) === UNVISITED) {
        dfs(neighbor);
      }
    }

    stack.pop();
    state.set(node, DONE);
  }

  for (const node of allNodes) {
    if (state.get(node) === UNVISITED) {
      dfs(node);
    }
  }

  // Normalize cycles: rotate so lexicographically smallest node is first, then deduplicate
  const seen = new Set();
  const cycles = [];

  for (const path of rawCycles) {
    const loop = path.slice(0, -1); // remove trailing duplicate
    const minIdx = loop.indexOf(loop.reduce((a, b) => a < b ? a : b));
    const rotated = [...loop.slice(minIdx), ...loop.slice(0, minIdx), loop[minIdx]];
    const key = rotated.join('→');

    if (!seen.has(key)) {
      seen.add(key);
      let totalWeight = 0;
      for (let i = 0; i < rotated.length - 1; i++) {
        totalWeight += weightMap.get(`${rotated[i]}→${rotated[i + 1]}`) || 0;
      }
      cycles.push({ path: rotated, totalWeight });
    }
  }

  cycles.sort((a, b) => b.totalWeight - a.totalWeight);

  return { cycles, hasCycles: cycles.length > 0 };
}

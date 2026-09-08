/** Orders candidates by how few single character edits separate them from `name`. */
export function nearest(name: string, candidates: readonly string[], maxDistance = 2): string[] {
  const limit = name.length <= 4 ? 1 : maxDistance;
  const scored: { candidate: string; distance: number }[] = [];
  for (const candidate of candidates) {
    if (candidate === name || Math.abs(candidate.length - name.length) > limit) continue;
    const distance = editDistance(name, candidate, limit);
    if (distance <= limit) scored.push({ candidate, distance });
  }
  scored.sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate));
  return scored.map((s) => s.candidate);
}

/** Levenshtein distance, giving up as soon as it passes `limit`. */
export function editDistance(a: string, b: string, limit: number): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length]!;
}

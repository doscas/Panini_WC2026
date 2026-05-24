// trade-optimizer.js (no valuation; all stickers equal value)
// Rule: Available duplicates for trade ALWAYS keeps 1 copy for yourself.
// If you also use 'reserved' (promised copies), they reduce availability too.

export function normalizeEntry(v) {
  const owned = Math.max(0, parseInt(v?.owned ?? v ?? 0, 10) || 0);
  const reserved = Math.max(0, parseInt(v?.reserved ?? 0, 10) || 0);
  return { owned, reserved: Math.min(reserved, owned) };
}

export function computeDerivedState(collectionObj, allKeys) {
  // collectionObj can be {key:{owned,reserved}} or {key:owned}
  const missingKeys = [];
  const giveCounts = {}; // key -> available count

  for (const key of allKeys) {
    const v = normalizeEntry(collectionObj?.[key]);
    if (v.owned <= 0) missingKeys.push(key);

    // Availability rule: keep 1 copy for yourself.
    // available = owned - 1 - reserved (never below 0)
    const available = Math.max(0, v.owned - 1 - v.reserved);
    if (available > 0) giveCounts[key] = available;
  }

  return {
    missingKeys,
    giveCounts,
    giveKeys: Object.keys(giveCounts)
  };
}

function intersectSetWithKeys(setA, keysB) {
  const out = [];
  for (const k of keysB) if (setA.has(k)) out.push(k);
  return out;
}

export function optimizeTrades(myDerived, otherProfile, opts = {}) {
  const maxItems = opts.maxItems ?? 5;

  const myMissingSet = new Set(myDerived.missingKeys);
  const myGiveSet = new Set(myDerived.giveKeys);

  const theirMissing = Array.isArray(otherProfile.missingKeys) ? otherProfile.missingKeys : [];
  const theirGiveCounts = otherProfile.giveCounts || {};
  const theirGiveKeys = Object.keys(theirGiveCounts);

  // what I can get: they can give AND I miss
  const getKeys = intersectSetWithKeys(myMissingSet, theirGiveKeys);
  // what I can give: I can give AND they miss
  const theirMissingSet = new Set(theirMissing);
  const giveKeys = intersectSetWithKeys(theirMissingSet, myDerived.giveKeys);

  if (!getKeys.length || !giveKeys.length) return [];

  // Expand keys by available counts (so if someone can give 3 copies, it can appear 3 times)
  const expandByCount = (keys, counts, cap = 20) => {
    const out = [];
    for (const k of keys) {
      const n = Math.min(cap, Math.max(1, counts[k] || 1));
      for (let i = 0; i < n; i++) out.push(k);
    }
    return out;
  };

  const myGiveExpanded = expandByCount(giveKeys, myDerived.giveCounts);
  const theirGiveExpanded = expandByCount(getKeys, theirGiveCounts);

  // Greedy bundle: prioritize unique stickers first
  const uniq = (arr) => [...new Set(arr)];

  const pickBundle = (arr, n) => uniq(arr).slice(0, n);

  // Generate bundles size 1..maxItems, but keep it practical
  const suggestions = [];
  const maxBundle = Math.min(maxItems, uniq(myGiveExpanded).length, uniq(theirGiveExpanded).length);

  for (let size = 1; size <= maxBundle; size++) {
    const giveBundle = pickBundle(myGiveExpanded, size);
    const getBundle = pickBundle(theirGiveExpanded, size);

    // score = how many NEW stickers I get (all equal value)
    const score = getBundle.length;

    suggestions.push({
      partnerUid: otherProfile.uid,
      partnerName: otherProfile.displayName || 'Collector',
      partnerClass: otherProfile.collectorClass || '',
      give: giveBundle,
      get: getBundle,
      score
    });
  }

  // Best first
  suggestions.sort((a, b) => b.score - a.score);
  return suggestions;
}

export function buildAllSuggestions(myDerived, otherProfiles, opts = {}) {
  const out = [];
  for (const p of otherProfiles) {
    if (!p || !p.uid) continue;
    const sug = optimizeTrades(myDerived, p, opts);
    for (const s of sug) out.push(s);
  }
  // Rank across users: more gained first
  out.sort((a, b) => b.score - a.score);
  return out;
}

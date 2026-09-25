export const ID = "combatstats-rmu";
export const SEVERITIES = ["Z", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
export const RESISTANCES = ["Channeling", "Essence", "Mentalism", "Physical", "Fear"];
export const DERIVED_KEYS = ["accuracy", "rrSuccess", "rrFailure", "rrAttempts", "rrRate"];
export const GROUPS = {
  overview: {label: "Attacks & damage", columns: [
    ["strikes", "Successful strikes"], ["misses", "Misses"], ["fumbles", "Fumbles"],
    ["hitsDealt", "Hits dealt"], ["hitsTaken", "Hits taken"], ["accuracy", "Accuracy"]]},
  criticals: {label: "Criticals dealt", columns: SEVERITIES.map(s => [`critical${s}`, s])},
  received: {label: "Criticals received", columns: SEVERITIES.map(s => [`received${s}`, s])},
  conditions: {label: "Conditions suffered", columns: [
    ["stun25", "Stunned −25"], ["stun50", "Stunned −50"], ["stun75", "Stunned −75"],
    ["prone", "Knocked prone"], ["staggered", "Staggered"]]},
  bleeding: {label: "Bleeding", columns: [
    ["bleedInflicted", "Rate inflicted"], ["bleedSuffered", "Rate suffered"], ["bleedDamage", "Hits lost to bleeding"]]},
  rolls: {label: "Open-ended records", columns: [["openHigh", "Highest upward roll"], ["openLow", "Lowest downward roll"]]},
  resistance: {label: "Resistance rolls", columns: [["rrSuccess", "Successful"], ["rrFailure", "Failed"], ["rrAttempts", "Attempts"], ["rrRate", "Success rate"]]}
};
export const KEYS = [...Object.values(GROUPS).flatMap(g => g.columns.map(c => c[0])),
  ...RESISTANCES.flatMap(t => [`rr${t}Success`, `rr${t}Failure`])];
export const RECORD_KEYS = ["openHigh", "openLow"];
export const emptyStats = () => Object.fromEntries(KEYS.map(k => [k, RECORD_KEYS.includes(k) || k === "accuracy" ? null : 0]));
export const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const positive = value => Math.max(0, number(value));

export function appliedAttack(result) {
  const effects = result?.effects ?? [];
  const hits = effects.filter(e => e.effect === "Hits").reduce((n, e) => n + positive(e.value), 0);
  const healed = effects.filter(e => e.effect === "heal-hits").reduce((n, e) => n + positive(e.value), 0);
  const damage = Math.max(0, hits - healed);
  const stats = {hitsDealt: damage, bleedInflicted: effects.filter(e => e.effect === "Bleed")
    .reduce((n, e) => n + positive(e.value), 0)};
  if (!result?.isSceneCritical && result?.attackerTokenId) stats[damage >= 1 ? "strikes" : "misses"] = 1;
  for (const critical of result?.criticalResult?.criticals ?? []) {
    if (critical.conditionOnly) continue;
    const severity = String(critical.severityShortCode ?? "").toUpperCase();
    if (SEVERITIES.includes(severity)) stats[`critical${severity}`] = (stats[`critical${severity}`] ?? 0) + 1;
  }
  return stats;
}

// Counts applications, not remaining rounds, AP debt, or repeated renders.
export function conditionDelta(before, after) {
  if (!after || after.disabled) return {};
  const previous = before?.disabled ? null : before;
  const type = after.system?.type ?? after.type;
  const oldType = previous?.system?.type ?? previous?.type;
  const old = oldType === type ? previous : null;
  if (type === "stun") return Object.fromEntries([25, 50, 75].map((s, i) =>
    [`stun${s}`, positive(after.system?.rounds?.[i]) > positive(old?.system?.rounds?.[i]) ? 1 : 0]));
  if (type === "prone") return old ? {} : {prone: 1};
  if (type === "staggered") return !old || positive(after.system?.value) > positive(old.system?.value)
    ? {staggered: 1} : {};
  if (after.system?.effect === "Bleed") return {bleedSuffered: Math.max(0,
    positive(after.system.value) - positive(old?.system?.effect === "Bleed" ? old.system.value : 0))};
  return {};
}

export function totals(events, actorIds, encounter = "all", rollScope = "all", resistance = "all") {
  const rows = Object.fromEntries(actorIds.map(id => [id, emptyStats()]));
  for (const event of Object.values(events)) {
    if (event.void || (encounter !== "all" && event.encounter !== encounter)) continue;
    for (const [id, delta] of Object.entries(event.actors ?? {})) {
      if (!rows[id]) continue;
      for (const key of KEYS) {
        if (DERIVED_KEYS.includes(key)) continue;
        if (RECORD_KEYS.includes(key)) {
          if (delta[key] == null || !Number.isFinite(Number(delta[key]))) continue;
          if (rollScope === "attack" && event.rollKind !== "attack") continue;
          if (rollScope === "combat" && !["attack", "combat"].includes(event.rollKind)) continue;
          rows[id][key] = rows[id][key] == null ? Number(delta[key]) : Math[key === "openHigh" ? "max" : "min"](rows[id][key], Number(delta[key]));
        } else rows[id][key] += number(delta[key]);
      }
    }
  }
  for (const row of Object.values(rows)) {
    const attempts = row.strikes + row.misses + row.fumbles;
    row.accuracy = attempts > 0 ? 100 * row.strikes / attempts : null;
    const types = resistance === "all" ? RESISTANCES : [resistance];
    row.rrSuccess = types.reduce((n, t) => n + row[`rr${t}Success`], 0);
    row.rrFailure = types.reduce((n, t) => n + row[`rr${t}Failure`], 0);
    row.rrAttempts = row.rrSuccess + row.rrFailure;
    row.rrRate = row.rrAttempts > 0 ? 100 * row.rrSuccess / row.rrAttempts : null;
  }
  return rows;
}

export function leaders(rows, key) {
  if (RECORD_KEYS.includes(key)) {
    const entries = Object.entries(rows).filter(([, r]) => r[key] != null);
    if (!entries.length) return new Set();
    const best = Math[key === "openLow" ? "min" : "max"](...entries.map(([, r]) => r[key]));
    return new Set(entries.filter(([, r]) => r[key] === best).map(([id]) => id));
  }
  const max = Math.max(0, ...Object.values(rows).map(s => s[key] ?? 0));
  return new Set(max > 0 ? Object.keys(rows).filter(id => rows[id][key] === max) : []);
}

export function openEndedResult(die) {
  if (die?.faces !== 100 || !die.modifiers?.some(m => ["oe", "ou"].includes(m))) return null;
  const results = (die.results ?? []).filter(r => r.active !== false && !r.discarded);
  if (results.length < 2 || !results[0].exploded) return null;
  const value = results.reduce((sum, r) => sum + number(r.count ?? r.result), 0);
  const down = results.slice(1).some(r => Number(r.count) < 0);
  return {key: down ? "openLow" : "openHigh", value};
}

export function putEvent(state, event) {
  if (state.events[event.id]) return false;
  state.events[event.id] = event;
  return true;
}

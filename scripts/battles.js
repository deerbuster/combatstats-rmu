import {ID} from "./model.js";
import {isWriter, mutate} from "./store.js";

export function combatSnapshot(combat) {
  return {id: combat.id, name: combat.name || `Battle ${combat.id.slice(-6)}`,
    round: combat.round ?? 0, started: combat.started === true || Number(combat.round) > 0};
}
export function ensureBattle(data, snapshot, at = Date.now(), startObserved = false) {
  data.battles ??= {};
  const battle = data.battles[snapshot.id] ??= {id: snapshot.id, name: snapshot.name,
    trackedAt: at, startedAt: null, endedAt: null, status: "pending"};
  battle.name = snapshot.name || battle.name;
  if (snapshot.started && battle.status === "pending") {
    battle.status = "active";
    battle.startedAt = startObserved ? at : null;
    battle.startedBeforeTracking = !startObserved;
  }
  if (snapshot.started && startObserved && battle.startedAt == null) {
    battle.startedAt = at;
    battle.startedBeforeTracking = false;
  }
  return battle;
}

export function assignHistoryToBattle(data, snapshot, at = Date.now()) {
  const battle = ensureBattle(data, snapshot, at);
  const events = Object.values(data.events);
  const recordedTimes = events.map(e => e.at).filter(t => Number.isFinite(t) && t > 0);
  data.reassignmentBackups ??= [];
  data.reassignmentBackups.push({at, target: snapshot.id, previousBattle: structuredClone(battle),
    events: Object.fromEntries(events.map(e => [e.id, {encounter: e.encounter, battleName: e.battleName}]))});
  for (const event of events) {event.encounter = snapshot.id; event.battleName = snapshot.name;}
  battle.startedAt = recordedTimes.length ? Math.min(...recordedTimes) : battle.trackedAt;
  battle.startAssumed = true;
  battle.startedBeforeTracking = false;
  battle.status = "active";
  battle.endedAt = null;
}

// Match documents, not whichever tracker happens to be selected on this client.
export function findCombat({sceneId, actorIds = []} = {}) {
  const candidates = [...(game.combats?.contents ?? [])].filter(c => c.started === true || Number(c.round) > 0);
  if (!candidates.length) return game.combat?.started ? game.combat : null;
  const matches = candidates.filter(c => (!sceneId || !c.scene?.id || c.scene.id === sceneId)
    && (!actorIds.length || [...(c.combatants ?? [])].some(p => actorIds.includes(p.actorId ?? p.actor?.id))));
  if (matches.length === 1) return matches[0];
  if (matches.some(c => c.id === game.combat?.id)) return game.combat;
  if (sceneId || actorIds.length) return null;
  return candidates.find(c => c.id === game.combat?.id) ?? (candidates.length === 1 ? candidates[0] : null);
}

export async function installBattles() {
  const safe = fn => (...args) => {if (isWriter()) Promise.resolve(fn(...args)).catch(console.error);};
  Hooks.on("createCombat", safe(combat => mutate(data => ensureBattle(data, combatSnapshot(combat)))));
  Hooks.on("preUpdateCombat", (combat, changes, options) => {
    const round = foundry.utils.expandObject(changes).round;
    if (round !== undefined) options[`${ID}Battle`] = {wasStarted: combat.started === true || Number(combat.round) > 0, at: Date.now()};
  });
  Hooks.on("updateCombat", safe((combat, changes, options) => {
    const snapshot = combatSnapshot(combat);
    const transition = options?.[`${ID}Battle`];
    return mutate(data => {
      ensureBattle(data, snapshot, transition?.at ?? Date.now(), transition?.wasStarted === false && snapshot.started);
    });
  }));
  Hooks.on("deleteCombat", safe(combat => mutate(data => {
    const battle = ensureBattle(data, combatSnapshot(combat));
    if (!battle.endedAt) battle.endedAt = Date.now();
    battle.status = "ended";
  })));
  if (isWriter()) await mutate(data => {
    data.schema = 2;
    const combats = game.combats?.contents ?? (game.combat ? [game.combat] : []);
    for (const combat of combats) ensureBattle(data, combatSnapshot(combat));
    for (const event of Object.values(data.events)) {
      if (!event.encounter || event.encounter === "outside" || data.battles?.[event.encounter]) continue;
      data.battles ??= {};
      data.battles[event.encounter] = {id: event.encounter, name: event.battleName || `Battle ${event.encounter.slice(-6)}`,
        startedAt: null, endedAt: null, trackedAt: event.at, startedBeforeTracking: true, status: "historical"};
    }
    const existing = new Set(combats.map(c => c.id));
    for (const battle of Object.values(data.battles ?? {})) {
      if (!existing.has(battle.id) && battle.status !== "ended") battle.status = "historical";
    }
  });
}

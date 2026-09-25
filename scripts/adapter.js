import {ID, SEVERITIES, appliedAttack, conditionDelta, positive} from "./model.js";
import {context, isWriter, record, roster} from "./store.js";
import {readOpenRolls, readResistance} from "./chat-records.js";

let enabled = false;
let upkeepAPI;
const upkeep = new Map();
const safe = fn => (...args) => {try {const task = fn(...args); task?.catch?.(report);} catch (e) {report(e);}};
function report(error) {console.error(`${ID}: tracking error`, error); ui.notifications.error("CombatStats could not record an event. See the console; GM corrections are available.");}
function actorId(actor) {return actor?.isToken ? actor.token?.actorId : actor?.id;}
function sceneFor(message) {return game.scenes.get(message.speaker?.scene) ?? canvas.scene;}
function tokenActor(message, tokenId) {return tokenId ? sceneFor(message)?.tokens.get(tokenId)?.actor : null;}
function sourceActor(message, result) {
  return tokenActor(message, result?.attackerTokenId) ?? tokenActor(message, message.speaker?.token)
    ?? game.actors.get(message.speaker?.actor);
}
function speakerActor(message) {
  return tokenActor(message, message.speaker?.token) ?? game.actors.get(message.speaker?.actor);
}
function compactActors(actors) {
  const allowed = new Set(roster());
  return Object.fromEntries(Object.entries(actors).filter(([id]) => allowed.has(id)));
}
function receipt(message, result, applied) {
  if (!result) return null;
  let actor;
  let delta;
  if (Object.hasOwn(result, "fumbleRollTableUUID")) {
    actor = sourceActor(message, result);
    delta = {fumbles: 1};
  } else if (applied && result.attackerTokenId && result.defenderTokenId && Array.isArray(result.effects)) {
    actor = sourceActor(message, result);
    delta = appliedAttack(result);
  } else if (applied && Array.isArray(result.effects)) {
    // Scene critical and fumble consequence cards have no attacking actor.
    const target = tokenActor(message, result.defenderTokenId) ?? speakerActor(message);
    const targetId = actorId(target);
    if (!targetId) return null;
    return {id: `attack:${message.id}`, kind: "Damage applied", ...context(),
      actors: compactActors({[targetId]: {hitsTaken: appliedAttack(result).hitsDealt, ...receivedCriticals(result)},
        ...(result.attackerTokenId && actorId(tokenActor(message, result.attackerTokenId)) !== targetId
          ? {[actorId(tokenActor(message, result.attackerTokenId))]: {hitsDealt: appliedAttack(result).hitsDealt, bleedInflicted: appliedAttack(result).bleedInflicted}} : {})})};
  } else return null;
  const id = actorId(actor);
  if (!id) return null;
  const actors = {[id]: delta};
  if (applied && result.defenderTokenId) {
    const targetId = actorId(tokenActor(message, result.defenderTokenId));
    if (targetId) actors[targetId] = {...actors[targetId], hitsTaken: delta.hitsDealt ?? 0, ...receivedCriticals(result)};
  }
  return {id: `attack:${message.id}`, kind: "Attack", ...context(), actors: compactActors(actors)};
}
function receivedCriticals(result) {
  const dealt = appliedAttack(result);
  return Object.fromEntries(SEVERITIES.filter(s => dealt[`critical${s}`]).map(s => [`received${s}`, dealt[`critical${s}`]]));
}
function createMessage(message) {
  if (!enabled || !isWriter()) return;
  const rmu = message.flags.rmu;
  const isAttack = !!(rmu?.result?.attackerTokenId && rmu?.result?.defenderTokenId && !rmu?.result?.isSceneCritical)
    || Object.hasOwn(rmu?.result ?? {}, "fumbleRollTableUUID");
  const rollActor = isAttack ? sourceActor(message, rmu.result) : speakerActor(message);
  const id = actorId(rollActor);
  if (id && roster().includes(id) && typeof DOMParser !== "undefined") {
    const rollKind = isAttack ? "attack" : game.combat?.started ? "combat" : "character";
    readOpenRolls(message).forEach((roll, i) => record({id: `roll:${message.id}:${i}`, kind: `Open-ended ${rollKind} roll`, rollKind,
      actors: {[id]: {[roll.key]: roll.value}}}));
    const resistance = readResistance(message, key => game.i18n.localize(key));
    if (resistance) record({id: `rr:${message.id}`, kind: `${resistance.type} resistance: ${resistance.success ? "success" : "failure"}`,
      actors: {[id]: {[`rr${resistance.type}${resistance.success ? "Success" : "Failure"}`]: 1}}});
  }
  if (!rmu) return;
  const event = receipt(message, rmu.result, rmu.applied === true);
  if (event) return record(event);
}
function beforeMessage(message, changes) {
  if (!enabled || !game.user.isGM) return;
  const expanded = foundry.utils.expandObject(changes);
  if (expanded.flags?.rmu?.applied !== true || message.flags.rmu?.applied === true) return;
  const result = message.flags.rmu?.result;
  const event = receipt(message, result, true);
  if (event) changes[`flags.${ID}.receipt`] = event;
}
function updateMessage(message, changes) {
  if (!enabled || !isWriter()) return;
  const expanded = foundry.utils.expandObject(changes);
  if (expanded.flags?.rmu?.applied !== true) return;
  const event = message.getFlag(ID, "receipt");
  if (event) return record(foundry.utils.deepClone(event));
}

function stamp(options, key, value) {
  options[ID] ??= {};
  options[ID][key] = value;
}
function beforeActor(actor, changes, options) {
  if (!enabled) return;
  const next = foundry.utils.getProperty(foundry.utils.expandObject(changes), "system.health.hp.value");
  if (next === undefined) return;
  const loss = Math.max(0, Number(actor.system?.health?.hp?.value) - Number(next));
  if (!Number.isFinite(loss) || loss <= 0) return;
  const id = actorId(actor);
  if (!roster().includes(id)) return;
  const window = upkeep.get(actor.uuid);
  // RMU can resume a paused bleed for movement during this upkeep. Its HP write
  // precedes the effect update, so include paused bleeds in the upper bound.
  const bleedingRate = [...actor.effects].filter(e => e.flags?.rmu && ["Bleed", "Bleeding"].includes(e.name)
    ).reduce((n, e) => n + positive(e.system?.value), 0);
  if (!window || bleedingRate <= 0 || loss > bleedingRate) return;
  stamp(options, actor.uuid, {id: `hp:${foundry.utils.randomID()}`, kind: "Bleeding damage",
    ...window, actors: {[id]: {bleedDamage: loss}}});
}
function afterActor(actor, changes, options) {
  const event = options?.[ID]?.[actor.uuid];
  if (enabled && isWriter() && event) return record(event);
}
function beforeEffect(effect, changes, options) {
  if (!enabled || effect.parent?.documentName !== "Actor") return;
  const after = foundry.utils.mergeObject(effect.toObject(), foundry.utils.expandObject(changes), {inplace: false});
  const delta = conditionDelta(effect.toObject(), after);
  const id = actorId(effect.parent);
  if (!roster().includes(id)) return;
  stamp(options, effect.uuid, {id: `condition:${foundry.utils.randomID()}`, kind: "Condition increased",
    ...context(), actors: {[id]: delta}});
}
function createEffect(effect) {
  if (!enabled || !isWriter() || effect.parent?.documentName !== "Actor") return;
  const id = actorId(effect.parent);
  return record({id: `condition:${effect.uuid}`, kind: "Condition applied", actors: {[id]: conditionDelta(null, effect.toObject())}});
}
function updateEffect(effect, changes, options) {
  const event = options?.[ID]?.[effect.uuid];
  if (enabled && isWriter() && event) return record(event);
}

// Register before init: RMU registers its upkeep listener inside init. The
// microtask runs after RMU has installed its upkeepSettled promise.
Hooks.on("combatRound", safe((combat, changes) => {
  if (!enabled || !isWriter() || !upkeepAPI) return;
  const window = {...context(combat), encounter: combat.id, round: changes.round};
  const uuids = [...combat.combatants].map(c => c.actor?.uuid).filter(Boolean);
  for (const uuid of uuids) upkeep.set(uuid, window);
  queueMicrotask(() => upkeepAPI.upkeepSettled().finally(() => {
    for (const uuid of uuids) if (upkeep.get(uuid) === window) upkeep.delete(uuid);
  }));
}));

export async function installAdapter(loadUpkeep = () => import(new URL("../../../systems/rmu/module/rmu/combat-tracker/hook-combat-round.js", import.meta.url).href)) {
  if (game.system.id !== "rmu" || game.release.generation !== 14) {
    ui.notifications.error("CombatStats requires RMU on Foundry VTT 14.");
    return;
  }
  try {
    upkeepAPI = await loadUpkeep();
    if (typeof upkeepAPI.upkeepSettled !== "function") throw new Error("RMU upkeepSettled is unavailable");
  } catch (error) {
    console.warn(`${ID}: bleeding tick detection unavailable`, error);
    ui.notifications.warn("CombatStats: this RMU build does not expose upkeep completion. Bleeding-rate totals still work; use GM corrections for bleeding damage.");
  }
  enabled = true;
  Hooks.on("createChatMessage", safe(createMessage));
  Hooks.on("preUpdateChatMessage", safe(beforeMessage));
  Hooks.on("updateChatMessage", safe(updateMessage));
  Hooks.on("preUpdateActor", safe(beforeActor));
  Hooks.on("updateActor", safe(afterActor));
  Hooks.on("preUpdateActiveEffect", safe(beforeEffect));
  Hooks.on("createActiveEffect", safe(createEffect));
  Hooks.on("updateActiveEffect", safe(updateEffect));
}

import {ID, KEYS, RECORD_KEYS, DERIVED_KEYS, number, putEvent} from "./model.js";
import {combatSnapshot, ensureBattle, findCombat} from "./battles.js";
export const isWriter = () => game.user.isGM && game.users.activeGM?.id === game.user.id;
export const state = () => game.settings.get(ID, "ledger");
export const roster = () => game.settings.get(ID, "roster");
let queue = Promise.resolve();
export function mutate(fn) {
  const task = queue.then(async () => {
    if (!isWriter()) throw new Error("Use the active GM account to change CombatStats.");
    const next = foundry.utils.deepClone(state());
    if (fn(next) === false) return;
    await game.settings.set(ID, "ledger", next);
  });
  queue = task.catch(error => {
    console.error(`${ID}: statistics write failed`, error);
    ui.notifications.error(`CombatStats: ${error.message}`);
  });
  return task;
}
export function context(combat = findCombat()) {
  const snapshot = combat ? combatSnapshot(combat) : null;
  return {encounter: snapshot?.started ? snapshot.id : "outside", round: snapshot?.round ?? 0,
    battleName: snapshot?.started ? snapshot.name : ""};
}
export function record(event) {
  if (!isWriter() || !game.settings.get(ID, "enabled")) return;
  const allowed = new Set(roster());
  event.actors = Object.fromEntries(Object.entries(event.actors ?? {}).filter(([id]) => allowed.has(id))
    .map(([id, delta]) => [id, Object.fromEntries(KEYS.filter(k => !DERIVED_KEYS.includes(k) &&
      (RECORD_KEYS.includes(k) ? delta[k] != null && Number.isFinite(Number(delta[k])) : number(delta[k]) !== 0)).map(k => [k, number(delta[k])]))])
    .filter(([, delta]) => Object.keys(delta).length));
  if (!Object.keys(event.actors).length) return;
  const stamped = {at: Date.now(), ...context(), ...event};
  // No enemy names, actor identities, or complete RMU results enter the shared ledger.
  return mutate(next => {
    if (stamped.encounter !== "outside") ensureBattle(next, {id: stamped.encounter, name: stamped.battleName, started: true}, stamped.at);
    return putEvent(next, stamped);
  });
}
export function registerSettings(onChange) {
  game.settings.register(ID, "enabled", {name: "Record new combat statistics", scope: "world", config: true, type: Boolean, default: true, onChange});
  game.settings.register(ID, "roster", {scope: "world", config: false, type: Array, default: [], onChange});
  game.settings.register(ID, "ledger", {scope: "world", config: false, type: Object,
    default: {schema: 1, events: {}}, onChange});
}

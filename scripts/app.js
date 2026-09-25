import {ID, GROUPS, KEYS, DERIVED_KEYS, RESISTANCES, totals, leaders} from "./model.js";
import {state, roster, isWriter, mutate, record} from "./store.js";
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const {ApplicationV2, HandlebarsApplicationMixin, DialogV2} = foundry.applications.api;
const liveApps = new Set();
export class CombatStatsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "combatstats-rmu", classes: ["combatstats-rmu"], tag: "section",
    window: {title: "COMBATSTATS.Title", icon: "fa-solid fa-chart-column", resizable: true},
    position: {width: 1000, height: 620},
    actions: {
      roster: CombatStatsApp.editRoster, correct: CombatStatsApp.correct,
      export: CombatStatsApp.exportData, toggle: CombatStatsApp.toggleEvent
    }
  };
  static PARTS = {body: {template: "modules/combatstats-rmu/templates/stats.hbs"}};
  group = "overview";
  encounter = "all";
  rollScope = "all";
  resistance = "all";
  async _prepareContext() {
    const data = state();
    const ids = roster();
    const stats = totals(data.events, ids, this.encounter, this.rollScope, this.resistance);
    const columns = GROUPS[this.group].columns;
    const crowns = Object.fromEntries(columns.map(([k]) => [k, leaders(stats, k)]));
    const encounterIds = [...new Set(Object.values(data.events).map(e => e.encounter))].filter(id => id !== "outside");
    const names = id => game.combats.get(id)?.name ?? `Encounter ${id.slice(-6)}`;
    const events = Object.values(data.events).filter(e => this.encounter === "all" || e.encounter === this.encounter)
      .sort((a, b) => b.at - a.at).slice(0, 40).map(e => ({
        id: e.id, void: e.void, kind: e.kind, when: new Date(e.at).toLocaleString(), round: e.round,
        detail: Object.entries(e.actors).map(([id, delta]) => `${game.actors.get(id)?.name ?? "Removed character"}: ` +
          Object.entries(delta).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${label(k)}`).join(", ")).join(" · ")
      }));
    return {
      enabled: game.settings.get(ID, "enabled"), gm: game.user.isGM, writer: isWriter(),
      hasGM: !!game.users.activeGM, totalEvents: Object.keys(data.events).length,
      groups: Object.entries(GROUPS).map(([id, g]) => ({id, label: g.label, selected: id === this.group})),
      scopes: [{id: "all", label: "Campaign totals"}, {id: "outside", label: "Outside encounters"},
        ...encounterIds.map(id => ({id, label: names(id)}))].map(s => ({...s, selected: s.id === this.encounter})),
      columns: columns.map(([key, name]) => ({key, name})),
      rows: ids.map(id => ({id, name: game.actors.get(id)?.name ?? "Removed character",
        cells: columns.map(([key]) => ({value: stats[id][key] == null ? "—" : ["accuracy", "rrRate"].includes(key)
          ? `${stats[id][key].toFixed(1)}%` : stats[id][key], leader: crowns[key].has(id),
          leaderLabel: key === "openLow" ? "Lowest downward open-ended roll (ties share the star)" : "Highest total in this category (ties share the star)"}))})),
      rollScopes: [{id: "all", label: "All character rolls"}, {id: "combat", label: "All combat rolls"}, {id: "attack", label: "Attack rolls"}]
        .map(s => ({...s, selected: s.id === this.rollScope})),
      resistanceTypes: ["all", ...RESISTANCES].map(id => ({id, label: id === "all" ? "All resistance types" : id, selected: id === this.resistance})),
      criticals: ["criticals", "received"].includes(this.group), bleeding: this.group === "bleeding",
      rolls: this.group === "rolls", resistanceView: this.group === "resistance", events
    };
  }
  _onRender(context, options) {
    super._onRender(context, options);
    liveApps.add(this);
    this.element.querySelector('[name="group"]').addEventListener("change", event => {this.group = event.target.value; this.render();});
    this.element.querySelector('[name="scope"]').addEventListener("change", event => {this.encounter = event.target.value; this.render();});
    this.element.querySelector('[name="rollScope"]')?.addEventListener("change", event => {this.rollScope = event.target.value; this.render();});
    this.element.querySelector('[name="resistance"]')?.addEventListener("change", event => {this.resistance = event.target.value; this.render();});
  }
  _onClose(options) {liveApps.delete(this); super._onClose(options);}
  static async editRoster() {
    if (!isWriter()) return ui.notifications.warn("Use the active GM account to edit the roster.");
    const selected = new Set(roster());
    const actors = game.actors.contents.filter(a => ["Character", "Creature"].includes(a.type) || selected.has(a.id));
    const checks = actors.sort((a,b) => a.name.localeCompare(b.name)).map(a =>
      `<label class="cs-roster-choice"><input type="checkbox" name="actor" value="${escape(a.id)}" ${selected.has(a.id) ? "checked" : ""}> ${escape(a.name)}</label>`).join("");
    const result = await DialogV2.wait({window: {title: "Friendly character roster"}, position: {width: 520},
      content: `<p>Select the characters whose statistics everyone may see. Tracking starts when a character joins this roster. Use linked tokens for PCs.</p><div style="max-height:350px;overflow:auto;display:grid;gap:8px">${checks || "No character actors found."}</div>`,
      buttons: [{action: "save", label: "Save roster", default: true, callback: (e, button) =>
        [...button.form.querySelectorAll('[name="actor"]:checked')].map(el => el.value)}, {action: "cancel", label: "Cancel"}], close: () => null});
    if (Array.isArray(result)) await game.settings.set(ID, "roster", result);
  }
  static async correct() {
    if (!isWriter()) return ui.notifications.warn("Use the active GM account to correct statistics.");
    const actors = roster().map(id => `<option value="${escape(id)}">${escape(game.actors.get(id)?.name ?? id)}</option>`).join("");
    if (!actors) return ui.notifications.warn("Select a friendly roster first.");
    const keys = KEYS.filter(k => !DERIVED_KEYS.includes(k)).map(k => `<option value="${k}">${escape(label(k))}</option>`).join("");
    const result = await DialogV2.wait({window: {title: "Record a statistics correction"},
      content: `<p>This adds an auditable adjustment; it does not change the character or combat. For open-ended records, enter the raw roll total instead of a delta. Undo a wrong record before replacing it.</p>
        <label>Character<select name="actor">${actors}</select></label><label>Category<select name="key">${keys}</select></label>
        <label>Adjustment (negative subtracts)<input name="amount" type="number" step="1" value="1" required></label>
        <label>Reason<input name="reason" maxlength="120" required></label>`,
      buttons: [{action: "save", label: "Record correction", default: true, callback: (e, b) => ({
        actor: b.form.elements.actor.value, key: b.form.elements.key.value,
        amount: Number(b.form.elements.amount.value), reason: b.form.elements.reason.value.trim()
      })}, {action: "cancel", label: "Cancel"}], close: () => null});
    if (!result || typeof result !== "object") return;
    if (!result.reason || !Number.isSafeInteger(result.amount)) return ui.notifications.warn("Enter a whole-number adjustment and a reason.");
    if (!game.settings.get(ID, "enabled")) return ui.notifications.warn("Resume recording before adding a correction.");
    await record({id: `manual:${foundry.utils.randomID()}`, kind: `Correction: ${result.reason}`,
      rollKind: this.rollScope === "all" ? "character" : this.rollScope,
      ...(this.encounter !== "all" ? {encounter: this.encounter} : {}), actors: {[result.actor]: {[result.key]: result.amount}}});
  }
  static async toggleEvent(event, button) {
    if (!isWriter()) return;
    const id = button.dataset.event;
    await mutate(next => {if (!next.events[id]) return false; next.events[id].void = !next.events[id].void;});
  }
  static exportData() {
    const data = {module: ID, version: "0.1.0", exported: new Date().toISOString(), roster: roster(), ...state()};
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: "application/json"}));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "combatstats-rmu.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
function label(key) {
  const rr = /^rr(.+)(Success|Failure)$/.exec(key);
  if (rr) return `${rr[1]} resistance ${rr[2] === "Success" ? "successful" : "failed"}`;
  return Object.values(GROUPS).flatMap(g => g.columns.map(([k, v]) => [k,
    g === GROUPS.criticals ? `Critical ${v} dealt` : g === GROUPS.received ? `Critical ${v} received` : v])).find(([k]) => k === key)?.[1] ?? key;
}
let app;
export function openStats() {app ??= new CombatStatsApp(); return app.render({force: true});}
export function refreshStats() {for (const instance of liveApps) if (instance.rendered) instance.render();}

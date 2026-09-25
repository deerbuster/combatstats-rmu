import {ID} from "./model.js";
import {registerSettings, isWriter, roster} from "./store.js";
import {CombatStatsApp, openStats, refreshStats} from "./app.js";
import {installAdapter} from "./adapter.js";

Hooks.once("init", () => {
  registerSettings(refreshStats);
  game.settings.registerMenu(ID, "stats", {name: "CombatStats for RMU", label: "Open CombatStats",
    hint: "Individual statistics and category leaders for the friendly roster.", icon: "fa-solid fa-chart-column",
    type: CombatStatsApp, restricted: false});
});
Hooks.once("ready", async () => {
  game.modules.get(ID).api = {open: openStats};
  await installAdapter();
  if (isWriter() && !roster().length) ui.notifications.info("CombatStats: open Module Settings → CombatStats for RMU and select your friendly roster to begin tracking.");
});
Hooks.on("renderCombatTracker", (app, element) => {
  if (!(element instanceof HTMLElement) || element.querySelector(".cs-open")) return;
  const button = document.createElement("button");
  button.type = "button"; button.className = "cs-open";
  button.innerHTML = '<i class="fa-solid fa-chart-column" aria-hidden="true"></i> CombatStats';
  button.addEventListener("click", openStats);
  element.append(button);
});

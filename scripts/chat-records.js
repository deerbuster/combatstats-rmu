import {RESISTANCES, openEndedResult} from "./model.js";
const parse = html => new DOMParser().parseFromString(html ?? "", "text/html");
const clean = text => String(text ?? "").replace(/\s+/g, " ").trim();

/** RMU 1.4.91 uses rendered Roll HTML, not ChatMessage.rolls, on system cards.
 * Foundry 14.367 tooltip-part.part-total is the dice term total BEFORE bonuses.
 * No dice evaluation or system methods are changed by this read-only adapter. */
export function readOpenRolls(message) {
  const native = [...message.rolls ?? []].flatMap(roll => [...roll.dice ?? []].map(openEndedResult).filter(Boolean));
  if (native.length) return native;
  const full = message.flags?.rmu?.spoiler?.roll?.full;
  const doc = parse(full ?? message.content);
  const root = full ? doc : doc.querySelector(".rmu-primary-chat-card__content .rmu-chat-roll-container")
    ?? doc.querySelector(".rmu-chat-roll-container") ?? doc;
  const records = [];
  for (const part of root.querySelectorAll(".tooltip-part")) {
    const formula = clean(part.querySelector(".part-formula")?.textContent);
    if (!/^1?d100o[eu]$/i.test(formula)) continue;
    const dice = [...part.querySelectorAll(".dice-rolls .roll:not(.discarded):not(.rerolled)")];
    if (dice.length < 2 || !dice[0].classList.contains("exploded")) continue;
    const raw = clean(part.querySelector(".part-total")?.textContent);
    const value = Number(raw.replace(/−/g, "-"));
    if (!raw || !Number.isFinite(value)) continue;
    const first = Number(clean(dice[0].textContent));
    records.push({key: /oe$/i.test(formula) && first <= 5 ? "openLow" : "openHigh", value});
  }
  return records;
}

export function readResistance(message, localize) {
  const doc = parse(message.content);
  const heading = doc.querySelector(".rmu-chat-resistance-icon");
  if (!heading) return null;
  const name = clean(heading.textContent);
  const type = RESISTANCES.find(t => clean(localize(`RMU.Resistance.${t}`)) === name || t === name);
  if (!type) return null;
  const spoiler = message.flags?.rmu?.spoiler?.result;
  const outcome = spoiler ? parse(spoiler) : doc.querySelector('[data-rmu-redact="result"]');
  const title = clean(outcome?.querySelector("h2")?.textContent);
  // Willing targets did not roll and count neither as a success nor a failure.
  if (!title || title === clean(localize("RMU.Terms.RRWillingTarget"))) return null;
  const success = clean(localize("RMU.Terms.Success"));
  const failure = clean(localize("RMU.Terms.Failure"));
  if (title === success) return {type, success: true};
  if (title === failure || title.startsWith(`${failure} `)) return {type, success: false};
  return null;
}

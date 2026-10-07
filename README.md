# CombatStats for RMU — 0.2.0 prerelease

Standalone module targeting **Foundry VTT 14, build 367**. Developed against **RMU 1.4.91**. No RMU source files are modified or bundled. This is an initial prerelease, not yet verified in a live Foundry world.

Version 0.2.0 adds **Conditions dealt**, checked against the installed **RMU 1.4.106** attack application and condition implementations. All categories support per-battle and campaign totals. New dealt-condition counters start recording after this update; old events cannot be backfilled automatically.

## Install

1. In Foundry Setup, open **Add-on Modules → Install Module**, paste the manifest URL below, and install. For manual installation, create `Data/modules/combatstats-rmu` in your Foundry user data directory and extract the release ZIP directly into it; `module.json` must be at that folder's root.
2. Restart Foundry if needed, open your RMU world, and enable **CombatStats for RMU** in Manage Modules.
3. Open **Configure Settings → Module Settings → CombatStats for RMU → Open CombatStats**. A CombatStats button is also added to the combat tracker.
4. As the active GM, click **Friendly roster** and select the characters to track. The roster starts empty deliberately; friendly NPCs may be selected too. Use linked tokens for player characters.
5. Keep a GM connected. Recording starts with new events after roster selection; existing chat history is not imported.

Manifest URL:

```text
https://raw.githubusercontent.com/deerbuster/combatstats-rmu/main/module.json
```

The manifest currently installs the **v0.2.0 prerelease**. See [releases](https://github.com/deerbuster/combatstats-rmu/releases) for the ZIP and release-specific manifest. Report reproducible problems through [GitHub Issues](https://github.com/deerbuster/combatstats-rmu/issues).

Optional script macro:

```js
game.modules.get("combatstats-rmu").api.open();
```

## Counting rules

| Category | Definition |
| --- | --- |
| Successful strikes | Applied attack deals at least 1 instantaneous hit, including damage from its critical. |
| Misses | Resolved/applied attack deals no instantaneous damage. A zero-damage attack with a non-damaging critical is a miss and a critical. |
| Fumbles | One per initial attack-fumble result. Applying its consequences does not count another fumble. Fumbles do not also count as misses. |
| Hits dealt / taken | Instantaneous damage from the applied hit and critical only. **Bleeding is excluded.** Manual HP adjustments are not treated as attacks. |
| Accuracy | Strikes ÷ (strikes + misses + fumbles), displayed as a percentage. No attempts displays “—”. |
| Criticals dealt / received | Separate Z, A, B, C, D, E, F, G, H, I, J counters from an applied result, **before critical negation**. See limitations. |
| Times stunned | One application per affected severity: −25, −50, −75. Additional rounds at that severity count as a new application; normal countdown does not. Four rounds applied at once count once. |
| Times knocked prone | A newly applied prone condition. Remaining prone does not increment it. |
| Times staggered | A new stagger effect or an increase to an existing stagger effect. Paying off its AP does not increment it. |
| Conditions dealt | Stun −25/−50/−75, prone, and staggered results on an applied attack after negation, credited to its attacker. One per affected category per result, not per round or AP. A prone result counts even if the target is already prone. RR-linked conditions credit the caster when RMU identifies one; source-free conditions and self-inflicted fumble consequences are not credited. |
| Bleeding rate inflicted / suffered | Sum of newly applied hits-per-round rates. A 3 hits/round wound adds 3 once. Countdown or healing does not add anything. |
| Bleeding damage | Actual HP lost to bleeding during RMU combat upkeep. A 3 hits/round wound that ticks twice adds 6. This never increases hits dealt/taken. |
| Highest upward / lowest downward open-ended roll | Raw d100 dice-term total before bonuses, only if it actually open-ended. Includes the complete chain. Missing records display “—”. |
| Resistance successes / failures | Separate counts for Channeling, Essence, Mentalism, Physical, Fear, selected by the resistance actually used. Willing targets who do not roll are excluded. Attempts and success rate are derived. |

Open-ended record scopes: **all character rolls** (default), **all combat rolls**, **attacks**. All combat rolls includes attack rolls plus other character rolls made while an encounter is started. RMU attacks open upward only; downward attack records normally remain empty. Plain rolls outside an encounter appear under all character rolls. Rolls must be posted to chat with an identifiable character speaker.

## Stats page and history

- Select a category and campaign totals or a recorded encounter. Outside-encounter events have a separate filter.
- **Battle / campaign** applies to every category, including conditions dealt, resistance types, percentages, and open-ended records. Campaign percentages are recalculated from combined attempts; record highs/lows are extrema, not sums. Leaders are recalculated for the selected battle or campaign.
- Each Foundry combat encounter is one battle. Create a new encounter for a new battle; resetting/reusing the same encounter combines its statistics. New events preserve the battle's name even if that encounter is later deleted.
- A ★ marks the highest total in a category. Lowest downward roll uses the most negative result. Ties share the star. Zero counters have no leader.
- The roster controls both new tracking and which characters appear. Removing a character hides existing totals without deleting the history; re-adding restores them. Time absent from the roster is not backfilled.
- **Correct stats** adds a signed adjustment with a required reason. For an open-ended record, enter the actual raw total, not a delta; choose its roll scope first. To lower a mistaken high record or raise a mistaken low record, undo the incorrect event before entering the replacement.
- Recent events shows the latest 40 entries for that history filter. **Undo / Restore** changes only the statistics; it never modifies actors, effects, rolls, HP, or the combat.
- **Export** downloads the complete statistics ledger as JSON. It is an audit export, not an automatic import/restore feature.
- Campaign history survives deleting chat messages and encounters. Older encounters without a stored name retain an ID-based label. Back up the Foundry world to preserve all module settings.
- Only the active GM writes statistics, preventing multiple connected GMs/players from counting the same event. Only that GM can edit the roster or make corrections. The friendly roster and its statistics are shared with all world users.
- The module setting **Record new combat statistics** pauses recording. Resume it before entering corrections.

## Known limits in this first build

1. **Critical negation:** RMU does not persist a per-critical negation outcome linked to the originating attack. This build counts the critical severities on the resolved result before negation. Its damage/effect accounting uses the final applied damage and actual conditions. Correct negated critical counters manually if you want post-negation critical totals.
2. **Bleeding through the rest dialog or manual HP changes:** RMU combines rest recovery and bleeding into one net change. This build automatically recognizes combat-upkeep bleeding, including paused wounds resumed by movement. Enter a correction for rest/manual bleeding. During the short upkeep window, avoid unrelated manual HP edits: attribution matches an HP loss to the actor's available bleeding rate.
3. **Other automations:** A macro or third-party module that directly changes HP without applying an RMU result cannot establish damage source or strikes. Condition applications still record when they use Actor ActiveEffects. Use corrections for unsupported actions.
4. **Counts follow completed document operations:** unapplied attack cards with effects are not counted yet. A failure partway through RMU's multi-document apply may record conditions without the final attack receipt; use the audit log to correct the partial action. Undoing combat state or deleting chat does not automatically reverse history.
5. **GM availability:** no GM means no automatic recording. A connection loss during an operation can require a correction. Previously applied cards are not rescanned on reload.
6. **Identity:** linked tokens aggregate into their world Actor. Unlinked tokens using the same base Actor also share a roster identity; use distinct Actors when you need distinct character statistics.
7. **Source changes:** attack flags, RMU resistance HTML, and Foundry dice tooltip structures were inspected in the supplied RMU 1.4.91 and installed Foundry 14.367. Later versions need rechecking. If RMU's upkeep-completion export is missing, the module warns and disables automatic bleeding-damage detection; other tracking continues.
8. **Scope:** the fumble counter covers attack fumbles. Non-attack spell failures or skill failures are not automatically treated as attack fumbles. Resistance-type tracking follows the five types defined by this RMU build.

## Validation

Included tests run without dependencies on Node 24:

```text
npm test
```

20 tests cover damage/bleeding separation, duplicate handling, GM-only writing, self-inflicted fumble consequences, critical severities, condition countdown, derived accuracy, open-ended chains and scopes, resistance grouping, ties, undo/filter behavior, post-negation dealt conditions, caster attribution, and battle/campaign aggregation for every counter.

An isolated Edge browser harness also passed 26 parser/context checks and rendered four table views with no page errors. It uses the installed Foundry dice tooltip template. These tests do **not** substitute for a live Foundry integration test.

### Live-world acceptance checks

Use a disposable test world or test encounter with two linked friendly characters and an enemy. Keep a GM and player logged in.

1. Apply a 10-hit attack with a 7-hit C critical. Expect 1 strike, 17 hits dealt, 17 hits taken, 1 C dealt/received. Re-render/reload the card: totals must not increment.
2. Resolve a zero-damage miss and an attack fumble. Expect one miss and one fumble, not two misses. Apply fumble consequences: no additional fumble.
3. Apply a 3 hits/round bleeding wound. Expect rates +3 inflicted/suffered. Advance two upkeep rounds: bleeding damage +6; direct hits remain unchanged.
4. Apply four rounds at −25 and two at −50. Expect one application in each severity. Advance rounds: no new stun applications.
5. Apply prone and staggered; process normal movement/AP recovery. Counters must not increment during recovery.
6. Make and fail a resistance roll for each type. Confirm the selected type, totals, and percentages. Choose not to resist: no RR attempt.
7. Post an actual upward-open attack roll and a downward-open resistance/skill roll. Confirm raw dice subtotal records, including a downward opener of 5. Verify the three scope filters.
8. Produce a tie, undo an event, restore it, and add a correction. Check stars and both campaign/encounter totals.
9. Connect a second GM and repeat an attack. It must count once. Repeat with a redacted player roll and a friendly NPC in the roster.

## Upgrade

Replace this module folder with the next release while the world is closed. The ledger and roster live in world settings under `combatstats-rmu`, not in this folder. Do not delete those settings. The current schema is version 1; no world migration is performed.

## Source references

Integration inspected against the supplied system's `render-attack.js`, `hook-attack-chat-ws.js`, condition constructors, `render-rr.js`, `spoilers.js`, and combat-upkeep implementation. Original system files are not distributed here.

Foundry's [ApplicationV2 documentation](https://foundryvtt.com/api/classes/foundry.applications.api.ApplicationV2.html), [document hooks](https://foundryvtt.com/api/modules/hookEvents.html), and [Roll API](https://foundryvtt.com/api/classes/foundry.dice.Roll.html) were checked alongside the local 14.367 implementation.

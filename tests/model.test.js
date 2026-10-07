import test from "node:test";
import assert from "node:assert/strict";
import {appliedAttack, conditionsDealt, conditionDelta, totals, leaders, emptyStats, putEvent, SEVERITIES, openEndedResult, KEYS, DERIVED_KEYS, RECORD_KEYS} from "../scripts/model.js";

test("hit plus critical damage counts once; Attack Hits display metadata is excluded", () => {
  const stats = appliedAttack({attackerTokenId: "t", effects: [{effect:"Hits",value:17},{effect:"Attack Hits",value:10},{effect:"Bleed",value:3}]});
  assert.equal(stats.hitsDealt,17); assert.equal(stats.strikes,1); assert.equal(stats.bleedInflicted,3);
});
test("zero-damage critical is a miss and a critical, never a successful strike", () => {
  const stats = appliedAttack({attackerTokenId:"t",effects:[{effect:"Stun",rounds:[1,0,0]}],criticalResult:{criticals:[{severityShortCode:"A"}]}});
  assert.equal(stats.misses,1); assert.equal(stats.criticalA,1); assert.equal(stats.strikes,undefined);
});
test("all requested severities including Z and J are distinct", () => {
  const stats = appliedAttack({effects:[],criticalResult:{criticals:SEVERITIES.map(severityShortCode => ({severityShortCode}))}});
  for (const s of SEVERITIES) assert.equal(stats[`critical${s}`],1);
});
test("condition-only critical records are excluded", () => {
  const stats = appliedAttack({effects:[],criticalResult:{criticals:[{severityShortCode:"E",conditionOnly:true}]}});
  assert.equal(stats.criticalE,undefined);
});
test("stun counts severity applications, never rounds or decay", () => {
  const stun = rounds => ({system:{type:"stun",rounds}});
  assert.deepEqual(conditionDelta(null,stun([4,2,0])),{stun25:1,stun50:1,stun75:0});
  assert.deepEqual(conditionDelta(stun([4,2,0]),stun([3,2,0])),{stun25:0,stun50:0,stun75:0});
  assert.deepEqual(conditionDelta(stun([4,2,0]),stun([6,2,1])),{stun25:1,stun50:0,stun75:1});
});
test("prone and staggered count new applications, not remaining AP", () => {
  const prone={system:{type:"prone"}};
  assert.deepEqual(conditionDelta(null,prone),{prone:1});
  assert.deepEqual(conditionDelta(prone,prone),{});
  assert.deepEqual(conditionDelta({system:{type:"staggered",value:2}},{system:{type:"staggered",value:1}}),{});
  assert.deepEqual(conditionDelta(null,{system:{type:"staggered",value:4}}),{staggered:1});
});
test("bleeding rate increments are independent of damage and healing does not subtract history", () => {
  const bleed=value=>({system:{type:"injury",effect:"Bleed",value}});
  assert.deepEqual(conditionDelta(null,bleed(3)),{bleedSuffered:3});
  assert.deepEqual(conditionDelta(bleed(3),bleed(2)),{bleedSuffered:0});
  assert.deepEqual(conditionDelta(bleed(3),bleed(5)),{bleedSuffered:2});
});
test("disabled effects do not produce new conditions",()=>assert.deepEqual(conditionDelta(null,{disabled:true,system:{type:"prone"}}),{}));
test("event identity prevents duplicates even after undo", () => {
  const state={events:{}}; const event={id:"one",actors:{a:{strikes:1}}};
  assert.equal(putEvent(state,event),true); state.events.one.void=true;
  assert.equal(putEvent(state,event),false);
});
test("encounter filters and undo preserve campaign history; bleeding stays separate", () => {
  const events={a:{encounter:"one",actors:{a:{hitsTaken:17}}},b:{encounter:"one",actors:{a:{bleedDamage:6}}},
    c:{encounter:"two",actors:{a:{hitsTaken:10}}},d:{encounter:"one",void:true,actors:{a:{hitsTaken:99}}}};
  assert.equal(totals(events,["a"]).a.hitsTaken,27);
  assert.equal(totals(events,["a"],"one").a.hitsTaken,17);
  assert.equal(totals(events,["a"]).a.bleedDamage,6);
});
test("positive tied leaders all get stars; zero totals get none", () => {
  const rows={a:emptyStats(),b:emptyStats(),c:emptyStats()};
  assert.equal(leaders(rows,"strikes").size,0);
  rows.a.strikes=2; rows.b.strikes=2;
  assert.deepEqual([...leaders(rows,"strikes")],["a","b"]);
});
test("accuracy includes fumbles in attempts exactly once", () => {
  const row=totals({one:{actors:{a:{strikes:3,misses:1,fumbles:2}}}},['a']).a;
  assert.equal(row.accuracy,50);
  assert.equal(totals({},['a']).a.accuracy,null);
});
test("open-ended totals honor negative chained counts and exclude ordinary low rolls", () => {
  assert.deepEqual(openEndedResult({faces:100,modifiers:['oe'],results:[{result:3,exploded:true},{result:98,count:-98,exploded:true},{result:44,count:-44}]}),{key:'openLow',value:-139});
  assert.deepEqual(openEndedResult({faces:100,modifiers:['ou'],results:[{result:98,exploded:true},{result:44}]}),{key:'openHigh',value:142});
  assert.equal(openEndedResult({faces:100,modifiers:['ou'],results:[{result:3}]}),null);
  assert.equal(openEndedResult({faces:100,modifiers:[],results:[{result:99,exploded:true},{result:20}]}),null);
});
test("open-ended records use extrema, support zero, scopes, undo, and low-record leaders", () => {
  const events={a:{rollKind:'attack',actors:{a:{openHigh:144}}},b:{rollKind:'character',actors:{a:{openHigh:220,openLow:-105}}},
    c:{rollKind:'combat',actors:{a:{openLow:0},b:{openLow:-20}}},d:{rollKind:'attack',void:true,actors:{a:{openHigh:999}}}};
  assert.equal(totals(events,['a']).a.openHigh,220);
  assert.equal(totals(events,['a'],'all','attack').a.openHigh,144);
  assert.equal(totals(events,['a'],'all','attack').a.openLow,null);
  assert.equal(totals(events,['a'],'all','combat').a.openLow,0);
  assert.deepEqual([...leaders(totals(events,['a','b']),'openLow')],['a']);
});
test("resistance successes and failures stay separated by type", () => {
  const events={a:{actors:{a:{rrFearSuccess:2,rrFearFailure:1,rrEssenceFailure:3}}}};
  let row=totals(events,['a']).a;assert.equal(row.rrAttempts,6);assert.equal(row.rrSuccess,2);
  row=totals(events,['a'],'all','all','Fear').a;assert.equal(row.rrAttempts,3);assert.equal(row.rrRate,200/3);
  assert.equal(totals({},['a']).a.rrRate,null);
});
test("conditions dealt count result applications, not durations or AP", () => {
  assert.deepEqual(conditionsDealt({effects:[{effect:'Stun',rounds:[4,0,2]},
    {effect:'Stun',rounds:[1,0,0]},{effect:'Prone',count:3},{effect:'Staggered',value:4}]}),
    {dealtStun25:1,dealtStun75:1,dealtProne:1,dealtStaggered:1});
  assert.deepEqual(conditionsDealt({effects:[{effect:'heal-stun',value:3},{effect:'Stun',rounds:[0,-1,0]},{effect:'Bleed',value:3}]}),{});
});
test("every stored counter supports separate battle and campaign totals", () => {
  const counters=KEYS.filter(k=>!DERIVED_KEYS.includes(k)&&!RECORD_KEYS.includes(k));
  const delta=n=>Object.fromEntries(counters.map(k=>[k,n]));
  const events={first:{encounter:'first',actors:{a:delta(2)}},second:{encounter:'second',actors:{a:delta(3)}}};
  for(const key of counters){
    assert.equal(totals(events,['a'],'first').a[key],2,key);
    assert.equal(totals(events,['a'],'second').a[key],3,key);
    assert.equal(totals(events,['a']).a[key],5,key);
  }
});
test("battle records and rates are recalculated rather than summed", () => {
  const events={first:{encounter:'first',rollKind:'attack',actors:{a:{strikes:1,misses:1,openHigh:200,openLow:-20,rrFearSuccess:1}}},
    second:{encounter:'second',rollKind:'combat',actors:{a:{strikes:3,openHigh:150,openLow:-90,rrFearFailure:3}}}};
  assert.equal(totals(events,['a'],'first').a.accuracy,50);
  const all=totals(events,['a']).a;
  assert.equal(all.accuracy,80);assert.equal(all.rrRate,25);assert.equal(all.openHigh,200);assert.equal(all.openLow,-90);
});

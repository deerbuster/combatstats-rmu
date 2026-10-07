import test from "node:test";
import assert from "node:assert/strict";
import {ID,totals} from "../scripts/model.js";
const callbacks = new Map();
globalThis.Hooks={on:(name,fn)=>{if(!callbacks.has(name))callbacks.set(name,[]);callbacks.get(name).push(fn);}};
const call=(name,...args)=>{for(const fn of callbacks.get(name)??[])fn(...args);};
const errors=[];
globalThis.ui={notifications:{error:e=>errors.push(e),warn:()=>{}}};
function expand(object){const result={};for(const [key,value] of Object.entries(object)){let cursor=result;const keys=key.split(".");for(const part of keys.slice(0,-1))cursor=cursor[part]??={};cursor[keys.at(-1)]=value;}return result;}
function merge(a,b){for(const[k,v]of Object.entries(b)){if(v&&typeof v==="object"&&!Array.isArray(v))a[k]=merge(a[k]??{},v);else a[k]=v;}return a;}
let seq=0;
globalThis.foundry={utils:{deepClone:structuredClone,expandObject:expand,mergeObject:(a,b)=>merge(structuredClone(a),b),getProperty:(o,k)=>k.split(".").reduce((v,p)=>v?.[p],o),randomID:()=>`id${++seq}`}};
const settings=new Map();
const actors=new Map([['a',{id:'a',uuid:'Actor.a',system:{health:{hp:{value:50}}},effects:[]}],['b',{id:'b',uuid:'Actor.b',system:{health:{hp:{value:50}}},effects:[]}]]);
const tokens=new Map([['ta',{actor:actors.get('a')}],['tb',{actor:actors.get('b')}],['enemy',{actor:{id:'enemy'}}]]);
globalThis.canvas={scene:{id:'scene',tokens}};
globalThis.game={system:{id:'rmu'},release:{generation:14},user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}},actors,scenes:new Map([['scene',canvas.scene]]),
  combat:{id:'combat1',started:true,round:1,combatants:[{actor:actors.get('a')},{actor:actors.get('b')}]},
  settings:{register:(id,key,config)=>settings.set(key,structuredClone(config.default)),get:(id,key)=>settings.get(key),
    set:async(id,key,value)=>{await new Promise(r=>setImmediate(r));settings.set(key,structuredClone(value));}}};
const {registerSettings,mutate,state}=await import('../scripts/store.js');
registerSettings(()=>{});settings.set('roster',['a','b']);
const {installAdapter}=await import('../scripts/adapter.js');
let endUpkeep;let upkeepPromise=Promise.resolve();
await installAdapter(async()=>({upkeepSettled:()=>upkeepPromise}));
const flush=async()=>{await new Promise(r=>setImmediate(r));await mutate(()=>false);};
function message(id,result,applied=false){return{id,speaker:{scene:'scene',token:'ta',actor:'a'},flags:{rmu:{result,applied}},getFlag(scope,key){return this.flags[scope]?.[key];}};}
function apply(message){const changes={flags:{rmu:{applied:true,result:null}}};call('preUpdateChatMessage',message,changes,{});message.flags=merge(message.flags,expand(changes).flags);call('updateChatMessage',message,changes,{});}

test('RMU lifecycle, multiplayer duplicate protection, conditions and bleeding separation',async()=>{
  const hit=message('hit',{attackerTokenId:'ta',defenderTokenId:'tb',effects:[{effect:'Hits',value:17},{effect:'Attack Hits',value:10},{effect:'Bleed',value:3}],criticalResult:{criticals:[{severityShortCode:'C'}]}});
  call('createChatMessage',hit);await flush();assert.equal(Object.keys(state().events).length,0,'unapplied roll is not damage');
  apply(hit);await flush();call('updateChatMessage',hit,{flags:{rmu:{applied:true}}},{});await flush();
  let stats=totals(state().events,['a','b']);assert.equal(stats.a.strikes,1);assert.equal(stats.a.hitsDealt,17);assert.equal(stats.b.hitsTaken,17);assert.equal(stats.a.criticalC,1);
  assert.equal(stats.b.receivedC,1);
  assert.equal(hit.flags.rmu.result,null,'source result cleared, receipt survived');
  const miss=message('miss',{attackerTokenId:'ta',defenderTokenId:'tb',effects:[]},true);call('createChatMessage',miss);call('createChatMessage',miss);
  const fumble=message('fumble',{fumbleRollTableUUID:'table'});call('createChatMessage',fumble);await flush();
  stats=totals(state().events,['a']);assert.equal(stats.a.misses,1);assert.equal(stats.a.fumbles,1);
  const effect={uuid:'Actor.b.ActiveEffect.bleed',parent:{...actors.get('b'),documentName:'Actor'},toObject:()=>({system:{type:'injury',effect:'Bleed',value:3}})};
  call('createActiveEffect',effect);call('createActiveEffect',effect);await flush();
  assert.equal(totals(state().events,['b']).b.bleedSuffered,3);
  const b=actors.get('b');b.effects=[{name:'Bleed',flags:{rmu:{}},system:{value:3,paused:false}}];
  upkeepPromise=new Promise(resolve=>endUpkeep=resolve);call('combatRound',game.combat,{round:2});
  const options={};call('preUpdateActor',b,{'system.health.hp.value':47},options);call('updateActor',b,{'system.health.hp.value':47},options);
  endUpkeep();await flush();
  stats=totals(state().events,['a','b']);assert.equal(stats.b.bleedDamage,3);assert.equal(stats.b.hitsTaken,17);assert.equal(stats.a.hitsDealt,17);
  const manual={};call('preUpdateActor',b,{'system.health.hp.value':40},manual);call('updateActor',b,{},manual);await flush();
  assert.equal(totals(state().events,['b']).b.hitsTaken,17,'manual HP edits do not pollute direct-hit damage');
  const enemyHit=message('enemy-hit',{attackerTokenId:'enemy',defenderTokenId:'tb',effects:[{effect:'Hits',value:5}]});apply(enemyHit);await flush();
  assert.equal(totals(state().events,['b']).b.hitsTaken,22);assert.ok(!JSON.stringify(state()).includes('"enemy"'),'enemy identity not published');
  game.user={id:'player',isGM:false};call('createChatMessage',message('player-duplicate',{fumbleRollTableUUID:'table'}));game.user={id:'gm',isGM:true};await flush();
  assert.equal(totals(state().events,['a']).a.fumbles,1);
  const self=message('self',{effects:[{effect:'Hits',value:4}]});apply(self);await flush();
  stats=totals(state().events,['a']);assert.equal(stats.a.hitsTaken,4);assert.equal(stats.a.fumbles,1,'fumble consequences do not add another fumble');
  assert.deepEqual(errors,[]);
});

test('conditions dealt use final effects, remain deduplicated, and follow the battle',async()=>{
  game.combat={...game.combat,id:'battle-two',name:'Bridge battle'};
  const result={attackerTokenId:'ta',defenderTokenId:'enemy',effects:[{effect:'Stun',rounds:[3,1,0]},{effect:'Prone'}]};
  const hit=message('conditions-hit',result);
  call('createChatMessage',hit);await flush();
  assert.equal(totals(state().events,['a'],'battle-two').a.dealtProne,0);
  // RMU removes a negated critical's effects before completing the chat update.
  result.effects=[{effect:'Stun',rounds:[0,1,0]},{effect:'Staggered',value:3}];
  apply(hit);await flush();call('updateChatMessage',hit,{flags:{rmu:{applied:true}}},{});await flush();
  const stats=totals(state().events,['a'],'battle-two').a;
  assert.equal(stats.dealtStun25,0);assert.equal(stats.dealtStun50,1);assert.equal(stats.dealtProne,0);assert.equal(stats.dealtStaggered,1);
  assert.equal(stats.stun50,0,'dealt conditions do not increment suffered counters');
  assert.equal(state().events['attack:conditions-hit'].battleName,'Bridge battle');
  assert.equal(totals(state().events,['a'],'combat1').a.dealtStun50,0);
  const rr=message('conditions-rr',{attackerTokenId:'ta',effects:[{effect:'Stun',rounds:[0,0,2]}]});
  rr.speaker.token='tb';rr.speaker.actor='b';apply(rr);await flush();
  assert.equal(totals(state().events,['a']).a.dealtStun75,1,'caster gets credit for RR-linked conditions');
  assert.equal(totals(state().events,['b']).b.dealtStun75,0);
  const self=message('fumble-condition',{effects:[{effect:'Prone'}]});apply(self);await flush();
  assert.equal(totals(state().events,['a']).a.dealtProne,0,'source-free fumble consequence is not credited');
});

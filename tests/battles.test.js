import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureBattle, findCombat, installBattles, assignHistoryToBattle} from '../scripts/battles.js';
import {totals} from '../scripts/model.js';
import {context, registerSettings, state, mutate} from '../scripts/store.js';

test('empty combats become selectable records and exact observed times are preserved',()=>{
  const data={events:{}};
  ensureBattle(data,{id:'one',name:'Bridge',started:false},100);
  assert.equal(data.battles.one.status,'pending');assert.equal(data.battles.one.startedAt,null);
  ensureBattle(data,{id:'one',name:'Bridge',started:true},200,true);
  ensureBattle(data,{id:'one',name:'Bridge',started:true},300);
  assert.equal(data.battles.one.startedAt,200);assert.equal(data.battles.one.trackedAt,100);
});
test('mid-battle adoption never invents an earlier start time',()=>{
  const data={events:{}};ensureBattle(data,{id:'late',name:'Late',started:true},500);
  assert.equal(data.battles.late.startedAt,null);assert.equal(data.battles.late.startedBeforeTracking,true);
  assert.equal(data.battles.late.trackedAt,500);
});
test('explicit history assignment uses tracking start and preserves campaign totals and original dates',()=>{
  const data={events:{a:{id:'a',at:100,encounter:'outside',actors:{pc:{hitsDealt:17}}},b:{id:'b',at:200,encounter:'old',actors:{pc:{strikes:2}}}}};
  const before=totals(data.events,['pc']);
  assignHistoryToBattle(data,{id:'current',name:'Current battle',started:true},300);
  assert.deepEqual(totals(data.events,['pc']),before);
  assert.deepEqual(totals(data.events,['pc'],'current'),before);
  assert.equal(data.battles.current.startedAt,100);assert.equal(data.battles.current.startAssumed,true);
  assert.equal(data.events.b.at,200);assert.equal(data.reassignmentBackups[0].events.a.encounter,'outside');
});
test('combat matching handles a GM viewing another encounter and refuses ambiguous matches',()=>{
  const a={id:'a',started:true,scene:{id:'sceneA'},combatants:[{actorId:'alice'}]};
  const b={id:'b',started:true,scene:{id:'sceneB'},combatants:[{actorId:'bob'}]};
  globalThis.game={combats:{contents:[a,b]},combat:b};
  assert.equal(findCombat({sceneId:'sceneA',actorIds:['alice']}).id,'a');
  assert.equal(context(findCombat({sceneId:'sceneA',actorIds:['alice']})).encounter,'a');
  assert.equal(findCombat({sceneId:'absent',actorIds:['alice']}),null);
  game.combat=null;game.combats.contents=[a,{...a,id:'duplicate'}];
  assert.equal(findCombat({sceneId:'sceneA',actorIds:['alice']}),null);
});
test('ready adopts running combats; create/start/end hooks retain zero-stat battles and dates',async()=>{
  const callbacks=new Map();globalThis.Hooks={on:(key,fn)=>{callbacks.set(key,fn);}};
  globalThis.foundry={utils:{deepClone:structuredClone,expandObject:x=>x}};
  globalThis.ui={notifications:{error:()=>{}}};
  const settings=new Map();const running={id:'running',name:'Running',started:true,round:4};
  globalThis.game={user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}},combats:{contents:[running]},combat:null,
    settings:{register:(id,k,c)=>settings.set(k,structuredClone(c.default)),get:(id,k)=>settings.get(k),set:async(id,k,v)=>settings.set(k,v)}};
  registerSettings(()=>{});await installBattles();
  assert.ok(state().battles.running);assert.equal(state().battles.running.startedBeforeTracking,true);
  const combat={id:'new',name:'New battle',started:false,round:0};
  callbacks.get('createCombat')(combat);await mutate(()=>false);
  assert.equal(state().battles.new.status,'pending');assert.deepEqual(state().events,{});
  const options={};callbacks.get('preUpdateCombat')(combat,{round:1},options);
  combat.started=true;combat.round=1;callbacks.get('updateCombat')(combat,{round:1},options);await mutate(()=>false);
  const start=state().battles.new.startedAt;assert.ok(start>0);
  callbacks.get('deleteCombat')(combat);await mutate(()=>false);
  assert.equal(state().battles.new.status,'ended');assert.ok(state().battles.new.endedAt>=start);
  assert.equal(state().battles.new.startedAt,start);assert.equal(state().schema,2);
});

import {describe,it,expect} from 'vitest';
import {fight,type CardNumbers} from '../../src/ai/cardMath.js';
import {CARD_NUMBERS,ITEM_NUMBERS} from '../../src/ai/cardMathData.js';
// Independent cap oracle for the actual 1048/1047 ops, with only basic attacks and no abilities/AP: not a Lux-game estimate.
const num=(baseValue:number)=>({baseValue});
const bin={rec:{__type:'CharacterRecord',spells:[],attackRangeModifiable:num(150),baseHPModifiable:num(1000),hpPerLevelModifiable:num(0),baseDamageModifiable:num(100),damagePerLevelModifiable:num(0),baseArmorModifiable:num(30),armorPerLevelModifiable:num(0),baseMR:num(30),mrPerLevel:num(0),baseMoveSpeedModifiable:num(340),attackSpeedModifiable:num(.65),attackSpeedRatioModifiable:num(.65),attackSpeedPerLevelModifiable:num(0)}};
const a=CARD_NUMBERS.find(c=>c.id===1048)!,b=CARD_NUMBERS.find(c=>c.id===1047)!;
const off={...a,ops:[]};
const itemOps=Object.fromEntries(ITEM_NUMBERS.map(({id,ops})=>[id,ops]));
const run=(cards:CardNumbers[])=>fight({bin,shop:{},kit:{damage:'physical',attacks:true},items:[],itemOps,cards,level:9});
const crit=(value:number):CardNumbers=>({id:90001,name:'fixed crit fixture',status:'computed',ops:[{op:'add',stat:'crit',value}]});
describe('partner crit cap boundary oracle',()=>{
 it('below the cap the two additive crit increments have zero basic-attack interaction',()=>{
  const c=run([a]),cb=run([a,b]),r=run([off]),rb=run([off,b]);
  expect([c.stats.crit,cb.stats.crit,r.stats.crit,rb.stats.crit]).toEqual([.25,.75,0,.5]);
  expect(cb.damage-c.damage-rb.damage+r.damage).toBeCloseTo(0,8);
 });
 it('at the cap another crit card adds no attacks damage in C, while it still helps R; the interaction becomes negative',()=>{
  const rest=crit(.75),c=run([rest,a]),cb=run([rest,a,b]),r=run([rest,off]),rb=run([rest,off,b]);
  expect([c.stats.crit,cb.stats.crit,r.stats.crit,rb.stats.crit]).toEqual([1,1,.75,1]);
  expect(cb.damage).toBeCloseTo(c.damage,9);expect(rb.damage).toBeGreaterThan(r.damage);
  const base=run([]);expect(cb.damage-c.damage-rb.damage+r.damage).toBeCloseTo(-base.damage*.25*.75,8);
 });
});

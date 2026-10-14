import {describe,expect,it} from 'vitest';
import {selectExcerpt} from './history-excerpts';

const sizes=(n:number,each=10)=>Array.from({length:n},()=>each);
const base={windowTurns:2,contextWindows:1};
const total=(s:number[],r:{start:number;end:number})=>s.slice(r.start,r.end).reduce((a,b)=>a+b,0);

describe('selectExcerpt',()=>{
 it('returns only the best window when no context is allowed',()=>{
  expect(selectExcerpt({...base,sizes:sizes(20),bestUnit:3,maxChars:1000,contextWindows:0})).toEqual({start:6,end:8});
 });
 it('adds one neighbouring window on each side',()=>{
  expect(selectExcerpt({...base,sizes:sizes(20),bestUnit:3,maxChars:1000})).toEqual({start:4,end:10});
 });
 it('adds up to contextWindows windows on each side',()=>{
  expect(selectExcerpt({...base,sizes:sizes(40),bestUnit:5,maxChars:10000,contextWindows:2})).toEqual({start:6,end:16});
 });
 it('only grows the open side at the start and the end of the document',()=>{
  expect(selectExcerpt({...base,sizes:sizes(20),bestUnit:0,maxChars:1000,contextWindows:2})).toEqual({start:0,end:6});
  expect(selectExcerpt({...base,sizes:sizes(20),bestUnit:9,maxChars:1000,contextWindows:2})).toEqual({start:14,end:20});
 });
 it('clips the last window of an odd-length document',()=>{
  expect(selectExcerpt({...base,sizes:sizes(7),bestUnit:3,maxChars:1000,contextWindows:0})).toEqual({start:6,end:7});
 });
 it('stops growing as soon as the budget would be exceeded',()=>{
  // 三个窗口共 60：预算 60 刚好放下；59 时先放下前一个窗口，后一个放不下。
  expect(selectExcerpt({...base,sizes:sizes(20),bestUnit:3,maxChars:60})).toEqual({start:4,end:10});
  expect(selectExcerpt({...base,sizes:sizes(20),bestUnit:3,maxChars:59})).toEqual({start:4,end:8});
 });
 it('keeps growing the other side when one neighbour does not fit',()=>{
  const s=sizes(20);s[5]=500; // 最佳窗口 [6,8) 的前一个窗口 [4,6) 里有一条很大的消息
  expect(selectExcerpt({...base,sizes:s,bestUnit:3,maxChars:100})).toEqual({start:6,end:10});
 });
 it('returns null when the best window alone is over budget',()=>{
  const s=sizes(20);s[6]=7000;
  expect(selectExcerpt({...base,sizes:s,bestUnit:3,maxChars:6000})).toBeNull();
 });
 it.each([
  ['unit below zero',{bestUnit:-1}],
  ['unit past the end',{bestUnit:10}],
  ['fractional unit',{bestUnit:1.5}],
  ['zero windowTurns',{windowTurns:0}],
  ['fractional windowTurns',{windowTurns:1.5}],
  ['negative contextWindows',{contextWindows:-1}],
  ['non-positive budget',{maxChars:0}],
  ['NaN budget',{maxChars:NaN}],
 ])('fails closed on %s',(_,patch)=>{
  expect(selectExcerpt({...base,sizes:sizes(20),bestUnit:3,maxChars:1000,...patch})).toBeNull();
 });
 it('fails closed on an empty or malformed size list',()=>{
  expect(selectExcerpt({...base,sizes:[],bestUnit:0,maxChars:1000})).toBeNull();
  expect(selectExcerpt({...base,sizes:[10,-1,10],bestUnit:0,maxChars:1000})).toBeNull();
  expect(selectExcerpt({...base,sizes:[10,NaN,10],bestUnit:0,maxChars:1000})).toBeNull();
 });
 it('always returns one contiguous range that contains the best window and fits the budget',()=>{
  let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
  for(let i=0;i<300;i++){
   const n=1+Math.floor(rnd()*60),turns=1+Math.floor(rnd()*4),s=Array.from({length:n},()=>1+Math.floor(rnd()*200));
   const units=Math.ceil(n/turns),bestUnit=Math.floor(rnd()*units),maxChars=50+Math.floor(rnd()*1500),contextWindows=Math.floor(rnd()*4);
   const r=selectExcerpt({sizes:s,windowTurns:turns,bestUnit,maxChars,contextWindows});
   const bestStart=bestUnit*turns,bestEnd=Math.min(n,bestStart+turns);
   if(total(s,{start:bestStart,end:bestEnd})>maxChars){expect(r).toBeNull();continue}
   expect(r).not.toBeNull();
   expect(r!.start).toBeLessThanOrEqual(bestStart);expect(r!.end).toBeGreaterThanOrEqual(bestEnd);
   expect(r!.start).toBeGreaterThanOrEqual(0);expect(r!.end).toBeLessThanOrEqual(n);
   expect(total(s,r!)).toBeLessThanOrEqual(maxChars);
   expect(r!.start%turns).toBe(0);
  }
 });
 it('is deterministic',()=>{
  const input={...base,sizes:sizes(30,13),bestUnit:7,maxChars:200};
  expect(selectExcerpt(input)).toEqual(selectExcerpt(input));
 });
});

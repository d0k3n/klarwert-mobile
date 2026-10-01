import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCSV } from "../src/csv.ts";
import { run_engine } from "../src/engine.ts";
import { analyzeResults, paginate } from "../src/results_analysis.ts";
import { computeAutomaticProjection } from "../src/pl_insights.ts";
import { makeDf } from "./helpers.ts";
const rows = (input: Array<Record<string, any>>) => makeDf(input.map(r=>({datetime:"2026-01-01",...r}))).map((r,i) => ({ ...r, date: input[i].date || r.datetime.toISOString().slice(0,10), movement_id: `movement:${i}` }));
const analyze = (r: ReturnType<typeof rows>, start="2026-01-01",end="2026-12-31") => analyzeResults(r,run_engine(r),{start,end},"revision:1");
test("fixture calendar dates match timestamps before calendar correction", () => {
 const r=parseCSV(readFileSync(new URL("./fixtures/transactions.csv",import.meta.url),"utf8"));
 assert.equal(r.length,903); assert.equal(r.filter(r=>r.date!==r.datetime.toISOString().slice(0,10)).length,0);
});
test("same product winning and losing disposals are two operations",()=>{
 const a=analyze(rows([{tx_type:"BUY",symbol:"X",shares:2,amount:-200},{tx_type:"SELL",symbol:"X",shares:1,amount:200},{tx_type:"SELL",symbol:"X",shares:1,amount:50}]));
 assert.equal(a.metrics.operations,2);assert.equal(a.metrics.win_rate,.5);assert.equal(a.metrics.net_result,50);assert.equal(a.metrics.profit_factor,2);
});
test("three FIFO lots, acquisition and disposal charges give direct net result",()=>{
 const r=rows([{tx_type:"BUY",symbol:"X",shares:1,amount:-30,fee:0.3},{tx_type:"BUY",symbol:"X",shares:1,amount:-30,fee:0.3},{tx_type:"BUY",symbol:"X",shares:1,amount:-40,fee:0.4},{tx_type:"SELL",symbol:"X",shares:3,amount:110,fee:1,tax:2}]);
 const e=run_engine(r).realization_events![0]; assert.equal(e.lots.length,3); assert.equal(e.gross_result,10);assert.equal(e.net_result,6);assert.equal(e.acquisition_charges,1);assert.equal(e.exit_charges,3);
 assert.equal(analyze(r).metrics.operations,1);
});
test("filter after whole-history FIFO, date uses statement day, curve reconciles",()=>{
 const r=rows([{datetime:"2025-12-01",tx_type:"BUY",symbol:"X",shares:2,amount:-200,fee:2},{datetime:"2026-01-01T23:30:00",date:"2026-01-02",tx_type:"SELL",symbol:"X",shares:1,amount:110,fee:1}]);
 const a=analyze(r,"2026-01-02","2026-01-04");assert.equal(a.metrics.net_result,8);assert.equal(a.daily[0].operations,1);assert.equal(a.daily[1].operations,0);assert.equal(a.daily.at(-1)!.cumulative,8);
 assert.equal(run_engine(r).daily_pl[0].date,"2026-01-02");assert.deepEqual(a.previous!.period,{start:"2025-12-30",end:"2026-01-01"});assert.equal(a.coverage.complete,false);
});
test("signed refunded charges retained and zero operations count in win-rate denominator",()=>{
 const r=rows([{tx_type:"BUY",symbol:"X",shares:2,amount:-200},{tx_type:"SELL",symbol:"X",shares:1,amount:100,fee:1,charges_signed:true},{tx_type:"SELL",symbol:"X",shares:1,amount:100}]);
 const a=analyze(r);assert.equal(a.metrics.net_result,1);assert.equal(a.metrics.zeros,1);assert.equal(a.metrics.win_rate,.5);assert.equal(a.metrics.profit_factor,null);
 assert.equal(a.daily[0].operations,2);
});
test("unknown cost and subsequent legacy cover remain excluded",()=>{
 const r=rows([{tx_type:"SELL",symbol:"X",shares:1,amount:110},{tx_type:"BUY",symbol:"X",shares:1,amount:-100}]);
 const a=analyze(r);assert.equal(a.metrics.valid_operations,0);assert.equal(a.metrics.incomplete_operations,2);assert.equal(a.metrics.win_rate,null);assert.equal(a.metrics.net_result,0);
 assert.equal(a.realizations[0].net_result,null);
});
test("extinction realizes known cost and fractional cents round before classification",()=>{
 const a=analyze(rows([{tx_type:"BUY",symbol:"X",shares:1,amount:-100,fee:1,knocked:true},{tx_type:"BUY",symbol:"Y",shares:1,amount:-100},{tx_type:"SELL",symbol:"Y",shares:1,amount:100.004}]));
 assert.equal(a.metrics.losses,1);assert.equal(a.metrics.zeros,1);assert.equal(a.metrics.net_result,-101);assert.ok(a.realizations.some(e=>e.kind==="extinction"));
});
test("all statement movements accessible, deterministic identities, search pages clamped",()=>{
 const r=rows(Array.from({length:75},(_,i)=>({tx_type:i%2?"DEPOSIT":"BUY",name:`Product ${i}`,symbol:`ISIN${i}`,shares:1,amount:-1})));
 const e=run_engine(r);assert.equal(e.transactions.length,75);assert.deepEqual(e.transactions,run_engine(r).transactions);
 const p=paginate(e.transactions,{search:"isin",page:999,page_size:10});assert.equal(p.total,75);assert.equal(p.page,8);assert.equal(p.items.length,5);
 assert.equal(paginate(e.transactions,{search:"no match",page:99}).page,1);
 assert.equal(analyze([]).metrics.average_result,null);
});
function projectionRows(year=2026,start="01-01",end="02-15") {
 return rows([{datetime:`${year}-${start}`,tx_type:"DEPOSIT",amount:1000},...Array.from({length:10},(_,i)=>[{datetime:`${year}-02-${String(i+1).padStart(2,"0")}`,tx_type:"BUY",symbol:`X${i}`,shares:1,amount:-100},{datetime:`${year}-02-${String(i+1).padStart(2,"0")}`,tx_type:"SELL",symbol:`X${i}`,shares:1,amount:i===0?100:110}]).flat(),{datetime:`${year}-${end}`,tx_type:"DEPOSIT",amount:1}]);
}
test("automatic projection infers cadence including zero days and reference ends at statement",()=>{
 const r=projectionRows(),p=computeAutomaticProjection(r,run_engine(r))!;
 assert.equal(p.as_of,"2026-02-15");assert.equal(p.historical.status,"available");assert.equal(p.historical.observation_days,46);assert.equal(p.historical.active_days,10);assert.equal(p.historical.observed_pl,90);assert.equal(p.historical.remaining_days,319);
 assert.equal(p.historical.projected_remaining_pl,624.13);
});
test("recent independent window, insufficient sample, unknown annual cost disable both scenarios",()=>{
 const r=projectionRows(2026,"01-01","05-01"),p=computeAutomaticProjection(r,run_engine(r))!;
 assert.equal(p.historical.status,"available");assert.equal(p.recent.observation_days,60);assert.equal(p.recent.status,"insufficient_sample");
 r.push(...rows([{datetime:"2026-01-02",tx_type:"SELL",symbol:"UNKNOWN",shares:1,amount:10}]));
 const q=computeAutomaticProjection(r,run_engine(r))!;assert.equal(q.historical.status,"unknown_cost");assert.equal(q.recent.status,"unknown_cost");assert.equal(q.recent.projected_pl,null);
});
test("closed years and December 31 show observed only; leap year observation correct",()=>{
 const r=projectionRows(2024,"01-01","03-01"),p=computeAutomaticProjection(r,run_engine(r))!;
 assert.equal(p.historical.observation_days,61);assert.equal(p.historical.status,"closed_year");assert.equal(p.historical.projected_remaining_pl,0);assert.equal(p.historical.projected_pl,90);
 const q=projectionRows(2026,"01-01","12-31"),a=computeAutomaticProjection(q,run_engine(q))!;assert.equal(a.year_closed,true);assert.equal(a.historical.projected_pl,90);
 assert.equal(computeAutomaticProjection([],run_engine([])),null);
});

test("known complete FIFO reconciles across event, daily, period and legacy accounting",()=>{
 const r=rows([{tx_type:"BUY",symbol:"X",shares:3,amount:-100,fee:1},{datetime:"2026-01-02",tx_type:"SELL",symbol:"X",shares:1,amount:40,fee:1},{datetime:"2026-01-03",tx_type:"SELL",symbol:"X",shares:2,amount:80,fee:1}]);
 const e=run_engine(r),a=analyzeResults(r,e,{start:"2026-01-01",end:"2026-01-03"},"r");
 assert.equal(a.metrics.net_result,17);assert.equal(e.summary.total_realized_pl,17);assert.equal(a.daily.reduce((s,d)=>s+d.net_result,0),17);assert.equal(a.daily.at(-1)!.cumulative,17);
 assert.ok(Math.abs(e.realization_events!.reduce((s,e)=>s+e.net_result!,0)-17)<1e-9);
});
test("unknown disposal preserves full documented revenue and known matched subtotal",()=>{
 const r=rows([{tx_type:"BUY",symbol:"X",shares:1,amount:-100},{tx_type:"SELL",symbol:"X",shares:2,amount:220,fee:2}]);
 const e=run_engine(r).realization_events![0];assert.equal(e.gross_proceeds,220);assert.equal(e.gross_cost,100);assert.equal(e.net_result,null);assert.equal(e.known_net_result,8);assert.equal(e.unmatched_shares,1);
});
test("redemption after documented extinction recognizes subsequent settlement once",()=>{
 const r=rows([{tx_type:"BUY",symbol:"X",shares:1,amount:-100,knocked:true},{tx_type:"TILG",symbol:"X",amount:5,fee:1}]);
 const e=run_engine(r),a=analyze(r);assert.equal(e.summary.total_realized_pl,-96);assert.equal(a.metrics.net_result,-96);assert.equal(a.metrics.incomplete_operations,0);
 const u=analyze(rows([{tx_type:"TILG",symbol:"X",amount:5}]));assert.equal(u.metrics.incomplete_operations,1);
});

test("charges-only redemption without documented acquisition is incomplete",()=>{
 const a=analyze(rows([{tx_type:"TILG",symbol:"X",amount:0,fee:1}]));assert.equal(a.metrics.incomplete_operations,1);assert.equal(a.metrics.valid_operations,0);assert.equal(a.realizations[0].known_net_result,-1);
});
test("subcent FIFO presentation reconciles operations and days; raw legacy accounting remains auditable",()=>{
 const r=rows([{tx_type:"BUY",symbol:"X",shares:3,amount:-100},...Array.from({length:3},(_,i)=>({datetime:`2026-01-0${i+2}`,tx_type:"SELL",symbol:"X",shares:1,amount:40}))]);
 const e=run_engine(r),a=analyze(r,"2026-01-01","2026-01-04");
 assert.equal(e.summary.total_realized_pl,20);assert.equal(a.metrics.net_result,20.01);assert.match(a.coverage.warning,/rounding.*0.01/);
 assert.equal(Math.round(a.daily.reduce((s,d)=>s+d.net_result,0)*100)/100,20.01);assert.equal(a.daily.at(-1)!.cumulative,20.01);
 assert.ok(Math.abs(e.realization_events!.reduce((s,e)=>s+e.net_result!,0)-20)<1e-9);
});

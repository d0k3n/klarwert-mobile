import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('web/dashboard.js','utf8').split('// A common immutable analysis snapshot drives every results consultation surface.')[1].split("if(resultsEl('period'))")[0];
function harness() {
  const elements = new Map<string, any>();
  const element = (): any => ({value:'',textContent:'',disabled:false,style:{values:{} as Record<string,string>,setProperty(key: string,value: string){this.values[key]=value;}},attributes:{} as Record<string,string>,children:[],replaceChildren(){this.children=[];},append(...children: any[]){this.children.push(...children);},setAttribute(key: string,value: string){this.attributes[key]=value;},addEventListener(){}});
  const get = (id: string) => { if(!elements.has(id))elements.set(id,element()); return elements.get(id); };
  const context = vm.createContext({document:{getElementById:get,createElement:element},Intl,Date,URLSearchParams,Map,BASE:'',setPdfExportAvailability(){},loadJSON:async()=>({}),Chart:undefined});
  vm.runInContext(source,context);
  return {context,get,run:(code: string)=>vm.runInContext(code,context)};
}
test('common inclusive custom period validates dates and snapshots revision',()=>{
 const h=harness();h.get('results-period').value='custom';h.get('results-start').value='2026-01-01';h.get('results-end').value='2026-01-31';
 assert.equal(h.run('resultsPeriodQuery().toString()'),'start=2026-01-01&end=2026-01-31');
 h.get('results-end').value='2025-12-31';assert.throws(()=>h.run('resultsPeriodQuery()'),/valid inclusive/);
 h.run("resultsState.analysis={period:{start:'2026-01-01',end:'2026-01-31'},revision:'r1'}");
 assert.equal(h.run('resultsSnapshotQuery().toString()'),'start=2026-01-01&end=2026-01-31&revision=r1');
});
test('late history responses cannot replace a newer query or revision',async()=>{
 const h=harness();const requests: Array<(value: any) => void> = [];
 h.context.loadJSON=()=>new Promise(resolve=>requests.push(resolve));
 h.run("resultsState.analysis={period:{start:'2026-01-01',end:'2026-01-31'},revision:'r1'}");h.get('results-history-kind').value='realizations';
 const first=h.run('loadResultsHistory()');const second=h.run('loadResultsHistory()');
 requests[1]({revision:'r1',page:1,pages:1,total:1,items:[{date:'2026-01-02',name:'New query',net_result:4}]});await second;
 requests[0]({revision:'r1',page:1,pages:1,total:99,items:[]});await first;
 assert.equal(h.get('results-history-count').textContent,'1 realizations');
 const third=h.run('loadResultsHistory()');requests[2]({revision:'old',page:1,pages:1,total:50,items:[]});await third;
 assert.notEqual(h.get('results-history-count').textContent,'50 realizations');
});
test('calendar distinguishes no realization, zero and incomplete while retaining seven-column dates',()=>{
 const h=harness();h.run("resultsState.month='2026-02';resultsState.analysis={period:{start:'2026-02-01',end:'2026-02-28'},daily:[{date:'2026-02-02',operations:1,net_result:0,incomplete:0},{date:'2026-02-03',operations:1,net_result:0,incomplete:1}]};renderResultsCalendar()");
 const buttons=h.get('results-calendar').children.filter((c: any)=>c.type==='button');
 const text=(button: any)=>button.children.map((c: any)=>c.textContent).join(' ');
 assert.equal(buttons.length,28);assert.match(text(buttons[0]),/—/);assert.match(text(buttons[1]),/0\.00/);assert.match(text(buttons[2]),/\?/);
});


test('heatmap preserves signs, proportional intensity, full amounts and accessible selection',()=>{
 const h=harness();h.run("resultsState.month='2026-02';resultsState.day='2026-02-03';resultsState.analysis={period:{start:'2026-02-01',end:'2026-02-28'},daily:[{date:'2026-02-02',operations:1,net_result:25,incomplete:0},{date:'2026-02-03',operations:2,net_result:-100,incomplete:1},{date:'2026-02-04',operations:1,net_result:100,incomplete:0}]};renderResultsCalendar()");
 const buttons=h.get('results-calendar').children.filter((c: any)=>c.type==='button');
 assert.match(buttons[1].className,/heat-positive/);assert.match(buttons[2].className,/heat-negative.*cost-incomplete.*is-selected/);
 assert.equal(buttons[2].attributes['aria-pressed'],'true');assert.match(buttons[2].attributes['aria-label'],/-€100\.00, 1 incomplete/);
 assert.equal(buttons[2].children[1].textContent,'-100.00');
 const low=Number(buttons[1].style.values['--heat']),high=Number(buttons[2].style.values['--heat']);
 assert.ok(high>low);assert.equal(high,Number(buttons[3].style.values['--heat']));
});

test('monthly and weekly totals partition a year without double counting boundary days',()=>{
 const h=harness();h.run("resultsState.analysis={period:{start:'2025-12-29',end:'2027-01-03'},daily:[{date:'2025-12-31',net_result:999,operations:1},{date:'2026-01-01',net_result:100,operations:1},{date:'2026-02-01',net_result:-30,operations:1},{date:'2026-12-31',net_result:5,operations:1},{date:'2027-01-01',net_result:999,operations:1}]}");
 assert.equal(h.run("resultsYearPeriods(2026,'month').length"),12);
 for(const view of ['month','week'])assert.equal(h.run(`resultsYearPeriods(2026,'${view}').reduce((s,p)=>s+p.total,0)`),75);
 assert.equal(h.run("resultsYearPeriods(2026,'week')[0].start"),'2026-01-01');
 assert.equal(h.run("resultsYearPeriods(2026,'week').at(-1).end"),'2026-12-31');
 assert.equal(h.run("resultsYearPeriods(2024,'month')[1].end"),'2024-02-29');
});

test('partial coverage and incomplete costs remain explicit alongside visible period totals',()=>{
 const h=harness();h.run("resultsState.view='month';resultsState.year=2026;resultsState.month='2026-02';resultsState.analysis={period:{start:'2026-02-02',end:'2026-02-04'},daily:[{date:'2026-02-02',net_result:0,operations:1,incomplete:0},{date:'2026-02-03',net_result:-10,operations:2,incomplete:1}]};renderResultsExplorer()");
 assert.match(h.get('results-period-total').textContent,/Year total · selected coverage: -€10.00 · \? incomplete/);
 const cells=h.get('results-periods').children;
 assert.equal(cells.length,12);assert.equal(cells[0].disabled,true);
 assert.equal(cells[1].children[1].textContent,'-€10.00');
 assert.match(cells[1].children[2].textContent,/partial.*incomplete/);
 assert.match(cells[1].className,/heat-negative.*cost-incomplete/);
});

test('week detail retains all seven daily amounts when crossing a month',()=>{
 const h=harness();h.run("resultsState.month='2026-01';resultsState.week={start:'2026-01-26',end:'2026-02-01'};resultsState.analysis={period:{start:'2026-01-01',end:'2026-02-28'},daily:[{date:'2026-02-01',net_result:42,operations:1,incomplete:0}]};renderResultsCalendar()");
 const buttons=h.get('results-calendar').children.filter((c: any)=>c.type==='button');
 assert.equal(buttons.length,7);assert.equal(buttons[6].children[0].textContent,'1');assert.equal(buttons[6].children[1].textContent,'42.00');
 assert.equal(h.get('results-month').textContent,'2026-01-26 – 2026-02-01');
});

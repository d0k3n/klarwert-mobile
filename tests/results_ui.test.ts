import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('web/dashboard.js','utf8').split('// A common immutable analysis snapshot drives every results consultation surface.')[1].split("if(resultsEl('period'))")[0];
function harness() {
  const elements = new Map<string, any>();
  const element = (): any => ({value:'',textContent:'',disabled:false,children:[],replaceChildren(){this.children=[];},append(...children: any[]){this.children.push(...children);},setAttribute(){},addEventListener(){}});
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
 const buttons=h.get('results-calendar').children.filter((c: any)=>c.textContent);
 assert.equal(buttons.length,28);assert.match(buttons[0].textContent,/—/);assert.match(buttons[1].textContent,/0\.00/);assert.match(buttons[2].textContent,/\?/);
});



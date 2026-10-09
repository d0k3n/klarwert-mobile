import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { parseCSV } from '../src/csv.ts';
import { run_engine, auto_detect_knocked } from '../src/engine.ts';
import { analyzeResults } from '../src/results_analysis.ts';
import type { ResultsAnalysis } from '../src/types.ts';
Object.defineProperty(globalThis,'window',{configurable:true,value:{atob:globalThis.atob,btoa:globalThis.btoa}});
const {exportDashboardPdf}=await import('../src/report.ts');
test('real PDF export freezes revision/period and reproduces results without dashboard DOM',async()=>{
 const rows=parseCSV(readFileSync('tests/fixtures/transactions.csv','utf8'));
 const auto=auto_detect_knocked(rows);rows.forEach(row=>row.knocked=row.tx_type==='BUY'&&auto.has(row.transaction_id));
 const snapshot=analyzeResults(rows,run_engine(rows),{start:'2026-08-01',end:'2026-08-14'},'pdf-revision-7');
 let bytes:Buffer|undefined;
 const output=await exportDashboardPdf({analysis:snapshot,now:new Date('2026-10-01T12:00:00Z'),shareBase64:async(filename,base64)=>{
  assert.equal(filename,'klarwert-results-2026-08-01-2026-08-14.pdf');
  snapshot.period.start='2000-01-01';snapshot.revision='changed';snapshot.metrics.net_result=-999;
  bytes=Buffer.from(base64,'base64');
 }});
 assert.ok(bytes);assert.equal(output.shared,true);assert.ok(output.pages>=1);
 assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 const content=bytes.toString('latin1');assert.ok(content.includes('/Type /Page'));
 const streams=[...content.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match=>{
  try{return inflateSync(Buffer.from(match[1],'latin1')).toString('latin1');}catch{return match[1];}
 }).join('\n');
 assert.ok(streams.includes('pdf-revision-7'));assert.ok(streams.includes('375.36'));
 assert.ok(streams.includes('01/08/2026'));assert.ok(!streams.includes('01/01/2000'));
 mkdirSync('tmp/pdfs',{recursive:true});writeFileSync('tmp/pdfs/results-qa.pdf',bytes);
 assert.equal(output.pages,2);
});

function pdfText(bytes: Buffer) {
 return [...bytes.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match=>{
  try{return inflateSync(Buffer.from(match[1],'latin1')).toString('latin1');}catch{return match[1];}
 }).join('\n');
}
async function capture(analysis: ResultsAnalysis, includeRealizations=false, name='') {
 let bytes!: Buffer;
 const result=await exportDashboardPdf({analysis,includeRealizations,now:new Date('2026-10-01T12:00:00Z'),shareBase64:async(_filename,base64)=>{bytes=Buffer.from(base64,'base64');}});
 if(name){mkdirSync('tmp/pdfs',{recursive:true});writeFileSync(`tmp/pdfs/${name}.pdf`,bytes);}
 return {result,text:pdfText(bytes)};
}
function synthetic(events: number, incomplete=false, longPeriod=false) {
 const rows=parseCSV(readFileSync('tests/fixtures/transactions.csv','utf8'));
 const template=run_engine(rows).realization_events![0];
 const realizations=Array.from({length:events},(_,i)=>({...template,
  id:`operation-${i}`,date:i%2 ? '2026-08-14':'2026-08-03',datetime:`2026-08-${i%2?'14':'03'}T12:00:00`,
  isin:`TEST${i}`,name:`Instrument ${i}`,net_result:incomplete && i===0?null:(i%2?-20:100.005),
  cost_quality:incomplete && i===0?'unknown' as const:'known' as const,
  acquisition_charges:-1,exit_charges:2,
 }));
 return analyzeResults([], {...run_engine([]),realization_events:realizations}, {start:longPeriod?'2025-01-01':'2026-08-01',end:'2026-08-14'},'synthetic-revision');
}
test('empty PDF has explicit unavailable statistics and no invented observations',async()=>{
 const {result,text}=await capture(synthetic(0),false,'results-empty');
 assert.equal(result.pages,2);assert.ok(text.includes('No operations with known costs'));
 assert.ok(text.includes('N/A'));assert.ok(!text.includes('Best active day'));
});
test('incomplete costs stay out of attribution and stats but appear in the appendix',async()=>{
 const analysis=synthetic(3,true);
 assert.equal(analysis.metrics.net_result,80.01);
 const summary=await capture(analysis,false,'results-incomplete');
 assert.ok(summary.text.includes('+80.01 EUR'));
 assert.ok(summary.text.includes('1 of 3 operations'));
 assert.ok(!summary.text.includes('Instrument 0'));
 assert.ok(summary.text.includes('-2.00 EUR')); // signed acquisition refunds, known operations only
 const appendix=await capture(analysis,true,'results-incomplete-appendix');
 assert.ok(appendix.text.includes('Instrument 0'));assert.ok(appendix.text.includes('N/A'));
 assert.equal(appendix.result.pages,summary.result.pages+1);
 assert.ok(!summary.text.includes('Appendix - all period realizations'));
});
test('long periods aggregate monthly and appendices paginate without losing operations',async()=>{
 const analysis=synthetic(80,false,true);
 analysis.realizations[0].name+=' '+ 'long descriptive product name '.repeat(7);
 const {result,text}=await capture(analysis,true,'results-long-appendix');
 assert.ok(text.includes('Monthly detail'));assert.ok(result.pages>3);
 for(let i=0;i<80;i++) assert.ok(text.includes(`Instrument ${i}`),`missing operation ${i}`);
 assert.equal((text.match(/Klarwert realized results/g)||[]).length,result.pages);
 assert.ok((text.match(/Gross proceeds/g)||[]).length>1,'appendix column headers repeat');
 assert.ok(text.includes('Page 1 of'));
});
test('a description longer than a page is preserved across table continuations',async()=>{
 const analysis=synthetic(1);
 analysis.realizations[0].name='Instrument 0 '+ 'extended product description '.repeat(110)+' END-OF-DESCRIPTION';
 const {result,text}=await capture(analysis,true,'results-long-description');
 assert.ok(result.pages>3);assert.ok(text.includes('END-OF-DESCRIPTION'));
});

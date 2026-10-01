import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { parseCSV } from '../src/csv.ts';
import { run_engine, auto_detect_knocked } from '../src/engine.ts';
import { analyzeResults } from '../src/results_analysis.ts';
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
 assert.ok(streams.includes('2026-08-01'));assert.ok(!streams.includes('2000-01-01'));
 mkdirSync('tmp/pdfs',{recursive:true});writeFileSync('tmp/pdfs/results-qa.pdf',bytes);
});

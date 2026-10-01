import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisCSV, resolveAnalysisPeriod } from '../src/analysis_export.ts';
import { analyzeResults } from '../src/results_analysis.ts';
import { run_engine } from '../src/engine.ts';
import { parseCSV, parseCSVText } from '../src/csv.ts';
const text = `datetime,date,category,type,name,symbol,shares,price,amount,fee,tax,currency,transaction_id
2025-01-01T00:00:00Z,2025-01-01,TRADING,BUY,Asset,ISIN,3,33.333333333333336,-100,0,0,EUR,b
2025-02-01T00:00:00Z,2025-02-01,TRADING,SELL,Asset,ISIN,1,40,40,0,0,EUR,s1
2025-02-02T00:00:00Z,2025-02-02,TRADING,SELL,Asset,ISIN,1,40,40,0,0,EUR,s2
2025-02-03T00:00:00Z,2025-02-03,TRADING,SELL,Asset,ISIN,1,40,40,0,0,EUR,s3`;
test('analytical CSV rounded operation sum reconciles cards/daily/curve and preserves precise cost components',()=>{
 const rows=parseCSV(text),result=run_engine(rows),analysis=analyzeResults(rows,result,{start:'2025-02-01',end:'2025-02-03'},'7');
 const records=parseCSVText(analysisCSV(analysis)),header=records.shift()!;
 const value=(record:string[],key:string)=>record[header.indexOf(key)];
 assert.equal(Number(records.reduce((sum,r)=>sum+Number(value(r,'net_result')),0).toFixed(2)),analysis.metrics.net_result);
 assert.equal(analysis.daily.at(-1)!.cumulative,analysis.metrics.net_result);
 assert.equal(analysis.metrics.net_result,20.01);
 assert.equal(value(records[0],'revision'),'7');assert.equal(value(records[0],'period_start'),'2025-02-01');
 assert.ok(Number(value(records[0],'gross_cost'))>33.33);
 assert.match(analysis.coverage.warning,/round/i);
});
test('analytical CSV escapes quoted text and spreadsheet formulas without converting signed numeric results',()=>{
 const rows=parseCSV(text),analysis=analyzeResults(rows,run_engine(rows),{start:'2025-02-01',end:'2025-02-03'},'9');
 analysis.realizations[0].name='=SUM(1,2) "name"';analysis.realizations[0].net_result=-12;
 const records=parseCSVText(analysisCSV(analysis)),header=records.shift()!;
 assert.equal(records[0][header.indexOf('name')],'\'=SUM(1,2) "name"');
 assert.equal(records[0][header.indexOf('net_result')],'-12');
});
test('period resolution validates real inclusive dates and defaults to imported dates',()=>{
 const rows=parseCSV(text);
 assert.deepEqual(resolveAnalysisPeriod(new URLSearchParams(),rows),{start:'2025-01-01',end:'2025-02-03'});
 for(const query of ['start=2025-02-30','start=2026-01-01&end=2025-01-01','start=invalid','start=1900-01-01&end=2025-01-01'])assert.throws(()=>resolveAnalysisPeriod(new URLSearchParams(query),rows));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDay,moveDay,calendarDays,rangePercent} from '../../extensions/chrome-kb/controls.mjs';
test('date input rejects rollover dates, ambiguous formats and year zero',()=>{
  for(const value of ['2026-02-29','2026-04-31','2026-13-01','2026-1-1','0000-01-01','12/31/2026','',null])assert.equal(parseDay(value),null);
  assert.equal(parseDay('2024-02-29').getUTCDate(),29);assert.equal(parseDay('0001-01-01').getUTCFullYear(),1);
});
test('calendar grid starts on Monday, contains 42 dates and keeps leap days',()=>{
  const cells=calendarDays('2024-02-29');assert.equal(cells.length,42);assert.equal(parseDay(cells[0].value).getUTCDay(),1);assert.equal(cells.filter(c=>c.inMonth).length,29);assert.equal(cells.find(c=>c.value==='2024-02-29').day,29);assert.equal(new Set(cells.map(c=>c.value)).size,42);
});
test('calendar arrows cross month/year boundaries while page navigation clamps end of month',()=>{
  assert.equal(moveDay('2026-12-31',1),'2027-01-01');assert.equal(moveDay('2026-01-01',-1),'2025-12-31');assert.equal(moveDay('2024-01-31',0,1),'2024-02-29');assert.equal(moveDay('2026-03-31',0,-1),'2026-02-28');assert.equal(moveDay('2024-02-29',0,12),'2025-02-28');
});
test('calendar cannot navigate beyond the supported year range',()=>{
  assert.equal(moveDay('9999-12-31',1),null);assert.equal(moveDay('0001-01-01',-1),null);assert.equal(moveDay('9999-12-10',0,1),null);assert.equal(moveDay('bad',1),null);
});
test('range paint respects custom limits and clamps out-of-range values',()=>{
  assert.equal(rangePercent({min:'0',max:'75',value:'24'}),32);assert.equal(rangePercent({min:'0',max:'16',value:'16'}),100);assert.equal(rangePercent({min:'0',max:'16',value:'-2'}),0);assert.equal(rangePercent({min:'0',max:'16',value:'20'}),100);
});

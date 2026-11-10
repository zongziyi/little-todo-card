const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const esbuild = require('esbuild');
const { parseMarkdownTasks, stringifyMarkdownTasks } = require('../dist-electron/markdown.js');
const code=esbuild.transformSync(fs.readFileSync('src/renderer/taskOrder.ts','utf8'),{loader:'ts',format:'cjs'}).code;
const m=new Module('taskOrder');m._compile(code,'taskOrder.cjs');const {sortOpenTasks,sortShortTasks}=m.exports;
function item(text,dueDate,pinned=false){return {id:text,text,completed:false,createdAt:'2026-11-10 08:00',dueDate,pinned}}

test('pinned items first, each group by date, undated last; ties keep their original order',()=>{
  const input=[item('no date'),item('future','2026-12-10'),item('pinned late','2027-01-01',true),item('expired','2026-01-01'),item('same A','2026-12-10'),item('pinned undated',undefined,true),item('pinned early','2026-11-01',true),item('invalid date','2026-02-30'),item('same B','2026-12-10')];
  assert.deepEqual(sortOpenTasks(input).map(t=>t.text),['pinned early','pinned late','pinned undated','expired','future','same A','same B','no date','invalid date']);
  assert.equal(input[0].text,'no date');
});

test('short tasks use pinned priority then newest creation time and stable same-minute order',()=>{
  const a={...item('older'),createdAt:'2026-11-01 08:00'};
  const b={...item('newer'),createdAt:'2026-11-10 08:00'};
  const c={...item('pinned older',undefined,true),createdAt:'2026-11-01 08:00'};
  const d={...item('same time'),createdAt:'2026-11-10 08:00'};
  assert.deepEqual(sortShortTasks([a,b,c,d]).map(t=>t.text),['pinned older','newer','same time','older']);
});

test('pin metadata survives restart for dated, undated, and completed items; old data is unchanged',()=>{
  const input=[item('old with date','2026-12-10'),item('pinned','2026-11-10',true),{...item('done',undefined,true),completed:true},item('old no date')];
  const lines=stringifyMarkdownTasks(input);const result=parseMarkdownTasks(lines);
  assert.deepEqual(result.map(({text,dueDate,pinned,completed})=>({text,dueDate,pinned:!!pinned,completed})),input.map(({text,dueDate,pinned,completed})=>({text,dueDate,pinned,completed})));
  assert.match(lines,/old with date \(2026-11-10 08:00\) <!-- due:2026-12-10 -->/);
  assert.match(lines,/done \(2026-11-10 08:00\) <!-- pinned -->/);
  assert.equal(parseMarkdownTasks('- [ ] literal <!-- pinned -->')[0].text,'literal <!-- pinned -->');
});

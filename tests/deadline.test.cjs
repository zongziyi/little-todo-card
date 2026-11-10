const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const esbuild = require('esbuild');
const { parseMarkdownTasks, stringifyMarkdownTasks } = require('../dist-electron/markdown.js');
const transformed = esbuild.transformSync(fs.readFileSync('src/renderer/deadline.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const temp = new Module('deadline'); temp._compile(transformed, 'deadline.cjs');
const { deadlineLabel } = temp.exports;

test('deadline uses calendar days, including midnight, year boundaries and invalid dates', () => {
  assert.equal(deadlineLabel('2026-11-10', new Date(2026,10,10,23,59)), '今天截止');
  assert.equal(deadlineLabel('2026-11-11', new Date(2026,10,10,23,59)), '明天截止');
  assert.equal(deadlineLabel('2026-11-13', new Date(2026,10,10,0,1)), '还剩 3 天');
  assert.equal(deadlineLabel('2026-11-08', new Date(2026,10,10)), '已逾期 2 天');
  assert.equal(deadlineLabel('2027-01-01', new Date(2026,11,31)), '明天截止');
  assert.equal(deadlineLabel('2026-02-30', new Date(2026,1,1)), '');
  assert.equal(deadlineLabel(undefined), '');
});

test('deadline survives Markdown roundtrip without confusing creation timestamp', () => {
  const tasks = [{id:'1',text:'交作业',completed:false,createdAt:'2026-11-10 12:00',dueDate:'2026-12-01'}, {id:'2',text:'复习',completed:true,createdAt:'2026-11-10 12:01'}];
  const result = parseMarkdownTasks(stringifyMarkdownTasks(tasks));
  assert.deepEqual(result.map(({text,completed,createdAt,dueDate}) => ({text,completed,createdAt,dueDate})), tasks.map(({text,completed,createdAt,dueDate}) => ({text,completed,createdAt,dueDate})));
});

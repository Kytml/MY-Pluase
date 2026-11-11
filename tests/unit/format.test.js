import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtDuration, fmtSize, fmtDateTime, defaultName, safeFileName } from '../../src/lib/format.js';

test('fmtDuration：常规格式与进位', () => {
  assert.equal(fmtDuration(0), '00:00');
  assert.equal(fmtDuration(1000), '00:01');
  assert.equal(fmtDuration(1500), '00:02');
  assert.equal(fmtDuration(61000), '01:01');
  assert.equal(fmtDuration(3599000), '59:59');
  assert.equal(fmtDuration(3600000), '01:00:00');
  assert.equal(fmtDuration(500, { forceHours: true }), '00:00:01');
});

test('fmtDuration：非法输入按 0 处理', () => {
  for (const bad of [NaN, Infinity, -Infinity, -1000, undefined, null, 'x']) {
    assert.equal(fmtDuration(bad), '00:00');
  }
});

test('fmtSize：单位换算与非法输入', () => {
  assert.equal(fmtSize(0), '0 B');
  assert.equal(fmtSize(512), '512 B');
  assert.equal(fmtSize(2048), '2.0 KB');
  assert.equal(fmtSize(5 * 1024 * 1024), '5.0 MB');
  assert.equal(fmtSize(3 * 1024 ** 3), '3.00 GB');
  assert.equal(fmtSize(-1), '0 B');
  assert.equal(fmtSize(NaN), '0 B');
});

test('fmtDateTime / defaultName：本地时间格式化', () => {
  const ts = new Date(2026, 10, 8, 21, 3, 45).getTime();
  assert.equal(fmtDateTime(ts), '2026-11-08 21:03:45');
  assert.equal(defaultName('录音', ts), '录音 2026-11-08 21-03-45');
  assert.ok(defaultName('', ts).startsWith('录音 '));
  assert.ok(defaultName('  会议  ', ts).startsWith('会议 '));
});

test('safeFileName：替换非法字符，保留空格与连字符', () => {
  assert.equal(safeFileName('a/b\\c:d*e?f"g<h>i|j', 'webm'), 'a_b_c_d_e_f_g_h_i_j.webm');
  assert.equal(safeFileName('录音 2026-11-08 21-03-45', 'webm'), '录音 2026-11-08 21-03-45.webm');
});

test('safeFileName：边界与保留名', () => {
  assert.equal(safeFileName('name.', 'webm'), 'name.webm');
  assert.equal(safeFileName('name...  ', 'webm'), 'name.webm');
  assert.equal(safeFileName('   ', 'webm'), 'recording.webm');
  assert.equal(safeFileName('', ''), 'recording.webm');
  assert.equal(safeFileName('CON', 'webm'), '_CON.webm');
  assert.equal(safeFileName('com1', 'webm'), '_com1.webm');
  assert.equal(safeFileName('x', '../etc'), 'x.etc');
  assert.equal(safeFileName('y'.repeat(200), 'webm').length, 85);
  assert.equal(safeFileName('a' + String.fromCharCode(1) + 'b', 'webm'), 'a_b.webm');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, validateRecordingName, validatePrefix, NAME_MAX_LENGTH } from '../../src/lib/validate.js';

test('normalizeName：压缩空白、剔除控制字符', () => {
  assert.equal(normalizeName('  a   b  '), 'a b');
  assert.equal(normalizeName('a\nb\tc'), 'a b c');
  assert.equal(normalizeName('a' + String.fromCharCode(0) + 'b'), 'a b');
  assert.equal(normalizeName(''), '');
  assert.equal(normalizeName(null), '');
  assert.equal(normalizeName(123), '');
});

test('validateRecordingName：空值与空白被拒绝', () => {
  for (const bad of ['', '   ', '\n\t', null, undefined, 42]) {
    const result = validateRecordingName(bad);
    assert.equal(result.ok, false);
    assert.ok(result.error.length > 0);
  }
});

test('validateRecordingName：合法名称被规范化', () => {
  const result = validateRecordingName('  我的  录音  ');
  assert.deepEqual(result, { ok: true, value: '我的 录音' });
});

test('validateRecordingName：长度边界', () => {
  assert.equal(validateRecordingName('a'.repeat(NAME_MAX_LENGTH)).ok, true);
  const tooLong = validateRecordingName('a'.repeat(NAME_MAX_LENGTH + 1));
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.error, /最多/);
});

test('validatePrefix：空前缀回退默认，超长被拒绝', () => {
  assert.deepEqual(validatePrefix(''), { ok: true, value: '录音' });
  assert.deepEqual(validatePrefix(undefined), { ok: true, value: '录音' });
  assert.deepEqual(validatePrefix('会议'), { ok: true, value: '会议' });
  assert.equal(validatePrefix('a'.repeat(21)).ok, false);
});

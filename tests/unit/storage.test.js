import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordingStore, estimateStorage } from '../../src/core/storage.js';

function makeRecord(id, createdAt, extra = {}) {
  return {
    id,
    name: `录音 ${id}`,
    createdAt,
    duration: 1000,
    size: 3,
    mime: 'audio/webm',
    ext: 'webm',
    blob: new Blob(['abc'], { type: 'audio/webm' }),
    ...extra,
  };
}

test('无 IndexedDB 环境自动降级为内存存储并明确标记', async () => {
  const store = new RecordingStore({ indexedDB: undefined });
  const { persistent, error } = await store.init();
  assert.equal(persistent, false);
  assert.ok(error.length > 0);
  assert.equal(store.persistent, false);
});

test('内存模式 CRUD 与倒序排列', async () => {
  const store = new RecordingStore({ indexedDB: undefined });
  await store.save(makeRecord('a', 1000));
  await store.save(makeRecord('b', 3000));
  await store.save(makeRecord('c', 2000));

  const list = await store.list();
  assert.deepEqual(list.map((r) => r.id), ['b', 'c', 'a']);

  // 同 id 覆盖更新（重命名场景）
  await store.save(makeRecord('b', 3000, { name: '改名后' }));
  assert.equal((await store.list()).find((r) => r.id === 'b').name, '改名后');

  await store.remove('c');
  assert.deepEqual((await store.list()).map((r) => r.id), ['b', 'a']);
  await store.remove('not-exist'); // 删除不存在的 id 不应抛错
  assert.equal((await store.list()).length, 2);
});

test('save 输入校验：缺 id 或音频数据直接拒绝', async () => {
  const store = new RecordingStore({ indexedDB: undefined });
  await assert.rejects(() => store.save(null), TypeError);
  await assert.rejects(() => store.save({ blob: new Blob(['x']) }), TypeError);
  await assert.rejects(() => store.save({ id: 'x' }), TypeError);
});

test('list 过滤缺字段的脏数据', async () => {
  const store = new RecordingStore({ indexedDB: undefined });
  await store.save(makeRecord('good', 1000));
  await store.save(makeRecord('bad', NaN)); // 损坏的创建时间应被过滤
  const list = await store.list();
  assert.deepEqual(list.map((r) => r.id), ['good']);
});

test('init 幂等，多次调用共享同一次初始化', async () => {
  const store = new RecordingStore({ indexedDB: undefined });
  const [a, b] = await Promise.all([store.init(), store.init()]);
  assert.deepEqual(a, b);
});

test('无 navigator.storage 时 estimateStorage 返回 null', async () => {
  assert.equal(await estimateStorage(), null);
});

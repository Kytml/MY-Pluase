import test from 'node:test';
import assert from 'node:assert/strict';
import { ElapsedClock } from '../../src/lib/clock.js';

/** 可控时钟：手动推进时间，模拟后台标签页降频等场景。 */
function makeClock() {
  let now = 0;
  return {
    clock: new ElapsedClock(() => now),
    advance(ms) { now += ms; },
  };
}

test('开始后按真实经过时间累计', () => {
  const { clock, advance } = makeClock();
  assert.equal(clock.elapsed, 0);
  clock.start();
  advance(1200);
  assert.equal(clock.elapsed, 1200);
  assert.equal(clock.running, true);
});

test('暂停不计时，继续后接着累计', () => {
  const { clock, advance } = makeClock();
  clock.start();
  advance(1000);
  clock.pause();
  advance(5000); // 暂停期间经过的时间必须被排除
  assert.equal(clock.elapsed, 1000);
  assert.equal(clock.running, false);
  clock.resume();
  advance(500);
  assert.equal(clock.elapsed, 1500);
});

test('重复 start / pause 幂等，不会重复累计', () => {
  const { clock, advance } = makeClock();
  clock.start();
  clock.start();
  advance(1000);
  clock.pause();
  clock.pause();
  assert.equal(clock.elapsed, 1000);
  clock.start();
  advance(1000);
  assert.equal(clock.elapsed, 2000);
});

test('stop 保留结果，reset 清零', () => {
  const { clock, advance } = makeClock();
  clock.start();
  advance(800);
  assert.equal(clock.stop(), 800);
  advance(3000);
  assert.equal(clock.elapsed, 800);
  clock.reset();
  assert.equal(clock.elapsed, 0);
  assert.equal(clock.running, false);
});

test('未开始直接 pause / stop 不产生异常值', () => {
  const { clock } = makeClock();
  assert.equal(clock.pause(), 0);
  assert.equal(clock.stop(), 0);
  assert.equal(clock.elapsed, 0);
});

test('时钟源必须是函数', () => {
  assert.throws(() => new ElapsedClock(123), TypeError);
});

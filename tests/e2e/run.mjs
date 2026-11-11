/**
 * 端到端测试：在真实 Chrome（模拟麦克风设备）中验证关键用户路径。
 * 用法：npm run test:e2e
 * 未安装 Chrome / Edge 或 Node < 22 时明确跳过（退出码 0），不会误报失败。
 */

import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHarness, sleep, waitFor, BASE_URL } from './harness.js';

const harness = await createHarness();
if (!harness) process.exit(0);

const { cdp } = harness;
let failures = 0;
const ui = {
  click: (sel) => cdp.eval(`document.querySelector(${JSON.stringify(sel)}).click()`),
  text: (sel) => cdp.eval(`document.querySelector(${JSON.stringify(sel)}).textContent`),
  count: (sel) => cdp.eval(`document.querySelectorAll(${JSON.stringify(sel)}).length`),
  state: () => ui.text('#stateText span'),
  notice: () => cdp.eval("document.querySelector('#notice').className + ' :: ' + document.querySelector('#noticeBody').textContent"),
  listCount: () => ui.count('.rec-item'),
  dbCount: () => cdp.eval(`new Promise(res=>{const r=indexedDB.open('voice-recorder');r.onsuccess=()=>{const q=r.result.transaction('recordings').objectStore('recordings').count();q.onsuccess=()=>res(q.result);q.onerror=()=>res(-1)};r.onerror=()=>res(-2)})`),
  dbFirst: () => cdp.eval(`new Promise(res=>{const r=indexedDB.open('voice-recorder');r.onsuccess=()=>{const q=r.result.transaction('recordings').objectStore('recordings').getAll();q.onsuccess=()=>res(q.result[0]||null);q.onerror=()=>res(null)};r.onerror=()=>res(null)})`),
};

async function test(name, fn) {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL ' + name + ' | ' + e.message);
  }
}

await test('页面加载完成，初始为待命状态', async () => {
  await sleep(700);
  assert.ok((await cdp.eval('document.title')).includes('录音机'));
  assert.equal(await ui.state(), '待命');
  assert.equal(await ui.listCount(), 0);
});

await test('设置：修改前缀与码率并写入 localStorage', async () => {
  await ui.click('#btnSettings');
  await sleep(200);
  assert.equal(await cdp.eval("document.querySelector('#settingsDialog').open"), true);
  await cdp.eval("document.querySelector('#set-prefix').value='测试'");
  await cdp.eval("document.querySelector('#set-bitrate').value='96000'");
  await cdp.eval("document.querySelector('.settings-form button[type=submit]').click()");
  await sleep(300);
  assert.equal(await cdp.eval("document.querySelector('#settingsDialog').open"), false);
  const saved = await cdp.eval("JSON.parse(localStorage.getItem('voice-recorder:config:v1'))");
  assert.equal(saved.namePrefix, '测试');
  assert.equal(saved.audioBitsPerSecond, 96000);
});

await test('设置：非法最长时长被拒绝，合法值可保存', async () => {
  await ui.click('#btnSettings');
  await sleep(200);
  await cdp.eval("document.querySelector('#set-maxdur').value='-5'");
  await cdp.eval("document.querySelector('.settings-form button[type=submit]').click()");
  await sleep(250);
  assert.equal(await cdp.eval("document.querySelector('#settingsDialog').open"), true, '非法输入不应关闭对话框');
  assert.ok((await ui.text('#settingsDialog .field-error')).includes('最长录音时长'));
  await cdp.eval("document.querySelector('#set-maxdur').value='0'");
  await cdp.eval("document.querySelector('.settings-form button[type=submit]').click()");
  await sleep(250);
  assert.equal(await cdp.eval("document.querySelector('#settingsDialog').open"), false);
});

await test('录音：开始 → 暂停计时冻结 → 继续 → 停止保存', async () => {
  await ui.click('#btnStart');
  await sleep(1600);
  assert.equal(await ui.state(), '正在录音', await ui.notice());
  await ui.click('#btnPause');
  await sleep(250);
  const t1 = await ui.text('#timer');
  await sleep(900);
  assert.equal(await ui.text('#timer'), t1, '暂停后计时必须冻结');
  await ui.click('#btnResume');
  await sleep(1100);
  assert.notEqual(await ui.text('#timer'), t1, '继续后计时必须恢复');
  await ui.click('#btnStop');
  await sleep(1500);
  assert.equal(await ui.listCount(), 1, await ui.notice());
  assert.equal(await ui.dbCount(), 1);
  const name = await ui.text('.rec-name');
  assert.ok(name.startsWith('测试'), '应使用设置中的命名前缀，实际：' + name);
  assert.ok((await ui.notice()).includes('已保存'));
});

await test('刷新页面后录音仍在（IndexedDB 真实持久化）', async () => {
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(1300);
  assert.equal(await ui.listCount(), 1);
  assert.ok((await ui.text('.rec-name')).startsWith('测试'));
});

await test('播放：播放条出现、进度可读、可暂停关闭', async () => {
  await ui.click('.play-btn');
  await sleep(900);
  assert.equal(await cdp.eval("document.querySelector('#player').classList.contains('hidden')"), false);
  assert.equal(await cdp.eval("document.querySelector('#audioEl').paused"), false);
  const time = await ui.text('#pTime');
  assert.ok(!time.includes('Infinity') && !time.includes('NaN'), '进度文本异常：' + time);
  await ui.click('#pToggle');
  await sleep(200);
  assert.equal(await cdp.eval("document.querySelector('#audioEl').paused"), true);
  await ui.click('#pClose');
});

await test('重命名：空白名称被拒绝并保留编辑态', async () => {
  await cdp.eval("document.querySelectorAll('.rec-actions .icon-btn')[0].click()");
  await cdp.eval("document.querySelector('.name-input').value='   '");
  await cdp.eval("document.querySelector('.rec-actions .icon-btn.primary').click()");
  await sleep(300);
  assert.ok((await ui.text('.rec-item .field-error')).includes('名称不能为空'));
  assert.equal(await cdp.eval("!!document.querySelector('.name-input')"), true);
  await cdp.eval("document.querySelector('.name-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await sleep(250);
  assert.equal(await cdp.eval("!!document.querySelector('.name-input')"), false);
});

await test('重命名：合法名称保存并写入数据库', async () => {
  await cdp.eval("document.querySelectorAll('.rec-actions .icon-btn')[0].click()");
  await cdp.eval("document.querySelector('.name-input').value='E2E 录音'");
  await cdp.eval("document.querySelector('.name-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  await sleep(500);
  assert.equal(await ui.text('.rec-name'), 'E2E 录音');
  assert.equal((await ui.dbFirst()).name, 'E2E 录音');
});

await test('下载：文件真实落盘且文件名合法', async () => {
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: harness.downloadDir });
  await cdp.eval("document.querySelectorAll('.rec-actions .icon-btn')[1].click()");
  const file = path.join(harness.downloadDir, 'E2E 录音.webm');
  await waitFor(() => existsSync(file), { description: '下载文件生成', timeout: 9000 });
  assert.ok(statSync(file).size > 0);
});

await test('删除：取消保留，确认后删除并同步数据库', async () => {
  await cdp.eval("document.querySelectorAll('.rec-actions .icon-btn')[2].click()");
  await sleep(150);
  assert.equal(await cdp.eval("!!document.querySelector('.confirm-txt')"), true, '删除必须二次确认');
  await cdp.eval("document.querySelectorAll('.rec-actions .icon-btn')[1].click()");
  await sleep(250);
  assert.equal(await ui.listCount(), 1, '取消删除后记录应保留');
  await cdp.eval("document.querySelectorAll('.rec-actions .icon-btn')[2].click()");
  await sleep(150);
  await cdp.eval("document.querySelectorAll('.rec-actions .icon-btn')[0].click()");
  await sleep(450);
  assert.equal(await ui.listCount(), 0);
  assert.equal(await ui.dbCount(), 0);
});

await test('最长时长：到达上限自动停止并保存', async () => {
  await ui.click('#btnSettings');
  await sleep(200);
  await cdp.eval("document.querySelector('#set-maxdur').value='1'");
  await cdp.eval("document.querySelector('.settings-form button[type=submit]').click()");
  await sleep(300);
  await ui.click('#btnStart');
  await sleep(2700);
  assert.equal(await ui.state(), '待命', '到时应自动停止');
  assert.equal(await ui.listCount(), 1);
  assert.match(await ui.notice(), /已保存|最长录音时长/);
  const rec = await ui.dbFirst();
  assert.ok(rec.duration >= 900 && rec.duration <= 2500, '自动停止时长异常：' + rec.duration);
});

await test('权限被拒绝：给出可操作提示且不产生录音', async () => {
  // 模拟麦克风授权被拒（比依赖 Chrome 权限内部行为更稳定，直接覆盖我们的错误处理路径）
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied by e2e','NotAllowedError'));",
  });
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(1300);
  const before = await ui.listCount();
  await ui.click('#btnStart');
  await sleep(900);
  assert.ok((await ui.notice()).includes('权限被拒绝'), await ui.notice());
  assert.equal(await ui.state(), '待命');
  assert.equal(await ui.listCount(), before, '拒绝授权不应产生新录音');
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(1200);
});

await test('设备不存在：提示检查麦克风连接', async () => {
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('No device by e2e','NotFoundError'));",
  });
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(1300);
  const before = await ui.listCount();
  await ui.click('#btnStart');
  await sleep(900);
  assert.ok((await ui.notice()).includes('没有检测到麦克风设备'), await ui.notice());
  assert.equal(await ui.listCount(), before);
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(1200);
});

await test('多标签页：第二个标签页自动同步删除结果', async () => {
  const before = await ui.listCount();
  assert.ok(before >= 1, '前置条件：列表中应至少有一条录音');
  const tab2 = await harness.newPage(`${BASE_URL}/index.html`);
  await sleep(1100);
  assert.equal(await tab2.eval("document.querySelectorAll('.rec-item').length"), before);
  await cdp.eval("document.querySelectorAll('.rec-actions .icon-btn')[2].click()");
  await sleep(150);
  await cdp.eval("document.querySelectorAll('.rec-actions .icon-btn')[0].click()");
  await sleep(1000);
  assert.equal(await ui.listCount(), before - 1);
  assert.equal(await tab2.eval("document.querySelectorAll('.rec-item').length"), before - 1, '另一个标签页应同步删除结果');
  tab2.close();
});

await test('全程无页面 JavaScript 错误', async () => {
  assert.deepEqual(cdp.pageErrors, []);
});

await harness.close();
console.log(failures === 0 ? '\n=== E2E 全部通过 ===' : `\n=== E2E 失败 ${failures} 项 ===`);
process.exit(failures === 0 ? 0 : 1);

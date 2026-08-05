// 边界测试：老数据兼容 / XSS 转义 / 数据结构缺失
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'file://C:/Users/woqutech/WorkBuddy/2026-08-04-10-01-24/personal-workbench/index.html';

const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss2=1<\/script>';
const now = Date.now();

async function testCase(name, seed, checks) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e.stack || e.message)));
  await p.evaluateOnNewDocument(s => localStorage.setItem('pufferwork:v1', s), JSON.stringify(seed));
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  const result = await p.evaluate(checks);
  console.log('[' + name + '] errors:', errors.length ? errors : 'none');
  console.log('  result:', JSON.stringify(result));
  await b.close();
}

(async () => {
  // A: 最老数据（只有 settings，无 water/wishes/notifySystem 等）
  await testCase('A_old_data', {
    settings: { partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 }, me: 'a' }
  }, () => ({
    waterOK: !!document.getElementById('waterCount'),
    statTodo: document.getElementById('statTodo').textContent,
    title: document.title,
  }));

  // C: fitnessPlan 空对象（部分设备可能出现）
  await testCase('C_empty_fitnessPlan', {
    fitnessPlan: {},
    settings: { partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 }, me: 'a', city: '杭州' }
  }, async () => {
    const el = document.querySelector('.nav-item[data-page="fitness"]');
    if (el) el.click();
    await new Promise(r => setTimeout(r, 400));
    return { fitnessRendered: !!document.getElementById('weekStrip').children.length, todayPlan: (document.getElementById('todayPlanBody') || {}).textContent || '' };
  });

  // B: XSS 注入（留言/心愿/待办）
  await testCase('B_xss', {
    messages: [{ id: 'm1', text: XSS, author: 'b', createdAt: now, updatedAt: now }],
    wishes: [{ id: 'w1', text: XSS, icon: '🛎️', anonymous: false, author: 'a', color: 'coral', tilt: 0, createdAt: now, updatedAt: now }],
    todos: [{ id: 't1', title: XSS, done: false, date: '', createdAt: now, updatedAt: now }],
    settings: { partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 }, me: 'a', city: '杭州' }
  }, async () => {
    // 到留言页
    document.querySelector('.nav-item[data-page="messages"]').click();
    await new Promise(r => setTimeout(r, 300));
    const msgHtml = document.getElementById('msgList').innerHTML;
    const msgXssFired = await new Promise(r => setTimeout(() => r(!!window.__xss || !!window.__xss2), 100));
    // 到心愿页
    document.querySelector('.nav-item[data-page="wishes"]').click();
    await new Promise(r => setTimeout(r, 300));
    const wishHtml = document.getElementById('wishWall').innerHTML;
    // 到待办页
    document.querySelector('.nav-item[data-page="todo"]').click();
    await new Promise(r => setTimeout(r, 300));
    const todoHtml = document.getElementById('todoList').innerHTML;
    return {
      msgXssFired,
      msgEscaped: !msgHtml.includes('<img'),
      msgTextOk: msgHtml.includes('&lt;img'),
      wishEscaped: !wishHtml.includes('<img'),
      todoEscaped: !todoHtml.includes('<img'),
    };
  });

  // D: 软删除数据过滤（deleted:true 不显示）
  await testCase('D_softdelete', {
    messages: [
      { id: 'keep', text: '保留', author: 'b', createdAt: now, updatedAt: now },
      { id: 'gone', text: '删除', author: 'b', createdAt: now, updatedAt: now, deleted: true },
    ],
    settings: { partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 }, me: 'a', city: '杭州' }
  }, async () => {
    document.querySelector('.nav-item[data-page="messages"]').click();
    await new Promise(r => setTimeout(r, 300));
    const txt = document.getElementById('msgList').textContent;
    return { showsKeep: txt.includes('保留'), hidesGone: !txt.includes('删除') };
  });
})();

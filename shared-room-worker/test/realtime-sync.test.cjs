const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const root = resolve(__dirname, '../..');
const app = readFileSync(resolve(root, 'app.js'), 'utf8');
const worker = readFileSync(resolve(root, 'shared-room-worker/worker.js'), 'utf8');
const part = (start, end) => {
  const a = app.indexOf(start), b = app.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing source boundary ${start}`);
  return app.slice(a, b);
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = data => JSON.parse(JSON.stringify(data));
const lifeSource = readFileSync(resolve(root, 'life.js'), 'utf8');
const timeContext = vm.createContext({ Date });
vm.runInContext(lifeSource.slice(lifeSource.indexOf('  const when ='), lifeSource.indexOf('  function syncStatus()')) + '\nthis.when = when;', timeContext);

// Execute the actual Worker handlers with real SQLite transactions. This is a
// portable behavioral suite; Miniflare tests additionally cover workerd itself.
function backend(t) {
  const stores = [], rooms = new Map(), kv = new Map();
  const context = vm.createContext({
    Request, Response, Headers, URL, TextEncoder, TextDecoder, crypto,
    Uint8Array, ArrayBuffer, Date, setTimeout, clearTimeout, console,
    DurableObject: class {}, fetch,
  });
  const source = worker.replace(/^import .*;\r?\n/gm, '')
    .replace('export class RoomCoordinator', 'class RoomCoordinator')
    .replace('export default {', 'const workerEntry = {');
  vm.runInContext(source + '\nthis.Coordinator = RoomCoordinator; this.handle = handle;', context);
  const env = {
    BENCH: {
      async get(key, options) { const value = kv.get(key); return options?.type === 'json' && value ? JSON.parse(value) : value || null; },
      async put(key, value) { kv.set(key, value); }
    },
    ROOMS: {
      idFromName: name => name,
      get(name) {
        if (!rooms.has(name)) {
          const db = new DatabaseSync(':memory:'); stores.push(db);
          const sql = { exec(query, ...bindings) {
            bindings = bindings.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
            if (/^CREATE TABLE/.test(query)) { db.exec(query); return { toArray: () => [] }; }
            const statement = db.prepare(query);
            const rows = /^SELECT/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), []);
            return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
          }};
          const storage = { sql, transactionSync(fn) {
            db.exec('BEGIN');
            try { const value = fn(); db.exec('COMMIT'); return value; }
            catch (error) { db.exec('ROLLBACK'); throw error; }
          }};
          rooms.set(name, new context.Coordinator({ storage }, env));
        }
        return rooms.get(name);
      }
    }
  };
  t.after(() => {
    for (const room of rooms.values()) for (const finish of [...room.changeWaiters]) finish({ revision: 0, updatedAt: 0 });
    for (const db of stores) db.close();
  });
  const dispatch = (url, init) => context.handle(new Request(url, init), env, { waitUntil: promise => promise.catch(() => {}) });
  const request = async (room, suffix, body) => {
    const response = await dispatch(`https://sync.test/api/v1/rooms/${room}${suffix}`, body === undefined ? undefined : {
      method: suffix ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    dispatch, rooms,
    put: (room, rev, data, pass = 'secret') => request(room, '', { pass, baseRev: rev, data }),
    get: room => request(room, '?pass=secret'),
    watch: (room, since, pass = 'secret', waitMs = 1000) => request(room, '/changes', { pass, since, waitMs }),
  };
}

function client(t, dispatch, me = 'a') {
  const timers = new Map(), calls = [], state = {
    todos: [], trainings: [], messages: [], gallery: [], travels: [], meals: [], wishes: [],
    water: {}, hydrationLog: [], challengeAnswers: [], dailyStatus: {}, interactionHistory: {},
    fortune: null, fitnessPlan: {}, settings: { me, partners: {}, room: {
      backend: 'worker', url: 'https://sync.test', id: 'chat', pass: 'secret', joined: true,
      lastRev: 1, pendingMessageIds: [], pendingSyncAt: 0
    }}
  };
  let sequence = 0;
  const context = vm.createContext({
    state, Date, JSON, Map, Set, Object, Number, Array, String, Math, Promise,
    TextEncoder, AbortController, crypto, console,
    document: { hidden: false }, navigator: { onLine: true },
    window: { dispatchEvent() {} }, CustomEvent: class {},
    fetch: async (url, init) => { calls.push({ url, init }); return dispatch(url, init); },
    setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearInterval: id => timers.delete(id),
  });
  vm.runInContext(`
    let roomSession = 0, pollInFlight = null, pushTimer = null, roomTimer = null;
    function todayKey() { return '2026-09-07'; }
    function dedupeMeals() {}
    function normWater(v) { return typeof v === 'number' ? {a:v,b:0} : {a:Number(v?.a)||0,b:Number(v?.b)||0}; }
    function migrateLegacyWater() {}
    function live(arr) { return (arr || []).filter(x => !x.deleted); }
    function roomActive() { return !!state.settings.room.joined; }
    function roomContext() { return {...state.settings.room}; }
    function sameRoomContext(a,b) { return a.id===b.id && a.pass===b.pass && a.url===b.url && a.backend===b.backend; }
    function save() {}
    function setSyncPillBusy() {}
    function emitSyncStatus() {}
    function updateRoomStatus() {}
    function persistSyncMeta() {}
    function updateInteractionHistory() { return false; }
    function notifyNewMessages(items) { return items; }
    function toast() {}
    function describeRemoteChange() { return ''; }
    function emitRemoteChanges() {}
    function renderCurrent() {}
    function startPresencePolling() {}
    ${part('  const ROOM_TOMBSTONE_RETENTION_MS', '  // 同一时间戳的极少数并发编辑')}
    ${part('  function stableRecord', '  // 移动网络偶发 DNS / IPv6 / TLS 路由卡住时')}
    ${part('  function ensureRoomSyncMeta', '  function emitSyncStatus')}
    ${part('  const SYNC_REQUEST_TIMEOUT_MS', '  function renderCurrent()')}
    ${part('  let roomWatchGeneration', '  function stopRoomConnections()')}
    this.api = {
      push: pushToRoom, poll: pollRoom, schedule: scheduleRoomPush,
      watch: startRoomWatch, stop: stopRoomWatch, startPolling: startRoomPolling,
      pause: pauseRoomSync, resume: resumeRoomSync,
      add(id) {
        state.messages.push({id, author:state.settings.me, text:id, createdAt:Date.now(), updatedAt:Date.now()});
        markPendingMessage(id); markPendingSync(); scheduleRoomPush();
      },
      switchRoom(id) { roomSession++; stopRoomWatch(); state.settings.room.id=id; },
      healthy: () => roomWatchHealthyAt,
    };
  `, context);
  t.after(() => { context.api.stop(); timers.clear(); });
  return { api: context.api, state, timers, calls, context,
    async runTimer(ms) {
      const entry = [...timers].find(([, timer]) => timer.ms === ms);
      assert.ok(entry, `missing ${ms}ms timer`);
      timers.delete(entry[0]); await entry[1].fn(); await tick();
    }
  };
}

test('message sends bypass debounce while ordinary changes remain batched', t => {
  const c = client(t, () => { throw new Error('no network expected'); });
  c.api.schedule();
  assert.equal([...c.timers.values()][0].ms, 1000);
  c.api.add('first'); c.api.add('second');
  assert.equal(c.timers.size, 1);
  assert.equal([...c.timers.values()][0].ms, 0);
});

function messageComposer({success=true, file=null, duringUpload, online=true}={}) {
  const inputEvents = [];
  const text = {value:'hello',dispatchEvent:event=>inputEvents.push(event.type)}, image = {files:file?[file]:[],value:file?'photo.png':''};
  const feedback = {hidden:false,textContent:'正在处理图片并保存，请稍候…'};
  const preview = {dataset:{objectUrl:'blob:preview'},hidden:false,innerHTML:'preview'};
  const fields = {'#lifeMessageText':text,'#lifeMessageImage':image,'#lifeMessageImagePreview':preview,'.life-form-feedback':feedback};
  const panel = {querySelector: selector=>fields[selector]};
  const state = {settings:{me:'a'},messages:[]};
  const notices = [], revoked = [];
  let refreshed=0, cleared=0, flushed=0;
  const button = {closest:()=>panel,matches:selector=>selector==='[data-save-message]'};
  const context = vm.createContext({
    window:{PufferLife:{
      addMessage: value=>{if(success)state.messages.push({id:'message',author:'a',createdAt:1,text:value});return success;},
      async addMessageFile(_file,value){if(duringUpload)duringUpload(text,image);if(success)state.messages.push({id:'message',author:'a',createdAt:1,text:value});return success;},
      clearInputDraft:()=>cleared++,notify:notice=>notices.push(notice)
    }},
    Event,navigator:{onLine:online},URL:{revokeObjectURL:value=>revoked.push(value)},
    mask:{contains:value=>value===panel,querySelector:selector=>fields[selector]},
    activeSheetDraft:{scope:'message',flush:()=>flushed++},
    state:()=>state,live:items=>items,dayKey:()=>'',syncStatus:()=>({joined:true}),
    refreshOpenMessageSheet:()=>refreshed++,requestCompanionReaction(){},
    runLifeSubmission:(_button,task)=>task(),
    closeSheet:()=>{throw new Error('The pending message must stay visible');},
  });
  const a=lifeSource.indexOf('  function finishMessageSubmission('),b=lifeSource.indexOf('  function selectTab(',a);
  assert.ok(a>=0&&b>a);
  vm.runInContext(lifeSource.slice(a,b)+'\nthis.submit = handleLifeSubmission;',context);
  return {submit:()=>context.submit(button),text,image,preview,notices,revoked,state,feedback,inputEvents,
    counts:()=>({refreshed,cleared,flushed})};
}

test('locally saved messages keep the chat open with sync status and clear only the sent draft', async()=>{
  const c=messageComposer({online:false});
  assert.equal(await c.submit(),true);
  assert.equal(c.text.value,'');
  assert.deepEqual(c.inputEvents,['input']);
  assert.equal(c.feedback.hidden,true);
  assert.equal(c.feedback.textContent,'');
  assert.deepEqual(c.counts(),{refreshed:1,cleared:1,flushed:1});
  assert.match(c.notices[0],/联网后会自动补发/);
  assert.equal(c.state.messages.length,1);
});

test('failed saves and drafts changed during image upload remain in the composer', async()=>{
  const failed=messageComposer({success:false});
  assert.equal(await failed.submit(),false);
  assert.equal(failed.text.value,'hello');
  assert.deepEqual(failed.counts(),{refreshed:0,cleared:0,flushed:0});
  const c=messageComposer({file:{name:'photo.png'},duringUpload:text=>{text.value='next draft';}});
  assert.equal(await c.submit(),true);
  assert.equal(c.text.value,'next draft');
  assert.equal(c.state.messages[0].text,'hello');
  assert.deepEqual(c.counts(),{refreshed:1,cleared:0,flushed:0});
});

test('successful photo messages release the preview without closing the conversation', async()=>{
  const c=messageComposer({file:{name:'photo.png'}});
  assert.equal(await c.submit(),true);
  assert.equal(c.image.value,'');
  assert.equal(c.preview.hidden,true);
  assert.deepEqual(c.revoked,['blob:preview']);
  assert.equal(c.preview.dataset.objectUrl,undefined);
  assert.deepEqual(c.counts(),{refreshed:1,cleared:1,flushed:1});
});

test('different send times survive upload, authoritative storage, and both receiving clients', async t => {
  const b = backend(t);
  await b.put('chat', 0, {messages:[]});
  const a = client(t, b.dispatch, 'a'), c = client(t, b.dispatch, 'b');
  const samples = [[0,7], [9,0], [14,36], [23,58]];
  for (let i=0; i<samples.length; i++) {
    const [hour, minute] = samples[i], sender = i%2 ? c : a;
    const sentAt = new Date(2026,8,6,hour,minute,21,456).getTime();
    sender.state.messages.push({id:`time-${i}`,author:sender.state.settings.me,text:'timestamp audit',createdAt:sentAt,updatedAt:sentAt});
    assert.equal(await sender.api.push(), true);
    await Promise.all([a.api.poll(), c.api.poll()]);
    for (const snapshot of [a.state, c.state, (await b.get('chat')).body.data]) {
      const message = snapshot.messages.find(item=>item.id===`time-${i}`);
      assert.equal(message.createdAt, sentAt);
      assert.equal(timeContext.when(message.createdAt), `9/6 ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`);
    }
  }
});

test('offline replay and later record updates do not replace original message time', async t => {
  const b = backend(t);
  await b.put('chat', 0, {messages:[]});
  let offline = true;
  const a = client(t, (url, init) => {
    if (offline) throw new Error('offline');
    return b.dispatch(url, init);
  });
  const sentAt = new Date(2026,8,5,22,43,17,123).getTime();
  a.state.messages.push({id:'offline-time',author:'a',text:'offline audit',createdAt:sentAt,updatedAt:sentAt});
  assert.equal(await a.api.push(), false);
  offline = false;
  assert.equal(await a.api.push(), true);
  const c = client(t, b.dispatch, 'b');
  await c.api.poll();
  c.state.messages[0].updatedAt = Date.now();
  c.state.messages[0].text = 'later edit';
  assert.equal(await c.api.push(), true);
  await a.api.poll();
  for (const snapshot of [a.state,c.state,(await b.get('chat')).body.data]) {
    assert.equal(snapshot.messages[0].createdAt, sentAt);
    assert.equal(timeContext.when(snapshot.messages[0].createdAt), '9/5 22:43');
  }
});

test('pending messages keep retrying after six failures and recover without reopening', async t => {
  const b = backend(t);
  await b.put('chat',0,{messages:[]});
  let unavailable = true;
  const c = client(t,(url,init)=>{
    if (unavailable) throw new Error('temporary outage');
    return b.dispatch(url,init);
  });
  c.api.add('long-outage');
  const createdAt = c.state.messages[0].createdAt;
  await c.runTimer(0);
  for (const delay of [5000,10000,20000,40000,80000,120000,120000]) {
    await c.runTimer(delay);
    assert.deepEqual(clone(c.state.settings.room.pendingMessageIds), ['long-outage']);
    assert.ok([...c.timers.values()].some(timer=>timer.ms<=120000));
  }
  unavailable = false;
  await c.runTimer(120000);
  assert.equal(c.state.settings.room.pendingMessageIds.length,0);
  assert.equal((await b.get('chat')).body.data.messages[0].createdAt,createdAt);
  assert.equal(c.timers.size,0);
});

test('hidden and offline clients pause retries and resume pending uploads without duplicates', async t => {
  const b = backend(t);
  await b.put('chat',0,{messages:[]});
  const c = client(t,b.dispatch);
  c.api.add('restore');
  c.context.document.hidden = true;
  c.api.pause();
  c.api.resume();
  assert.equal(c.calls.length,0);
  c.context.document.hidden = false;
  c.context.navigator.onLine = false;
  c.api.resume();
  assert.equal(c.calls.length,0);
  c.context.navigator.onLine = true;
  await Promise.all([c.api.resume(),c.api.resume(),c.api.resume()]);
  assert.equal(c.calls.filter(call=>call.init?.method==='PUT').length,1);
  assert.equal(c.state.settings.room.pendingMessageIds.length,0);
  assert.equal((await b.get('chat')).body.data.messages.length,1);
});

test('retry timers stop on backgrounding and resume reads without uploading when nothing is pending', async t => {
  const c = client(t,()=>{throw new Error('offline');});
  c.api.add('waiting');
  await c.runTimer(0);
  assert.ok([...c.timers.values()].some(timer=>timer.ms===5000));
  c.context.document.hidden = true;
  c.api.pause();
  assert.equal(c.timers.size,0);
  assert.deepEqual(clone(c.state.settings.room.pendingMessageIds),['waiting']);
  const b = backend(t);
  await b.put('chat',0,{messages:[]});
  const idle = client(t,b.dispatch);
  await idle.api.resume();
  assert.equal(idle.calls.filter(call=>call.init?.method==='PUT').length,0);
});

test('server watcher authenticates, catches up, and never returns message bodies', async t => {
  const b = backend(t);
  await b.put('chat', 0, { messages: [{id:'private'}] });
  assert.equal((await b.watch('chat', 0, 'wrong')).status, 403);
  assert.equal((await b.watch('chat', -1)).status, 400);
  assert.equal((await b.watch('missing', 0)).status, 404);
  assert.equal((await b.get('missing')).status, 404);
  const hint = await b.watch('chat', 0);
  assert.equal(hint.body.rev, 1);
  assert.doesNotMatch(JSON.stringify(hint.body), /private|secret|messages/);
});

test('server timeout releases listeners and conflicting writes do not notify', async t => {
  const b = backend(t);
  await b.put('chat', 0, {messages:[]});
  const waiting = b.watch('chat', 1);
  await tick();
  assert.equal(b.rooms.get('chat').changeWaiters.size, 1);
  await b.put('other', 0, {messages:[{id:'other'}]});
  assert.equal((await b.put('chat', 0, {messages:[{id:'stale'}]})).status, 409);
  assert.equal(b.rooms.get('chat').changeWaiters.size, 1);
  assert.equal((await waiting).body.rev, 1);
  assert.equal(b.rooms.get('chat').changeWaiters.size, 0);
});

test('two real frontend queues converge after simultaneous sends without duplicate messages', async t => {
  const b = backend(t);
  await b.put('chat', 0, {messages:[]});
  const a = client(t, b.dispatch, 'a'), c = client(t, b.dispatch, 'b');
  // Let conflict backoff use real timers; all other timers stay controlled.
  for (const device of [a,c]) {
    const controlled = device.context.setTimeout;
    device.context.setTimeout = (fn, ms) => ms >= 260 && ms <= 680 ? setTimeout(fn, 0) : controlled(fn, ms);
  }
  a.api.add('a-1'); c.api.add('b-1');
  assert.deepEqual(await Promise.all([a.api.push(), c.api.push()]), [true,true], JSON.stringify([a.state.settings.room, c.state.settings.room]));
  await Promise.all([a.api.poll(), c.api.poll()]);
  for (const value of [a.state, c.state, (await b.get('chat')).body.data]) {
    assert.deepEqual(clone(value.messages.map(x=>x.id).sort()), ['a-1','b-1']);
  }
});

test('a message added during an upload is drained by the queue and acknowledged separately', async t => {
  const b = backend(t);
  await b.put('chat', 0, {messages:[]});
  let release, began;
  const started = new Promise(resolve => began=resolve);
  const gate = new Promise(resolve => release=resolve);
  let puts = 0;
  const c = client(t, async (url, init) => {
    if (init?.method === 'PUT' && ++puts === 1) { began(); await gate; }
    return b.dispatch(url, init);
  });
  c.api.add('first'); const sending = c.api.push();
  await started;
  c.api.add('second');
  release(); assert.equal(await sending, true);
  assert.equal(puts, 2);
  assert.deepEqual((await b.get('chat')).body.data.messages.map(x=>x.id), ['first','second']);
  assert.equal(c.state.settings.room.pendingMessageIds.length, 0);
});

test('a pending pull and upload never share a mutable base revision', async t => {
  const b = backend(t);
  await b.put('chat', 0, {messages:[]});
  let release, entered;
  const started = new Promise(resolve => entered=resolve);
  const gate = new Promise(resolve => release=resolve);
  let hold = true;
  const c = client(t, async (url, init) => {
    if ((!init?.method || init.method === 'GET') && hold) { hold=false; entered(); await gate; }
    return b.dispatch(url, init);
  });
  const pulling = c.api.poll(); await started;
  await b.put('chat', 1, {messages:[{id:'remote', author:'b', text:'remote', updatedAt:1}]});
  c.api.add('local'); const sending = c.api.push();
  await tick();
  assert.equal(c.calls.filter(x=>x.init?.method==='PUT').length, 0);
  release(); await pulling; assert.equal(await sending, true);
  assert.deepEqual((await b.get('chat')).body.data.messages.map(x=>x.id).sort(), ['local','remote']);
});

test('live hint makes the receiver read and merge a committed message immediately', async t => {
  const b = backend(t);
  await b.put('chat', 0, {messages:[]});
  const c = client(t, b.dispatch, 'b'); c.api.watch(); await tick();
  assert.equal(b.rooms.get('chat').changeWaiters.size, 1);
  const began = performance.now();
  await b.put('chat', 1, {messages:[{id:'live', author:'a', text:'hello', updatedAt:Date.now()}]});
  for (let i=0; i<50 && !c.state.messages.length; i++) await tick();
  assert.equal(c.state.messages[0].id, 'live');
  assert.equal(c.state.settings.room.lastRev, 2);
  const elapsed = Math.round(performance.now()-began);
  t.diagnostic(`Local SQLite + actual frontend receive path: ${elapsed} ms (not an Internet latency measurement)`);
  assert.ok(elapsed < 2500);
});

test('failed delivery reconnects from the applied revision, not the notification revision', async t => {
  const b = backend(t);
  await b.put('chat', 0, {messages:[]});
  let offline = true;
  const c = client(t, (url, init) => {
    if (!init?.method && offline) return Promise.reject(new Error('offline'));
    return b.dispatch(url, init);
  });
  c.api.watch(); await tick();
  await b.put('chat', 1, {messages:[{id:'missed',author:'a',updatedAt:1}]});
  for(let i=0;i<30 && ![...c.timers.values()].some(x=>x.ms===1000);i++) await tick();
  assert.equal(c.state.settings.room.lastRev, 1);
  assert.equal(c.api.healthy(), 0);
  offline=false; await c.runTimer(1000);
  assert.equal(c.state.messages[0].id, 'missed');
  const requests=c.calls.filter(x=>x.url.endsWith('/changes'));
  assert.deepEqual(requests.map(x=>JSON.parse(x.init.body).since), [1,1]);
});

test('unsupported watch endpoint retains polling and retries without a busy loop', async t => {
  const c = client(t, () => Promise.resolve(new Response('{}',{status:404})));
  c.api.startPolling();
  for(let i=0;i<10;i++) await tick();
  assert.equal(c.api.healthy(), 0);
  assert.ok([...c.timers.values()].some(x=>x.ms===60000));
  assert.ok([...c.timers.values()].some(x=>x.ms===3000));
  assert.equal(c.calls.filter(x=>x.url.endsWith('/changes')).length, 1);
});

test('hidden pages do not subscribe and switching rooms cancels the previous watch', async t => {
  let release;
  const c=client(t, () => new Promise(resolve=>release=resolve));
  c.context.document.hidden=true; c.api.watch();
  assert.equal(c.calls.length,0);
  c.context.document.hidden=false; c.api.watch();
  const signal=c.calls[0].init.signal;
  c.api.switchRoom('different');
  assert.equal(signal.aborted,true);
  release(new Response(JSON.stringify({ok:true,rev:999})));
  await tick();
  assert.equal(c.calls.length,1);
  assert.equal(c.state.settings.room.lastRev,1);
  assert.equal(c.timers.size,0);
});

test('healthy live connections suppress redundant full snapshot polling', async t => {
  const b=backend(t);
  await b.put('chat',0,{messages:[]});
  const c=client(t,b.dispatch);
  c.state.settings.room.lastRev=0;
  c.api.startPolling();
  for(let i=0;i<20;i++) await tick();
  assert.ok(c.api.healthy()>0);
  const before=c.calls.filter(x=>!x.init?.method).length;
  await c.runTimer(3000);
  assert.equal(c.calls.filter(x=>!x.init?.method).length,before);
});

test('a stale snapshot cannot roll back the applied revision', async t => {
  const c=client(t, () => Promise.resolve(new Response(JSON.stringify({ok:true,rev:1,data:{messages:[]}}))));
  c.state.settings.room.lastRev=2;
  c.state.messages.push({id:'keep',author:'b',updatedAt:1});
  await c.api.poll();
  assert.equal(c.state.settings.room.lastRev,2);
  assert.equal(c.state.messages[0].id,'keep');
});

test('failed queued sends retain messages and back off instead of repeatedly uploading', async t => {
  const b=backend(t);
  await b.put('chat',0,{messages:[]});
  let release, entered, puts=0;
  const started=new Promise(resolve=>entered=resolve);
  const gate=new Promise(resolve=>release=resolve);
  const c=client(t,async(url,init)=>{
    if(init?.method==='PUT'){ puts++; entered(); await gate; throw new Error('offline'); }
    return b.dispatch(url,init);
  });
  c.api.add('first'); const sending=c.api.push(); await started;
  c.api.add('second'); c.api.push({queueIfBusy:true});
  release(); assert.equal(await sending,false);
  assert.equal(puts,1);
  assert.deepEqual(clone(c.state.settings.room.pendingMessageIds),['first','second']);
  assert.ok([...c.timers.values()].some(x=>x.ms===5000));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const projectRoot = resolve(__dirname, '..', '..');
const musicSources = [
  'features/music/music-data.js',
  'features/music/music-state.js',
  'features/music/music-recommend.js'
].map(file => readFileSync(resolve(projectRoot, file), 'utf8'));

function createHarness(initialSettings = {}) {
  let today = '2026-08-17';
  let now = Date.parse('2026-08-17T09:00:00+08:00');
  let saveCount = 0;

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() { return now; }
  }

  const context = {
    Date: FakeDate,
    Math,
    JSON,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    RegExp,
    encodeURIComponent
  };
  context.window = context;
  vm.createContext(context);
  musicSources.forEach(source => vm.runInContext(source, context));

  const state = { settings: initialSettings, _weather: { code: 0 } };
  const save = () => { saveCount += 1; };
  context.PufferMusicState.configure({ getState: () => state, todayKey: () => today, save });
  context.PufferMusicRecommend.configure({ getState: () => state, todayKey: () => today, save });

  return {
    state,
    data: context.PufferMusicData,
    musicState: context.PufferMusicState,
    recommend: context.PufferMusicRecommend,
    setDate(nextDate, nextNow) {
      today = nextDate;
      if (nextNow) now = Date.parse(nextNow);
    },
    saveCount: () => saveCount
  };
}

function keepOnlySong(harness, predicate) {
  const library = harness.data.MUSIC_LIBRARY;
  const song = library.find(predicate);
  assert.ok(song, 'test song should exist in the real music library');
  library.splice(0, library.length, song);
  return song;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('换一首只排除当前日期、时段和来源，并立即换到不同歌曲', () => {
  const harness = createHarness();
  const source = '你们的网易云歌单';
  const slotKey = harness.recommend.musicSlotKey('morning', source);
  const first = harness.recommend.getMusicSlotSong('morning', source);
  const firstKey = harness.recommend.musicSongKey(first);

  assert.equal(harness.recommend.recordFeedback(firstKey, 'dislike', slotKey), true);
  const second = harness.recommend.getMusicSlotSong('morning', source);

  assert.ok(second);
  assert.notEqual(harness.recommend.musicSongKey(second), firstKey);
  assert.deepEqual(plain(harness.musicState.getRejectedForSlot(slotKey)), [firstKey]);
  assert.equal(harness.state.settings._musicLikes[firstKey], -1);
  assert.equal(Object.prototype.hasOwnProperty.call(harness.state.settings, '_musicRejectedForSlot'), false);
});

test('临时排除不会跨时段或跨日期生效', () => {
  const harness = createHarness();
  const source = '你们的网易云歌单';
  const onlySong = keepOnlySong(harness, song => song.source === source);
  const onlyKey = harness.recommend.musicSongKey(onlySong);
  const morningSlot = harness.recommend.musicSlotKey('morning', source);

  assert.equal(harness.recommend.musicSongKey(harness.recommend.getMusicSlotSong('morning', source)), onlyKey);
  harness.recommend.recordFeedback(onlyKey, 'dislike', morningSlot);
  assert.equal(harness.recommend.getMusicSlotSong('morning', source), null);
  assert.equal(harness.recommend.musicSongKey(harness.recommend.getMusicSlotSong('noon', source)), onlyKey);

  harness.setDate('2026-08-18', '2026-08-18T09:00:00+08:00');
  assert.equal(harness.recommend.musicSongKey(harness.recommend.getMusicSlotSong('morning', source)), onlyKey);
});

test('不再推荐会永久屏蔽所有时段和后续日期', () => {
  const harness = createHarness();
  const source = '你们的网易云歌单';
  const onlySong = keepOnlySong(harness, song => song.source === source);
  const onlyKey = harness.recommend.musicSongKey(onlySong);
  const morningSlot = harness.recommend.musicSlotKey('morning', source);

  harness.recommend.getMusicSlotSong('morning', source);
  assert.equal(harness.recommend.recordFeedback(onlyKey, 'block', morningSlot), true);
  assert.equal(harness.recommend.getMusicSlotSong('night', source), null);

  harness.setDate('2026-09-17', '2026-09-17T21:00:00+08:00');
  assert.equal(harness.recommend.getMusicSlotSong('night', source), null);
  assert.equal(harness.state.settings._musicBlocked[onlyKey], true);
});

test('旧版全局换歌数据会清除，不再造成长期排除', () => {
  const harness = createHarness();
  const source = '你们的网易云歌单';
  const onlySong = keepOnlySong(harness, song => song.source === source);
  const onlyKey = harness.recommend.musicSongKey(onlySong);
  harness.state.settings._musicRejectedForSlot = [onlyKey];

  const selected = harness.recommend.getMusicSlotSong('morning', source);

  assert.equal(harness.recommend.musicSongKey(selected), onlyKey);
  assert.equal(Object.prototype.hasOwnProperty.call(harness.state.settings, '_musicRejectedForSlot'), false);
  assert.ok(harness.saveCount() > 0);
});

test('音乐临时排除和推荐缓存只保留最近十四个自然日', () => {
  const harness = createHarness({
    _musicRejectedForSlot: ['legacy-song'],
    _musicRejectedBySlot: {
      '2026-08-17:morning:all': ['current-song'],
      '2026-08-04:night:all': ['boundary-song'],
      '2026-08-03:night:all': ['expired-song'],
      malformed: ['invalid-song']
    },
    _musicSlotSongKeys: {
      '2026-08-17:morning:all': 'current-song',
      '2026-08-04:night:all': 'boundary-song',
      '2026-08-03:night:all': 'expired-song',
      malformed: 'invalid-song'
    }
  });

  assert.equal(harness.musicState.cleanupMusicCaches('2026-08-17'), true);
  assert.deepEqual(Object.keys(harness.state.settings._musicRejectedBySlot).sort(), [
    '2026-08-04:night:all',
    '2026-08-17:morning:all'
  ]);
  assert.deepEqual(Object.keys(harness.state.settings._musicSlotSongKeys).sort(), [
    '2026-08-04:night:all',
    '2026-08-17:morning:all'
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(harness.state.settings, '_musicRejectedForSlot'), false);
});

test('同一推荐槽位的临时排除有数量上限', () => {
  const harness = createHarness();
  const slotKey = harness.recommend.musicSlotKey('morning', 'test-source');

  for (let index = 0; index < 60; index += 1) {
    harness.musicState.recordFeedback('song-' + index, 'dislike', slotKey);
  }

  const rejected = plain(harness.musicState.getRejectedForSlot(slotKey));
  assert.equal(rejected.length, 50);
  assert.equal(rejected[0], 'song-10');
  assert.equal(rejected.at(-1), 'song-59');
});

test('首页反馈事件只调用公开音乐接口，不再访问模块私有缓存', () => {
  const appSource = readFileSync(resolve(projectRoot, 'app.js'), 'utf8');
  assert.match(appSource, /MusicRecommend\.recordFeedback\(key, action, slotKey\)/);
  assert.match(appSource, /data-music-slot-key=/);
  assert.doesNotMatch(appSource, /\bmusicSlotCache\b/);
  assert.doesNotMatch(appSource, /_musicRejectedForSlot/);
});

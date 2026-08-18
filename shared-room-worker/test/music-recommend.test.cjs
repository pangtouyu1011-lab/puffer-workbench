const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const projectRoot = resolve(__dirname, '..', '..');
const musicSources = [
  'features/music/music-apple-data.js',
  'features/music/music-netease-data.js',
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
    apple: context.PufferApplePlaylistData,
    netease: context.PufferNeteasePlaylistData,
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

test('推荐历史保留三十天用于长期降权并清除更早记录', () => {
  const dayOne = Date.parse('2026-08-01T09:00:00+08:00');
  const dayTen = Date.parse('2026-08-10T09:00:00+08:00');
  const harness = createHarness({
    _musicHistory: [
      { key: 'recent-song', title: '近期歌曲', artist: '测试', ts: dayOne },
      { key: 'expired-song', title: '过期歌曲', artist: '测试', ts: Date.parse('2026-07-10T09:00:00+08:00') }
    ]
  });
  harness.setDate('2026-08-10', '2026-08-10T09:00:00+08:00');

  harness.recommend.getMusicSlotSong('morning', '你们的网易云歌单');

  const keys = harness.state.settings._musicHistory.map(item => item.key);
  assert.ok(keys.includes('recent-song'));
  assert.ok(!keys.includes('expired-song'));
  assert.ok(harness.state.settings._musicHistory.some(item => item.ts === dayTen));
});

test('网易云公开歌单快照完整进入本地曲库且全部使用歌曲直达链接', () => {
  const harness = createHarness();
  const playlist = harness.netease;
  const songs = harness.data.MUSIC_LIBRARY.filter(song => song.source === '你们的网易云歌单');

  assert.equal(playlist.playlistId, '162638755');
  assert.equal(playlist.playlistName, '别来吵我了喜欢的音乐');
  assert.equal(playlist.trackCount, 1594);
  assert.equal(songs.length, playlist.trackCount);
  assert.equal(new Set(songs.map(song => song.id)).size, songs.length);
  assert.ok(songs.every(song => song.playlistOwned === true));
  assert.ok(songs.every(song => song.url === 'https://music.163.com/song?id=' + encodeURIComponent(song.id)));
  assert.ok(songs.every(song => ['morning', 'noon', 'night'].some(tag => song.tags.includes(tag))));
});

test('网易云旧版推荐键保持稳定，新增歌曲使用平台 ID 键', () => {
  const harness = createHarness();
  const source = '你们的网易云歌单';
  const curated = harness.data.MUSIC_LIBRARY.find(song => song.id === '3410254626');
  const restored = harness.data.MUSIC_LIBRARY.find(song => song.id === '3412604617');

  assert.equal(harness.recommend.musicSongKey(curated), source + ':SASIOVERLXRD:雨瘾');
  assert.equal(harness.recommend.musicSongKey(restored), source + ':3412604617');
  assert.equal(restored.tagSource, 'stable-v1');
  assert.deepEqual(plain(restored.tags), ['morning', 'sun', 'clear', 'happy', 'workweek']);
});

test('Apple Music 公开歌单快照完整进入本地曲库并保留歌曲直达链接', () => {
  const harness = createHarness();
  const playlist = harness.apple;
  const songs = harness.data.MUSIC_LIBRARY.filter(song => song.source === '你们的 Apple Music 歌单');
  const playlistSongs = songs.filter(song => song.playlistOwned === true);

  assert.equal(playlist.playlistId, 'pl.u-Zmblxd1CVM8G4d6');
  assert.equal(playlist.playlistName, '🫠');
  assert.equal(playlist.trackCount, 300);
  assert.equal(playlist.catalogMetadataCount, playlist.trackCount);
  assert.equal(playlistSongs.length, playlist.trackCount);
  assert.equal(new Set(playlistSongs.map(song => song.id)).size, playlistSongs.length);
  assert.ok(playlistSongs.every(song => /^https:\/\/music\.apple\.com\/cn\/(?:album|music-video)\//.test(song.url)));
  assert.ok(playlistSongs.every(song => song.catalogGenre));
  assert.ok(playlistSongs.every(song => ['morning', 'noon', 'night'].some(tag => song.tags.includes(tag))));
});

test('Apple Music 旧版推荐键保持稳定且已移出歌单的旧歌仍然可用', () => {
  const harness = createHarness();
  const source = '你们的 Apple Music 歌单';
  const idSong = harness.data.MUSIC_LIBRARY.find(song => song.id === '1443638095' && song.source === source);
  const restoredIdSong = harness.data.MUSIC_LIBRARY.find(song => song.title === '红豆' && song.artist === '方大同' && song.source === source);
  const legacySong = harness.data.MUSIC_LIBRARY.find(song => song.id === '200473135' && song.source === source);

  assert.equal(harness.recommend.musicSongKey(idSong), source + ':1443638095');
  assert.ok(restoredIdSong.id);
  assert.equal(harness.recommend.musicSongKey(restoredIdSong), source + ':方大同:红豆');
  assert.equal(legacySong.playlistOwned, false);
  assert.equal(harness.recommend.musicSongKey(legacySong), source + ':200473135');
});

test('新增曲目使用唯一键生成稳定且完整的推荐标签', () => {
  const harness = createHarness();
  const autoTagged = harness.data.MUSIC_LIBRARY.filter(song => song.tagSource === harness.data.MUSIC_TAG_VERSION);
  const validTags = new Set(['morning','noon','night','sun','clear','cloud','rain','happy','warm','soft','slow','tired','weekend','friday','workweek','indie','emotional','experimental','rap']);
  const timeTags = new Set(['morning', 'noon', 'night']);
  const weatherTags = new Set(['sun', 'cloud', 'rain']);

  assert.equal(harness.data.MUSIC_TAG_VERSION, 'stable-v1');
  assert.equal(autoTagged.length, 1827);
  autoTagged.forEach(song => {
    assert.equal(new Set(song.tags).size, song.tags.length, `${song.id} has duplicate tags`);
    assert.ok(song.tags.every(tag => validTags.has(tag)), `${song.id} has an unknown tag`);
    assert.equal(song.tags.filter(tag => timeTags.has(tag)).length, 1, `${song.id} needs one stable daypart`);
    assert.ok(song.tags.some(tag => weatherTags.has(tag)), `${song.id} needs a stable weather group`);
  });

  const appleSong = autoTagged.find(song => song.id === '536162088');
  const neteaseSong = autoTagged.find(song => song.id === '3412604617');
  assert.deepEqual(plain(appleSong.tags), ['night', 'sun', 'clear', 'soft', 'friday']);
  assert.deepEqual(plain(neteaseSong.tags), ['morning', 'sun', 'clear', 'happy', 'workweek']);
  assert.deepEqual(
    plain(harness.data.stableMusicTags({ id:appleSong.id, title:appleSong.title, artist:appleSong.artist, genre:appleSong.catalogGenre, source:appleSong.source })),
    plain(appleSong.tags)
  );
});

test('新增 Apple 与网易云曲目确实进入各自推荐池', () => {
  const harness = createHarness();
  const sources = ['你们的 Apple Music 歌单', '你们的网易云歌单'];
  const selectedBySource = new Map(sources.map(source => [source, []]));
  const weatherCodes = [0, 3, 61, 71];

  for (let offset = 0; offset < 35; offset += 1) {
    const date = new Date(Date.UTC(2026, 7, 1 + offset)).toISOString().slice(0, 10);
    harness.setDate(date, `${date}T09:00:00+08:00`);
    harness.state._weather.code = weatherCodes[offset % weatherCodes.length];
    for (const source of sources) {
      for (const part of ['morning', 'noon', 'night']) {
        const song = harness.recommend.getMusicSlotSong(part, source);
        assert.ok(song, `${source} should return a recommendation`);
        assert.equal(song.source, source);
        selectedBySource.get(source).push(song);
      }
    }
  }

  sources.forEach(source => {
    const selected = selectedBySource.get(source);
    assert.ok(selected.some(song => song.tagSource === 'stable-v1'), `${source} should recommend restored songs`);
    assert.ok(new Set(selected.map(song => harness.recommend.musicSongKey(song))).size >= 20, `${source} should rotate through the expanded library`);
  });
});

test('推荐同分打散只依赖歌曲唯一键，不受曲库排列顺序影响', () => {
  const source = '你们的 Apple Music 歌单';
  const forward = createHarness();
  const forwardSong = forward.recommend.pickMusicFor('morning', new Set(), source)[0];
  const reversed = createHarness();
  reversed.data.MUSIC_LIBRARY.reverse();
  const reversedSong = reversed.recommend.pickMusicFor('morning', new Set(), source)[0];

  assert.equal(reversed.recommend.musicSongKey(reversedSong), forward.recommend.musicSongKey(forwardSong));
});

test('首页反馈事件只调用公开音乐接口，不再访问模块私有缓存', () => {
  const appSource = readFileSync(resolve(projectRoot, 'app.js'), 'utf8');
  assert.match(appSource, /MusicRecommend\.recordFeedback\(key, action, slotKey\)/);
  assert.match(appSource, /data-music-slot-key=/);
  assert.doesNotMatch(appSource, /\bmusicSlotCache\b/);
  assert.doesNotMatch(appSource, /_musicRejectedForSlot/);
});

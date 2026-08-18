// Static music data layer. Loaded before app.js by index.html.
(function () {
  'use strict';

  const APPLE_PLAYLIST_URL = 'https://music.apple.com/cn/playlist/pl.u-Zmblxd1CVM8G4d6';
  const NETEASE_PLAYLIST_URL = 'https://music.163.com/playlist?id=162638755';
  const musicLink = (id) => id ? 'https://music.apple.com/cn/song/' + id : APPLE_PLAYLIST_URL;
  const musicSearch = (query) => 'https://music.apple.com/cn/search?term=' + encodeURIComponent(query);
  const NETEASE_PROFILE_TAGS = ['rain','night','tired','indie','rap','experimental','emotional'];
  const APPLE_PROFILE_TAGS = ['morning','noon','sun','clear','happy','warm','soft','slow','weekend','workweek'];
  const MUSIC_TAG_VERSION = 'stable-v1';
  const TIME_TAGS = ['morning', 'noon', 'night'];
  const WEATHER_TAG_GROUPS = [['sun', 'clear'], ['cloud', 'soft'], ['rain', 'soft']];
  const WEEK_TAGS = ['workweek', 'weekend', 'friday'];
  const MUSIC_LYRICS = {
    '简单爱':'我想带你骑单车',
    '爱在西元前':'我给你的爱写在西元前',
    '水星记':'环游是无趣 至少可以陪着你',
    '轨迹':'我会发着呆 然后忘记你',
    '夏日漱石':'我想和你一起看夏日漱石',
    '一点点':'就让回忆永远停在那里',
    'Pink + White':'Inhale, in the morning',
    'Best Part':'You are the best part',
    '可惜没如果':'如果那两个字没有颤抖',
    '想自由':'我感到很疲倦',
    '山海':'我看着天真的我自己',
    '凄美地':'别让我的梦醒来',
    '爱人错过':'我肯定在几百年前就说过爱你',
    '小宇':'总有一天我会带你去看天荒地老',
    '开不了口':'我可以无所谓',
    '我不配':'这街上太拥挤',
    '黑色毛衣':'一件黑色毛衣',
    '退后':'天空灰得像哭过',
    '不能说的秘密':'最美的不是下雨天',
    '彩虹':'哪里有彩虹告诉我'
  };

  const NETEASE_SOURCE = '你们的网易云歌单';
  const APPLE_SOURCE = '你们的 Apple Music 歌单';
  function stableMusicHash(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function stableMusicTags(input = {}) {
    const id = String(input.id || '').trim();
    const title = String(input.title || '').trim();
    const artist = String(input.artist || '').trim();
    const genre = String(input.genre || '').trim();
    const source = String(input.source || '').trim();
    const text = `${title} ${artist} ${genre}`.toLowerCase();
    const hash = stableMusicHash(`${MUSIC_TAG_VERSION}|${source}|${id || `${artist}|${title}`}`);
    const tags = [];
    const add = (...values) => values.forEach(value => { if (value && !tags.includes(value)) tags.push(value); });
    const matches = pattern => pattern.test(text);
    const isRap = matches(/(?:hip[ -]?hop|rap|嘻哈|说唱)/i);
    const isAlternative = matches(/(?:alternative|indie|rock|punk|另类|独立|摇滚)/i);
    const isRnb = matches(/(?:r&b|rhythm and blues|soul|灵魂乐)/i);
    const isDance = matches(/(?:dance|electronic|afrobeat|k-pop|j-pop|舞曲|电子|非洲节奏)/i);
    const isQuietGenre = matches(/(?:soundtrack|ambient|classical|singer.songwriter|原声|氛围|古典|唱作歌手|音乐剧)/i);
    const rainTitle = matches(/(?:雨|rain|storm|umbrella|阴天)/i);
    const nightTitle = matches(/(?:夜|晚安|moon|midnight|night|星空)/i);
    const brightTitle = matches(/(?:夏|晴|阳光|太阳|summer|sun|dance|party|快乐|开心)/i);
    const tenderTitle = matches(/(?:爱|喜欢|想你|love|lover|heart|kiss|温柔|浪漫)/i);
    const sadTitle = matches(/(?:泪|哭|痛|孤独|离开|错过|遗憾|sad|cry|lonely|heartbreak)/i);

    if (nightTitle || rainTitle || sadTitle) add('night');
    else if (isDance || isRap) add(hash % 3 === 0 ? 'night' : 'noon');
    else if (isRnb || isQuietGenre) add(hash % 2 === 0 ? 'morning' : 'night');
    else add(TIME_TAGS[hash % TIME_TAGS.length]);

    if (rainTitle) add('rain', 'cloud', 'soft');
    else if (brightTitle || isDance) add('sun', 'clear', 'happy');
    else if (sadTitle) add('rain', 'tired', 'emotional', 'slow');
    else add(...WEATHER_TAG_GROUPS[(hash >>> 4) % WEATHER_TAG_GROUPS.length]);

    if (isRap) add('rap', (hash >>> 7) % 2 === 0 ? 'experimental' : 'happy');
    if (isAlternative) add('indie', 'experimental');
    if (isRnb) add('soft', 'warm', 'slow');
    if (isQuietGenre) add('soft', 'slow');
    if (tenderTitle) add('warm', 'soft');
    if (sadTitle) add('emotional', 'tired');
    if (!isRap && !isAlternative && !isRnb && !isDance && !isQuietGenre && !tenderTitle && !sadTitle) {
      add(['happy', 'warm', 'soft', 'slow', 'emotional'][(hash >>> 9) % 5]);
    }
    add(WEEK_TAGS[(hash >>> 12) % WEEK_TAGS.length]);
    return tags;
  }
  const NETEASE_CURATED = {
    '3410254626': { legacyTitle:'雨瘾', tags:['night','rain','indie','experimental','emotional','tired'] },
    '3410245671': { legacyTitle:'神选', tags:['night','cloud','rap','experimental','emotional'] },
    '3410240174': { legacyTitle:'蜈蚣', tags:['night','rap','indie','experimental'] },
    '3410228672': { legacyTitle:'我和我的现金', tags:['noon','friday','rap','happy'] },
    '2163619013': { legacyTitle:'焦虑Pt.2/膨胀', tags:['night','rain','rap','emotional','tired'] },
    '3392600720': { legacyTitle:'朦胧', tags:['night','cloud','indie','soft','emotional'] },
    '3382153689': { legacyTitle:'Whisper My Name', tags:['night','cloud','rap','soft'] },
    '3327562079': { legacyTitle:'Separation', tags:['night','rain','rap','tired'] },
    '3382153693': { legacyTitle:'National Treasures', tags:['night','rap','experimental'] },
    '3322064338': { legacyTitle:'Burnin\' Slowly', tags:['night','rain','soft','slow'] },
    '2754174752': { legacyTitle:'你给的恨', tags:['night','rain','rap','emotional'] },
    '3382908505': { legacyTitle:'玻璃', tags:['night','rain','soft','emotional'] },
    '3332893439': { legacyTitle:'在雨后醒来（升音Sound）', tags:['night','rain','soft','tired'] },
    '2718644892': { legacyTitle:'特大暴雨来了', tags:['night','rain','experimental','emotional'] },
    '3364284329': { legacyTitle:'ALL THE LOVE', tags:['night','cloud','rap','warm'] },
    '3334046872': { legacyTitle:'AOE (All Of Everything)', tags:['night','rap','experimental'] },
    '3364284333': { legacyTitle:'PREACHER MAN', tags:['night','cloud','rap','emotional'] },
    '2716372738': { legacyTitle:'4 Raws', tags:['night','rap','experimental'] },
    '3364284328': { legacyTitle:'FATHER', tags:['night','cloud','rap','emotional'] },
    '559647885': { legacyTitle:'Long Time (Intro)', tags:['night','cloud','rap','slow'] }
  };

  const neteaseRows = Array.isArray(window.PufferNeteasePlaylistData?.tracks)
    ? window.PufferNeteasePlaylistData.tracks
    : [];
  const NETEASE_LIBRARY = neteaseRows.map(row => {
    const [idValue, titleValue, artistValue] = Array.isArray(row) ? row : [];
    const id = String(idValue || '');
    const title = String(titleValue || '').trim();
    const artist = String(artistValue || '').trim();
    const curated = NETEASE_CURATED[id];
    const tags = curated ? [...curated.tags] : stableMusicTags({ id, title, artist, source:NETEASE_SOURCE });
    const song = {
      title,
      artist,
      id,
      tags,
      source: NETEASE_SOURCE,
      url: 'https://music.163.com/song?id=' + encodeURIComponent(id),
      playlistOwned: true,
      tagSource: curated ? 'curated' : MUSIC_TAG_VERSION
    };
    if (curated) {
      song.key = NETEASE_SOURCE + ':' + artist + ':' + curated.legacyTitle;
    }
    return song;
  }).filter(song => song.id && song.title && song.artist);

  const APPLE_CURATED = [
    { title:'简单爱', artist:'周杰伦', id:'535739351', tags:['morning','noon','sun','clear','happy','weekend','friday'] },
    { title:'特别的人', artist:'方大同', id:'1579903651', tags:['morning','noon','cloud','soft','warm','workweek'] },
    { title:'爱在西元前', artist:'周杰伦', id:'535739349', tags:['morning','sun','clear','happy','workweek'] },
    { title:'红豆', artist:'方大同', id:'', tags:['morning','noon','cloud','soft','slow','weekend'] },
    { title:'三人游', artist:'方大同', id:'', tags:['noon','cloud','soft','slow','weekend'] },
    { title:'水星记', artist:'郭顶', id:'1443638095', tags:['night','rain','cloud','soft','tired','slow'] },
    { title:'保留', artist:'郭顶', id:'1443638411', tags:['night','rain','cloud','soft','tired','workweek'] },
    { title:'轨迹', artist:'周杰伦', id:'536108122', tags:['night','rain','tired','slow','workweek'] },
    { title:'Letting Go', artist:'蔡健雅', id:'672994663', tags:['night','rain','tired','slow','cloud'] },
    { title:'心的距离', artist:'陈奕迅', id:'1442430114', tags:['night','rain','tired','slow'] },
    { title:'是但求其爱', artist:'陈奕迅', id:'1539122249', tags:['night','rain','cloud','soft','slow'] },
    { title:'i love you', artist:'Billie Eilish', id:'', tags:['night','rain','tired','soft','slow'] },
    { title:'夏日漱石', artist:'橘子海', id:'1460348282', tags:['morning','noon','sun','clear','weekend','happy'] },
    { title:'船', artist:'旅行团乐队', id:'1808643222', tags:['noon','sun','cloud','weekend','slow'] },
    { title:'芳草地', artist:'陈粒', id:'1421693327', tags:['morning','noon','cloud','soft','weekend'] },
    { title:'旅行中忘记', artist:'袁娅维', id:'942536325', tags:['noon','sun','clear','weekend','happy'] },
    { title:'一点点', artist:'周杰伦', id:'1118757870', tags:['noon','friday','sun','clear','happy'] },
    { title:'美人鱼', artist:'周杰伦', id:'', tags:['noon','friday','sun','clear','happy'] },
    { title:'浪漫手机', artist:'周杰伦', id:'', tags:['morning','friday','sun','happy','warm'] },
    { title:'Calm Down', artist:'Rema & Selena Gomez', id:'', tags:['noon','friday','sun','clear','happy'] },
    { title:'Show Me Love', artist:'WizTheMc & bees & honey', id:'', tags:['morning','friday','sun','happy'] },
    { title:'EYES, NOSE, LIPS', artist:'SOL (from BIGBANG)', id:'', tags:['night','friday','cloud','soft','warm'] },
    { title:'City of Stars', artist:'Ryan Gosling & 艾玛·斯通', id:'', tags:['night','cloud','soft','weekend','slow'] },
    { title:'Dear April (Side A - Acoustic)', artist:'Frank Ocean', id:'', tags:['night','rain','cloud','soft','slow'] },
    { title:'HEARTBREAK ANNIVERSARY', artist:'GIVĒON', id:'', tags:['night','rain','tired','slow'] },
    { title:'Melody', artist:'陶喆', id:'', tags:['morning','noon','cloud','soft','warm'] },
    { title:'流沙', artist:'陶喆', id:'', tags:['night','rain','soft','slow'] },
    { title:'同类', artist:'孙燕姿', id:'255921849', tags:['night','rain','tired','slow'] },
    { title:'我怀念的', artist:'孙燕姿', id:'', tags:['night','rain','tired','slow'] },
    { title:'开不了口', artist:'周杰伦', id:'535739353', tags:['night','rain','emotional','tired'] },
    { title:'我不配', artist:'周杰伦', id:'536030699', tags:['night','rain','emotional','slow'] },
    { title:'黑色毛衣', artist:'周杰伦', id:'536009645', tags:['night','rain','emotional','slow'] },
    { title:'退后', artist:'周杰伦', id:'536285261', tags:['night','rain','emotional','tired'] },
    { title:'不能说的秘密', artist:'周杰伦', id:'1624051288', tags:['night','rain','emotional','slow'] },
    { title:'彩虹', artist:'周杰伦', id:'536030694', tags:['night','rain','emotional','soft'] },
    { title:'等你下课', artist:'周杰伦', id:'1336404847', tags:['noon','sun','warm','happy'] },
    { title:'爱爱爱', artist:'方大同', id:'220365871', tags:['noon','sun','soft','warm'] },
    { title:'黑白', artist:'周杰伦', id:'313404810', tags:['night','cloud','soft','slow'] },
    { title:'不为谁而作的歌', artist:'林俊杰', id:'1871400637', tags:['night','cloud','emotional'] },
    { title:'关键词', artist:'林俊杰', id:'1871400641', tags:['night','cloud','soft','warm'] },
    { title:'她说', artist:'林俊杰', id:'1071506929', tags:['night','rain','emotional','slow'] },
    { title:'我不难过', artist:'孙燕姿', id:'255921025', tags:['night','rain','emotional','tired'] },
    { title:'尚好的青春', artist:'孙燕姿', id:'1443147422', tags:['noon','sun','warm','soft'] },
    { title:'小半', artist:'陈粒', id:'1421693331', tags:['night','cloud','indie','soft','emotional'] },
    { title:'虚拟', artist:'陈粒', id:'1421693767', tags:['night','cloud','indie','soft','slow'] },
    { title:'飞机场的10:30', artist:'陈绮贞', id:'1416149929', tags:['noon','sun','soft','warm'] },
    { title:'爱请问怎么走', artist:'莫文蔚', id:'930758244', tags:['night','rain','emotional','slow'] },
    { title:'阴天', artist:'莫文蔚', id:'200473135', tags:['night','cloud','soft','emotional','slow'] },
    { title:'无人知晓的我', artist:'A-Lin', id:'1281542262', tags:['night','cloud','emotional','soft'] }
  ];

  const appleSignature = (title, artist) => String(title || '').trim().toLocaleLowerCase() + '\u0000' + String(artist || '').trim().toLocaleLowerCase();
  const appleCuratedById = new Map(APPLE_CURATED.filter(song => song.id).map(song => [String(song.id), song]));
  const appleCuratedBySignature = new Map(APPLE_CURATED.map(song => [appleSignature(song.title, song.artist), song]));
  const appleRows = Array.isArray(window.PufferApplePlaylistData?.tracks)
    ? window.PufferApplePlaylistData.tracks
    : [];
  const APPLE_PLAYLIST_LIBRARY = appleRows.map(row => {
    const [idValue, titleValue, artistValue, urlValue, genreValue, releaseYearValue] = Array.isArray(row) ? row : [];
    const id = String(idValue || '').trim();
    const title = String(titleValue || '').trim();
    const artist = String(artistValue || '').trim();
    const genre = String(genreValue || '').trim();
    const releaseYear = Number(releaseYearValue) || 0;
    const curated = appleCuratedById.get(id) || appleCuratedBySignature.get(appleSignature(title, artist));
    const song = {
      title,
      artist,
      id,
      tags: curated ? [...curated.tags] : stableMusicTags({ id, title, artist, genre, source:APPLE_SOURCE }),
      source: APPLE_SOURCE,
      url: String(urlValue || '').trim() || musicLink(id),
      playlistOwned: true,
      catalogGenre: genre,
      releaseYear,
      tagSource: curated ? 'curated' : MUSIC_TAG_VERSION
    };
    // Several legacy rows had no Apple ID. Preserve those saved feedback keys
    // even though the complete playlist snapshot can now supply an ID.
    if (curated && !curated.id) song.key = APPLE_SOURCE + ':' + curated.artist + ':' + curated.title;
    return song;
  }).filter(song => song.id && song.title && song.artist);
  const applePlaylistIds = new Set(APPLE_PLAYLIST_LIBRARY.map(song => song.id));
  const applePlaylistSignatures = new Set(APPLE_PLAYLIST_LIBRARY.map(song => appleSignature(song.title, song.artist)));
  const APPLE_LEGACY_LIBRARY = APPLE_CURATED.filter(song =>
    !(song.id && applePlaylistIds.has(String(song.id))) &&
    !applePlaylistSignatures.has(appleSignature(song.title, song.artist))
  ).map(song => ({ ...song, source: APPLE_SOURCE, url: musicLink(song.id), playlistOwned: false, tagSource:'curated' }));
  const APPLE_LIBRARY = APPLE_PLAYLIST_LIBRARY.concat(APPLE_LEGACY_LIBRARY);

  const MUSIC_LIBRARY = APPLE_LIBRARY.concat(NETEASE_LIBRARY, [
    { title:'Pink + White', artist:'Frank Ocean', tags:['morning','sun','soft','warm','indie'], source:'相似推荐', url:musicSearch('Frank Ocean Pink White') },
    { title:'Best Part', artist:'Daniel Caesar feat. H.E.R.', tags:['morning','noon','cloud','warm','slow'], source:'相似推荐', url:musicSearch('Daniel Caesar Best Part') },
    { title:'可惜没如果', artist:'林俊杰', tags:['night','rain','tired','emotional'], source:'相似推荐', url:musicSearch('林俊杰 可惜没如果') },
    { title:'浪漫血液', artist:'林俊杰', tags:['night','cloud','emotional','soft'], source:'相似推荐', url:musicSearch('林俊杰 浪漫血液') },
    { title:'想自由', artist:'林宥嘉', tags:['night','rain','tired','emotional'], source:'相似推荐', url:musicSearch('林宥嘉 想自由') },
    { title:'山海', artist:'草东没有派对', tags:['night','rain','indie','experimental','emotional'], source:'相似推荐', url:musicSearch('草东没有派对 山海') },
    { title:'凄美地', artist:'郭顶', tags:['night','rain','indie','emotional','tired'], source:'相似推荐', url:musicSearch('郭顶 凄美地') },
    { title:'爱人错过', artist:'告五人', tags:['noon','friday','sun','indie','happy'], source:'相似推荐', url:musicSearch('告五人 爱人错过') },
    { title:'小宇', artist:'张震岳', tags:['morning','noon','sun','warm','weekend'], source:'相似推荐', url:musicSearch('张震岳 小宇') },
    { title:'Lover Is a Day', artist:'Cuco', tags:['night','cloud','indie','soft','slow'], source:'相似推荐', url:musicSearch('Cuco Lover Is a Day') },
    { title:'Snooze', artist:'SZA', tags:['night','rain','soft','warm'], source:'相似推荐', url:musicSearch('SZA Snooze') }
  ]);

  // Structured profiles are additive. Keep the legacy `tags` array intact so
  // the current recommendation engine and saved preferences remain unchanged.
  const CORE_MUSIC_PROFILES = {
    '535739351': { genre: ['华语', '流行'], mood: ['青春', '浪漫', '轻松'], scene: ['散步', '约会', '周末'], energy: 'medium' },
    '1579903651': { genre: ['华语', 'R&B'], mood: ['温柔', '浪漫', '治愈'], scene: ['夜晚', '约会', '睡前'], energy: 'low' },
    '535739349': { genre: ['华语', '流行'], mood: ['怀念', '浪漫', '叙事'], scene: ['通勤', '散步', '周末'], energy: 'medium' },
    '1443638095': { genre: ['华语', '独立音乐'], mood: ['安静', '怀念', '治愈'], scene: ['夜晚', '下雨天', '睡前'], energy: 'low' },
    '1443638411': { genre: ['华语', '独立音乐'], mood: ['安静', '温柔', '治愈'], scene: ['夜晚', '下雨天', '睡前'], energy: 'low' },
    '536108122': { genre: ['华语', '流行'], mood: ['怀念', '安静', '孤独'], scene: ['夜晚', '下雨天', '通勤'], energy: 'low' },
    '672994663': { genre: ['华语', '流行'], mood: ['安静', '怀念', '治愈'], scene: ['夜晚', '下雨天', '睡前'], energy: 'low' },
    '1442430114': { genre: ['华语', '流行'], mood: ['怀念', '安静', '孤独'], scene: ['夜晚', '下雨天', '睡前'], energy: 'low' },
    '1539122249': { genre: ['华语', '流行'], mood: ['温柔', '浪漫', '安静'], scene: ['夜晚', '约会', '睡前'], energy: 'low' },
    '1460348282': { genre: ['华语', '独立音乐'], mood: ['轻松', '开心', '释放'], scene: ['旅行', '周末', '出门'], energy: 'high' },
    '1808643222': { genre: ['华语', '独立乐队'], mood: ['轻松', '自由', '治愈'], scene: ['旅行', '散步', '周末'], energy: 'medium' },
    '1421693327': { genre: ['华语', '独立音乐'], mood: ['温柔', '安静', '治愈'], scene: ['早晨', '散步', '周末'], energy: 'low' },
    '942536325': { genre: ['华语', '独立乐队'], mood: ['轻松', '开心', '释放'], scene: ['旅行', '周末', '出门'], energy: 'high' },
    '1118757870': { genre: ['华语', '流行'], mood: ['轻松', '浪漫', '开心'], scene: ['下午', '散步', '约会'], energy: 'medium' },
    '535739353': { genre: ['华语', '流行'], mood: ['怀念', '安静', '孤独'], scene: ['夜晚', '下雨天', '睡前'], energy: 'low' },
    '255921849': { genre: ['华语', '流行'], mood: ['安静', '怀念', '治愈'], scene: ['夜晚', '下雨天', '睡前'], energy: 'low' },
    '255921025': { genre: ['华语', '流行'], mood: ['怀念', '安静', '治愈'], scene: ['夜晚', '下雨天', '睡前'], energy: 'low' },
    '1443147422': { genre: ['华语', '流行'], mood: ['温柔', '青春', '治愈'], scene: ['早晨', '通勤', '周末'], energy: 'low' },
    '1421693331': { genre: ['华语', '独立音乐'], mood: ['安静', '怀念', '浪漫'], scene: ['夜晚', '散步', '约会'], energy: 'low' },
    '1421693767': { genre: ['华语', '独立音乐'], mood: ['安静', '孤独', '治愈'], scene: ['夜晚', '下雨天', '睡前'], energy: 'low' },
    'title:Pink + White|artist:Frank Ocean': { genre: ['欧美', 'R&B'], mood: ['温柔', '轻松', '浪漫'], scene: ['早晨', '旅行', '周末'], energy: 'medium' },
    'title:Best Part|artist:Daniel Caesar feat. H.E.R.': { genre: ['欧美', 'R&B'], mood: ['浪漫', '温柔', '治愈'], scene: ['约会', '夜晚', '睡前'], energy: 'low' },
    'title:Snooze|artist:SZA': { genre: ['欧美', 'R&B'], mood: ['温柔', '浪漫', '轻松'], scene: ['夜晚', '约会', '睡前'], energy: 'low' }
  };

  MUSIC_LIBRARY.forEach(song => {
    const key = song.id ? song.id : 'title:' + song.title + '|artist:' + song.artist;
    if (CORE_MUSIC_PROFILES[key]) song.profile = CORE_MUSIC_PROFILES[key];
  });

  // ==========================================
  // 1. 状态与数据
  // ==========================================

  window.PufferMusicData = {
    APPLE_PLAYLIST_URL,
    NETEASE_PLAYLIST_URL,
    NETEASE_PROFILE_TAGS,
    APPLE_PROFILE_TAGS,
    MUSIC_TAG_VERSION,
    MUSIC_LYRICS,
    MUSIC_LIBRARY,
    stableMusicTags
  };
})();

// Static music data layer. Loaded before app.js by index.html.
(function () {
  'use strict';

  const APPLE_PLAYLIST_URL = 'https://music.apple.com/cn/playlist/pl.u-Zmblxd1CVM8G4d6';
  const NETEASE_PLAYLIST_URL = 'https://music.163.com/playlist?id=162638755';
  const musicLink = (id) => id ? 'https://music.apple.com/cn/song/' + id : APPLE_PLAYLIST_URL;
  const musicSearch = (query) => 'https://music.apple.com/cn/search?term=' + encodeURIComponent(query);
  const NETEASE_PROFILE_TAGS = ['rain','night','tired','indie','rap','experimental','emotional'];
  const APPLE_PROFILE_TAGS = ['morning','noon','sun','clear','happy','warm','soft','slow','weekend','workweek'];
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
  const MUSIC_LIBRARY = [
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
  ].map(song => ({ ...song, source: '你们的 Apple Music 歌单', url: musicLink(song.id) })).concat([
    { title:'雨瘾', artist:'SASIOVERLXRD', tags:['night','rain','indie','experimental','emotional','tired'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3410254626' },
    { title:'神选', artist:'SASIOVERLXRD', tags:['night','cloud','rap','experimental','emotional'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3410245671' },
    { title:'蜈蚣', artist:'SASIOVERLXRD', tags:['night','rap','indie','experimental'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3410240174' },
    { title:'我和我的现金', artist:'SASIOVERLXRD', tags:['noon','friday','rap','happy'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3410228672' },
    { title:'焦虑Pt.2/膨胀', artist:'艾志恒Asen', tags:['night','rain','rap','emotional','tired'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=2163619013' },
    { title:'朦胧', artist:'skiboyvv / rubenmccarter', id:'', tags:['night','cloud','indie','soft','emotional'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3392600720' },
    { title:'Whisper My Name', artist:'Drake', id:'', tags:['night','cloud','rap','soft'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3382153689' },
    { title:'Separation', artist:'Westwood / onlywoke', id:'', tags:['night','rain','rap','tired'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3327562079' },
    { title:'National Treasures', artist:'Drake', id:'', tags:['night','rap','experimental'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3382153693' },
    { title:'Burnin\' Slowly', artist:'黄格雷 / THOME', id:'', tags:['night','rain','soft','slow'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3322064338' },
    { title:'你给的恨', artist:'艾志恒Asen / Maikon Flocka Flame', id:'', tags:['night','rain','rap','emotional'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=2754174752' },
    { title:'玻璃', artist:'Gareth.T', id:'', tags:['night','rain','soft','emotional'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3382908505' },
    { title:'在雨后醒来（升音Sound）', artist:'Au', id:'', tags:['night','rain','soft','tired'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3332893439' },
    { title:'特大暴雨来了', artist:'二流', id:'', tags:['night','rain','experimental','emotional'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=2718644892' },
    { title:'ALL THE LOVE', artist:'Kanye West / Ye / Andre Troutman', id:'', tags:['night','cloud','rap','warm'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3364284329' },
    { title:'AOE (All Of Everything)', artist:'DD Ma Shawty', id:'', tags:['night','rap','experimental'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3334046872' },
    { title:'PREACHER MAN', artist:'Kanye West / Ye', id:'', tags:['night','cloud','rap','emotional'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3364284333' },
    { title:'4 Raws', artist:'EsDeeKid', id:'', tags:['night','rap','experimental'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=2716372738' },
    { title:'FATHER', artist:'Kanye West / Ye / Travis Scott', id:'', tags:['night','cloud','rap','emotional'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=3364284328' },
    { title:'Long Time (Intro)', artist:'Playboi Carti', id:'', tags:['night','cloud','rap','slow'], source:'你们的网易云歌单', url:'https://music.163.com/song?id=559647885' },
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
    MUSIC_LYRICS,
    MUSIC_LIBRARY
  };
})();

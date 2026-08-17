// Music recommendation logic. Product behavior is intentionally unchanged.
(function () {
  'use strict';
  const { NETEASE_PROFILE_TAGS, APPLE_PROFILE_TAGS, MUSIC_LIBRARY } = window.PufferMusicData;
  const MusicState = window.PufferMusicState;
  let ctx = null;
  const configure = (next) => { ctx = next; };

  const musicHash = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function currentMusicSlot() { const hour = new Date().getHours(); return hour >= 7 && hour < 12 ? 'morning' : (hour >= 12 && hour < 18 ? 'afternoon' : 'night'); }
  // Existing UI still uses `noon`; keep that return value until the UI migration.
  function currentMusicDaypart() { return currentMusicSlot() === 'afternoon' ? 'noon' : currentMusicSlot(); }
  function musicWeatherProfile() {
    const code = ctx.getState()._weather && ctx.getState()._weather.code;
    if ([51,53,55,61,63,65,80,81,82,95,96,99].includes(code)) return { label: '雨天', icon: '☂', tags: ['rain','soft','tired'], reason: '雨声适合把节奏放慢' };
    if ([71,73,75,85,86].includes(code)) return { label: '雪天', icon: '❄', tags: ['cloud','soft','slow'], reason: '冷空气里留一点温柔' };
    if (code === 0 || code === 1) return { label: '晴天', icon: '☀', tags: ['sun','clear','happy'], reason: '阳光给今天加一点能量' };
    return { label: '多云', icon: '☁', tags: ['cloud','soft','warm'], reason: '不急不慢，留一点呼吸感' };
  }
  function musicWeekProfile() {
    const day = new Date().getDay();
    if (day === 1) return { label: '低电量周一', tags: ['tired','slow'] };
    if (day === 5) return { label: '放假前的开心', tags: ['friday','happy'] };
    if (day === 0 || day === 6) return { label: '周末悠闲', tags: ['weekend','slow'] };
    return { label: '工作日慢慢进入状态', tags: ['workweek','warm'] };
  }
  function musicSongKey(song) { return (song.source || '') + ':' + (song.id || song.artist + ':' + song.title); }
  const musicSlotCache = new Map();
  function musicSettings() { return MusicState.getSettings(); }
  function musicSlotKey(part, sourceFilter, date) {
    return (date || ctx.todayKey()) + ':' + part + ':' + String(sourceFilter || 'all');
  }
  const PROFILE_TAG_MAP = {
    morning: ['早晨'], noon: ['下午'], night: ['夜晚'], rain: ['下雨天'],
    cloud: ['阴天'], sun: ['晴天'], clear: ['晴天'], happy: ['开心', '轻松'],
    warm: ['温柔'], soft: ['温柔'], slow: ['安静'], tired: ['安静'],
    weekend: ['周末'], friday: ['周末'], workweek: ['通勤'],
    indie: ['独立音乐'], emotional: ['怀念'], experimental: ['实验音乐'], rap: ['说唱']
  };
  const SLOT_PROFILE = {
    morning: { scenes: ['早晨', '通勤'], energies: ['medium', 'high'], moods: ['轻松', '开心', '温柔'] },
    noon: { scenes: ['下午', '通勤', '出门'], energies: ['medium', 'high'], moods: ['轻松', '开心'] },
    afternoon: { scenes: ['下午', '通勤', '出门'], energies: ['medium', 'high'], moods: ['轻松', '开心'] },
    night: { scenes: ['夜晚', '睡前', '约会'], energies: ['low', 'medium'], moods: ['温柔', '浪漫', '安静', '治愈'] }
  };
  function profileContextTags(tags) {
    return new Set((tags || []).flatMap(tag => PROFILE_TAG_MAP[tag] || [tag]));
  }
  function scoreProfile(song, part, weather, week) {
    if (!song.profile) return null;
    const profile = song.profile; const slot = SLOT_PROFILE[part] || SLOT_PROFILE.noon;
    const weatherTags = profileContextTags(weather.tags); const weekTags = profileContextTags(week.tags);
    let score = 0;
    score += profile.mood.filter(tag => weatherTags.has(tag) || weekTags.has(tag)).length * 4;
    score += profile.scene.filter(tag => slot.scenes.includes(tag) || weatherTags.has(tag) || weekTags.has(tag)).length * 4;
    score += profile.energy === slot.energies[0] ? 3 : (slot.energies.includes(profile.energy) ? 1.5 : 0);
    score += profile.mood.filter(tag => slot.moods.includes(tag)).length * 2;
    return score;
  }
  function freshnessScore(songKey, history) {
    const now = Date.now(); let score = 5;
    history.slice(-30).forEach(item => {
      if (item.key !== songKey || !item.ts) return;
      const age = now - item.ts;
      if (age < 7 * 86400000) score -= 20;
      else if (age < 30 * 86400000) score -= 8;
      else score -= 2;
    });
    return score;
  }
  function pickMusicFor(part, excluded, sourceFilter) {
    const weather = musicWeatherProfile(); const week = musicWeekProfile();
    const wanted = new Set([part, ...weather.tags, ...week.tags]);
    const styleWanted = new Set(NETEASE_PROFILE_TAGS);
    const seed = ctx.todayKey() + part + String(ctx.getState()._weather && ctx.getState()._weather.code);
    const settings = musicSettings(); const history = settings._musicHistory.slice(-30); const recent = new Set(history.slice(-12).map(item => item.key)); const likes = settings._musicLikes;
    const allowedSources = Array.isArray(sourceFilter) ? sourceFilter : (sourceFilter ? [sourceFilter] : null); const profileTags = allowedSources && allowedSources.includes('你们的网易云歌单') ? NETEASE_PROFILE_TAGS : APPLE_PROFILE_TAGS; const oppositeSource = allowedSources && allowedSources.includes('你们的网易云歌单') ? '你们的 Apple Music 歌单' : '你们的网易云歌单'; const oppositeTitles = new Set(MUSIC_LIBRARY.filter(song => song.source === oppositeSource).map(song => song.title));
    const ranked = MUSIC_LIBRARY.filter(song => (!allowedSources || allowedSources.includes(song.source)) && !(song.source === '相似推荐' && oppositeTitles.has(song.title))).map((song, index) => {
      let score = 0; const key = musicSongKey(song); const profileScore = scoreProfile(song, part, weather, week);
      if (profileScore !== null) score += profileScore;
      song.tags.forEach(tag => { if (wanted.has(tag)) score += tag === part ? 6 : 3; if (styleWanted.has(tag)) score += 1.4; if (song.source === '相似推荐' && profileTags.includes(tag)) score += 2.2; });
      if (song.source === '相似推荐') score += 1.1;
      score += freshnessScore(key, history);
      if (recent.has(key)) score -= 8;
      if (likes[key] === 1) score += 5; if (likes[key] === -1) score -= 12;
      score += (musicHash(seed + index) % 100) / 100;
      return { song, score };
    }).sort((a, b) => b.score - a.score);
    const chosen = ranked.find(item => {
      if (!excluded) return true;
      return !excluded.has(musicSongKey(item.song)) && !excluded.has(item.song.title);
    });
    return chosen ? [chosen.song] : [];
  }
  function getMusicSlotSong(part, sourceFilter) {
    const activeDate = ctx.todayKey(); const settings = musicSettings(); const slotKey = musicSlotKey(part, sourceFilter, activeDate); const cleaned = MusicState.cleanupMusicCaches(activeDate); const rejected = new Set([...MusicState.getRejectedForSlot(slotKey), ...Object.keys(settings._musicBlocked || {})]);
    for (const cachedSlot of musicSlotCache.keys()) { if (!Object.prototype.hasOwnProperty.call(settings._musicSlotSongKeys, cachedSlot)) musicSlotCache.delete(cachedSlot); }
    if (musicSlotCache.has(slotKey) && !rejected.has(musicSlotCache.get(slotKey))) { const memorySong = MUSIC_LIBRARY.find(song => musicSongKey(song) === musicSlotCache.get(slotKey)); if (memorySong) { if (cleaned) ctx.save({ silent: true }); return memorySong; } }
    settings._musicSlotSongKeys = settings._musicSlotSongKeys || {};
    if (settings._musicSlotSongKeys[slotKey] && !rejected.has(settings._musicSlotSongKeys[slotKey])) { const cached = MUSIC_LIBRARY.find(song => musicSongKey(song) === settings._musicSlotSongKeys[slotKey]); if (cached) { if (cleaned) ctx.save({ silent: true }); return cached; } }
    const song = pickMusicFor(part, rejected, sourceFilter)[0]; if (!song) { if (cleaned) ctx.save({ silent: true }); return null; }
    settings._musicSlotSongKeys[slotKey] = musicSongKey(song); musicSlotCache.set(slotKey, musicSongKey(song));
    settings._musicHistory = settings._musicHistory.filter(item => Date.now() - item.ts < 7 * 86400000); settings._musicHistory.push({ key: musicSongKey(song), title: song.title, artist: song.artist, ts: Date.now() }); settings._musicHistory = settings._musicHistory.slice(-30); ctx.save({ silent: true }); return song;
  }

  function recordFeedback(key, action, slotKey) {
    if (!MusicState.recordFeedback(key, action, slotKey)) return false;
    if (action === 'dislike' && slotKey) musicSlotCache.delete(slotKey);
    if (action === 'block') {
      for (const [cachedSlot, cachedKey] of musicSlotCache) {
        if (cachedKey === key) musicSlotCache.delete(cachedSlot);
      }
    }
    return true;
  }

  function ensurePastMusicRecords(date, currentSlot) {
    const order = ['morning', 'afternoon', 'night'];
    const currentIndex = order.indexOf(currentSlot);
    if (currentIndex < 0) return;
    const existing = new Set(MusicState.getDayMusicHistory(date).map(item => item.slot));
    order.slice(0, currentIndex).forEach(slot => {
      if (existing.has(slot)) return;
      const part = slot === 'afternoon' ? 'noon' : slot;
      const song = getMusicSlotSong(part);
      if (!song) return;
      const reasonModule = window.PufferMusicReason;
      const reason = reasonModule && reasonModule.generate
        ? reasonModule.generate(song, { part: slot, weather: musicWeatherProfile() })
        : { weather: {}, scene: {}, preference: {}, mood: {}, summary: '' };
      MusicState.saveMusicTrack({
        date,
        slot,
        songKey: musicSongKey(song),
        song,
        reason,
        generatedAt: Date.now(),
        source: 'retroactive'
      });
    });
  }

  function getCurrentMusic() {
    const date = ctx.todayKey(); const slot = currentMusicSlot(); const pickPart = slot === 'afternoon' ? 'noon' : slot; const currentSlotKey = musicSlotKey(pickPart, null, date); const cached = MusicState.getCurrentMusic(); const currentRejected = new Set([...MusicState.getRejectedForSlot(currentSlotKey), ...Object.keys(MusicState.getBlocked())]);
    if (cached && cached.date === date && cached.slot === slot && !currentRejected.has(cached.songKey)) {
      const cachedSong = cached.song || MUSIC_LIBRARY.find(item => musicSongKey(item) === cached.songKey);
      if (cachedSong) {
        ensurePastMusicRecords(date, slot);
        return { ...cached, song: cachedSong, cached: true };
      }
    }
    const song = getMusicSlotSong(pickPart);
    if (!song) return null;
    const reasonModule = window.PufferMusicReason;
    const reason = reasonModule && reasonModule.generate
      ? reasonModule.generate(song, { part: slot, weather: musicWeatherProfile() })
      : { weather: {}, scene: {}, preference: {}, mood: {}, summary: '' };
    const record = { date, slot, songKey: musicSongKey(song), song, reason, generatedAt: Date.now(), source: 'current' };
    MusicState.saveMusicTrack(record, { current: true });
    ensurePastMusicRecords(date, slot);
    return { ...record, cached: false };
  }

  window.PufferMusicRecommend = {
    configure,
    currentMusicSlot,
    currentMusicDaypart,
    musicWeatherProfile,
    musicWeekProfile,
    musicSongKey,
    musicSlotKey,
    musicSettings,
    pickMusicFor,
    getMusicSlotSong,
    recordFeedback,
    getCurrentMusic
  };
})();

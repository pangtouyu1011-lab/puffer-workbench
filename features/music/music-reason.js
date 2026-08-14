// Rule-based recommendation explanations. No network or AI dependency.
(function () {
  'use strict';

  const DAYPARTS = {
    morning: { label: '早晨', scene: '用一首轻松的歌开启今天' },
    noon: { label: '中午', scene: '吃饭和休息时，给自己一点放松' },
    afternoon: { label: '下午', scene: '工作间隙，保持节奏，也别忘了喘口气' },
    night: { label: '晚上', scene: '在一天结束前，留一点时间给喜欢的旋律' }
  };

  const WEATHER_TEXT = {
    rain: '今天有雨，适合把节奏放慢',
    cloud: '今天的光线柔和，适合听点温柔的歌',
    sun: '今天阳光不错，适合听点明亮轻快的歌',
    clear: '今天阳光不错，适合听点明亮轻快的歌',
    snow: '今天有雪，适合留一点安静的陪伴'
  };

  const TAG_TEXT = {
    genre: { '华语': '华语', '独立音乐': '独立音乐', '独立乐队': '乐队', 'R&B': 'R&B', '欧美': '欧美', '流行': '流行', '说唱': '说唱' },
    mood: { '温柔': '温柔', '浪漫': '浪漫', '轻松': '轻松', '开心': '轻快', '安静': '安静', '治愈': '治愈', '怀念': '有故事感', '青春': '青春' },
    scene: { '散步': '散步', '约会': '约会', '旅行': '旅行', '夜晚': '夜晚', '睡前': '睡前', '早晨': '早晨', '通勤': '通勤', '周末': '周末', '下午': '下午', '出门': '出门' }
  };

  function firstValue(values) {
    return Array.isArray(values) && values.length ? values[0] : '';
  }

  function normalizeWeather(weather) {
    const tags = Array.isArray(weather && weather.tags) ? weather.tags : [];
    const tag = tags.find(item => WEATHER_TEXT[item]);
    return {
      text: WEATHER_TEXT[tag] || (weather && weather.label) || '今天的天气很适合听歌',
      tags
    };
  }

  function getDaypartReason(part) {
    return DAYPARTS[part] || DAYPARTS.noon;
  }

  function getPreferenceText(song, preferenceTags) {
    const profile = song && song.profile;
    const preferences = Array.isArray(preferenceTags) ? preferenceTags : [];
    if (!profile || !preferences.length) return '';
    const matched = [...new Set([
      ...(profile.genre || []),
      ...(profile.mood || []),
      ...(profile.scene || [])
    ].filter(tag => preferences.includes(tag)))];
    const label = firstValue(matched.map(tag => TAG_TEXT.genre[tag] || TAG_TEXT.mood[tag] || TAG_TEXT.scene[tag] || tag));
    return label ? '延续你们喜欢的' + label + '氛围' : '';
  }

  function generate(song, options) {
    options = options || {};
    const part = getDaypartReason(options.part || 'noon');
    const weather = normalizeWeather(options.weather);
    const profile = song && song.profile ? song.profile : {};
    const scene = part.scene;
    const mood = firstValue(profile.mood);
    const preference = getPreferenceText(song, options.preferenceTags);
    const reasonParts = [weather.text, scene];
    if (preference) reasonParts.push(preference);
    else if (mood) reasonParts.push('也带一点' + (TAG_TEXT.mood[mood] || mood) + '的感觉');

    return {
      weather: { matched: Boolean(weather.tags.length), text: weather.text },
      scene: { matched: true, text: scene },
      preference: { matched: Boolean(preference), text: preference || '' },
      mood: { matched: Boolean(mood), text: mood ? (TAG_TEXT.mood[mood] || mood) : '' },
      summary: reasonParts.join('，') + '。'
    };
  }

  window.PufferMusicReason = {
    generate,
    getDaypartReason
  };
})();

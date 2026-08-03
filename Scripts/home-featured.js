(function () {
  'use strict';
  const STORAGE_PREFIX = 'csm-featured-v1';

  function isoWeekKey(date) {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((day - yearStart) / 86400000) + 1) / 7);
    return day.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
  }

  function stableIndex(text, length) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % length;
  }

  function safeLinks(item) {
    const links = Array.isArray(item.links) ? item.links : [item.links];
    return links.filter(link => link && link.url && link.label);
  }

  function audioLink(item) {
    return safeLinks(item).find(link => /\.mp3(?:$|[?#])/i.test(link.url));
  }

  function isFeaturedSermon(item) {
    return item.featured === 'Y' && Boolean(audioLink(item));
  }

  function getSavedIndex(type, weekKey, count, defaultIndex) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + '-' + type));
      if (saved && saved.week === weekKey && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < count) return saved.index;
    } catch (_) { /* Storage may be unavailable or contain old data. */ }
    return defaultIndex;
  }

  function saveIndex(type, weekKey, index) {
    try { localStorage.setItem(STORAGE_PREFIX + '-' + type, JSON.stringify({ week: weekKey, index: index })); }
    catch (_) { /* The recommendation still works for this page view. */ }
  }

  function differentIndex(current, count) {
    if (count < 2) return current;
    const values = new Uint32Array(1);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(values);
    else values[0] = Math.floor(Math.random() * 0xffffffff);
    return (current + 1 + (values[0] % (count - 1))) % count;
  }

  function renderSong(host, song, isPersonal) {
    host.querySelector('h4').textContent = song.title;
    host.querySelector('.featured-card-content').innerHTML =
      '<p class="featured-meta">No More Tears &bull; ' + song.artist + (song.duration ? ' &bull; ' + song.duration : '') + '</p>' +
      '<audio class="featured-audio" controls preload="metadata" src="' + song.audio + '">Your browser does not support audio playback.</audio>' +
      '<div class="featured-actions">' +
      '<button class="btn btn-secondary recommend-different" type="button">Recommend something different</button></div>' +
      (isPersonal ? '<p class="personal-recommendation">Your personal selection for this week</p>' : '');
  }

  function renderSermon(host, sermon, isPersonal) {
    const primary = audioLink(sermon);
    host.querySelector('h4').textContent = sermon.title;
    host.querySelector('.featured-card-content').innerHTML =
      '<p class="featured-meta">' + (sermon.date_display || sermon.date || 'Sermon') + (sermon.duration ? ' &bull; ' + sermon.duration : '') + '</p>' +
      (sermon.description ? '<p>' + sermon.description + '</p>' : '') +
      '<audio class="featured-audio" controls preload="metadata" src="' + primary.url + '">Your browser does not support audio playback.</audio>' +
      '<div class="featured-actions">' +
      '<button class="btn btn-secondary recommend-different" type="button">Recommend something different</button></div>' +
      (isPersonal ? '<p class="personal-recommendation">Your personal selection for this week</p>' : '');
  }

  function setupFeature(type, host, items, weekKey, render) {
    const defaultIndex = stableIndex(weekKey + ':' + type, items.length);
    let index = getSavedIndex(type, weekKey, items.length, defaultIndex);
    function show(focusHeading) {
      render(host, items[index], index !== defaultIndex);
      const heading = host.querySelector('h4');
      heading.setAttribute('tabindex', '-1');
      host.querySelector('.recommend-different').addEventListener('click', function () {
        index = differentIndex(index, items.length);
        saveIndex(type, weekKey, index);
        show(true);
      });
      if (focusHeading) heading.focus({ preventScroll: true });
    }
    show(false);
  }

  async function init() {
    const songHost = document.getElementById('featured-song');
    const sermonHost = document.getElementById('featured-sermon');
    if (!songHost || !sermonHost) return;
    document.addEventListener('play', function (event) {
      if (!event.target.matches('.featured-audio')) return;
      document.querySelectorAll('.featured-audio').forEach(function (player) {
        if (player !== event.target && !player.paused) player.pause();
      });
    }, true);
    try {
      const responses = await Promise.all([
        fetch('data/music_library.json?v=featured-flags-1'),
        fetch('data/cast_library.json?v=featured-flags-1')
      ]);
      if (!responses.every(response => response.ok)) throw new Error('Library data unavailable');
      const libraries = await Promise.all(responses.map(response => response.json()));
      const songs = libraries[0].tracks.filter(track => track.featured === 'Y' && track.audio);
      const sermonCategory = libraries[1].categories.find(category => category.key === 'sermons');
      const sermons = (sermonCategory ? sermonCategory.items : []).filter(isFeaturedSermon);
      if (!songs.length || !sermons.length) throw new Error('No recommendations available');
      const weekKey = isoWeekKey(new Date());
      setupFeature('song', songHost, songs, weekKey, renderSong);
      setupFeature('sermon', sermonHost, sermons, weekKey, renderSermon);
      document.getElementById('featured-week-status').textContent = 'Weekly selections for ' + weekKey.replace('-W', ', week ') + '.';
    } catch (_) {
      songHost.querySelector('h4').textContent = 'Explore the No More Tears album';
      songHost.querySelector('.featured-card-content').innerHTML = '<a class="btn btn-primary" href="Music.html#nmt">Browse songs</a>';
      sermonHost.querySelector('h4').textContent = 'Explore sermons and teachings';
      sermonHost.querySelector('.featured-card-content').innerHTML = '<a class="btn btn-primary" href="Casts.html">Browse sermons</a>';
    }
  }
  init();
}());

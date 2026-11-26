// ==UserScript==
// @name         X 暂停话题推送 · 自动续期
// @namespace    pi.x-snooze-guard
// @version      0.6.0
// @description  在 X 原生「暂停话题推送」面板里加一个自动续期开关，让勾选的话题到期前自动续上 24 小时
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var KNOWN_KEY = 'xSnoozeGuard.known';
  var AUTO_KEY = 'xSnoozeGuard.auto';
  var ATTEMPT_KEY = 'xSnoozeGuard.attempts';
  var DAY = 86400000;
  var RECHECK_MS = 15 * 60 * 1000;
  var DIALOG_SEL = '[role="dialog"]';

  function loadKnown() {
    try {
      var raw = localStorage.getItem(KNOWN_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === 'string'; }) : [];
    } catch (e) { return []; }
  }
  function saveKnown(list) {
    try { localStorage.setItem(KNOWN_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function loadAuto() {
    try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (e) { return true; }
  }
  function saveAuto(on) {
    try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch (e) {}
  }
  function attempts() {
    try { return Number(sessionStorage.getItem(ATTEMPT_KEY) || 0); } catch (e) { return 0; }
  }
  function bumpAttempt() {
    try { sessionStorage.setItem(ATTEMPT_KEY, String(attempts() + 1)); } catch (e) {}
  }
  function clearAttempts() {
    try { sessionStorage.removeItem(ATTEMPT_KEY); } catch (e) {}
  }

  function openDb() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open('localforage');
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }

  function readFilters() {
    return openDb().then(function (db) {
      var tx = db.transaction('keyvaluepairs', 'readonly');
      var store = tx.objectStore('keyvaluepairs');
      return new Promise(function (res, rej) {
        var r = store.getAllKeys();
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      }).then(function (keys) {
        var cand = keys.filter(function (k) { return String(k).indexOf('timelineFilters') !== -1; });
        if (!cand.length) { db.close(); return { key: null, value: null }; }
        return Promise.all(cand.map(function (k) {
          return new Promise(function (res) {
            var r = store.get(k);
            r.onsuccess = function () { res({ key: String(k), value: r.result }); };
            r.onerror = function () { res({ key: String(k), value: null }); };
          });
        })).then(function (list) {
          db.close();
          list.sort(function (a, b) {
            return ((b.value && b.value._lastPersisted) || 0) - ((a.value && a.value._lastPersisted) || 0);
          });
          return list[0];
        });
      });
    });
  }

  function writeFilters(key, next) {
    return openDb().then(function (db) {
      var tx = db.transaction('keyvaluepairs', 'readwrite');
      tx.objectStore('keyvaluepairs').put(next, key);
      return new Promise(function (res, rej) {
        tx.oncomplete = function () { db.close(); res(); };
        tx.onerror = function () { db.close(); rej(tx.error); };
      });
    });
  }

  function fmtLeft(exp) {
    var ms = exp - Date.now();
    if (ms <= 0) return '已过期';
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? h + ' 小时 ' + m + ' 分' : m + ' 分';
  }

  var state = {
    filters: { key: null, value: null },
    auto: loadAuto(),
    error: null,
    injectedEl: null
  };

  // remembers only topics the user actively picked (currently active in X storage).
  // an expired leftover that was never seen active is NOT adopted, so old stale
  // entries do not come back to life on first install.
  function syncKnown(tags) {
    var known = loadKnown();
    var ids = Object.keys(tags || {});
    var now = Date.now();
    ids.forEach(function (id) {
      if (tags[id] > now && known.indexOf(id) === -1) known.push(id);
    });
    known = known.filter(function (id) { return ids.indexOf(id) !== -1; });
    known.sort();
    var before = loadKnown();
    var changed = known.length !== before.length || known.some(function (id, i) { return id !== before[i]; });
    if (changed) saveKnown(known);
    return known;
  }

  function statusLine(tags, known) {
    if (!known.length) return '在上方勾选话题后，这里会自动记住并续期';
    var now = Date.now();
    var active = known.filter(function (id) { return tags[id] && tags[id] > now; });
    var expired = known.filter(function (id) { return tags[id] && tags[id] <= now; });
    if (expired.length) return expired.length + ' 个话题已过期' + (state.auto ? '，正在续期…' : '，点上方开关可自动续期');
    if (active.length) {
      var soonest = Math.min.apply(null, active.map(function (id) { return tags[id]; }));
      return active.length + ' 个话题生效中 · ' + fmtLeft(soonest) + '后到期';
    }
    return known.length + ' 个话题待续期';
  }

  function buildInline() {
    var el = document.createElement('div');
    el.id = 'xsg-inline';
    el.style.cssText = 'padding:2px 16px 6px;border-top:1px solid #2f3336;margin-top:2px;';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0 6px;';

    var txt = document.createElement('div');
    txt.style.cssText = 'min-width:0;';
    var t1 = document.createElement('div');
    t1.textContent = '自动续期';
    t1.style.cssText = 'font-size:15px;color:#e7e9ea;line-height:20px;';
    var t2 = document.createElement('div');
    t2.textContent = '已勾选的话题到期前自动续上 24 小时';
    t2.style.cssText = 'font-size:13px;color:#71767b;line-height:18px;margin-top:2px;';
    txt.appendChild(t1);
    txt.appendChild(t2);

    // mirrors X's native switch metrics: 40x20 hit area, 40x14 track, 20x20 knob
    var sw = document.createElement('div');
    sw.id = 'xsg-toggle';
    sw.setAttribute('role', 'switch');
    sw.style.cssText = 'flex:none;width:40px;height:20px;position:relative;cursor:pointer;';
    var track = document.createElement('div');
    track.id = 'xsg-track';
    track.style.cssText = 'position:absolute;left:0;top:3px;width:40px;height:14px;border-radius:10px;border:0.667px solid transparent;transition:background-color .1s;';
    var knob = document.createElement('div');
    knob.id = 'xsg-knob';
    knob.style.cssText = 'position:absolute;top:0;left:0;width:20px;height:20px;border-radius:100%;border:0.667px solid transparent;box-shadow:0 1px 3px rgba(0,0,0,.5);transition:left .1s,background-color .1s;';
    sw.appendChild(track);
    sw.appendChild(knob);

    row.appendChild(txt);
    row.appendChild(sw);

    var stat = document.createElement('div');
    stat.id = 'xsg-stat';
    stat.style.cssText = 'font-size:13px;color:#71767b;line-height:18px;padding-bottom:6px;';

    el.appendChild(row);
    el.appendChild(stat);

    sw.addEventListener('click', function (e) {
      e.stopPropagation();
      state.auto = !state.auto;
      saveAuto(state.auto);
      paintInline();
      refresh();
    });
    return el;
  }

  function paintInline() {
    var el = state.injectedEl;
    if (!el) return;
    var sw = el.querySelector('#xsg-toggle');
    var track = el.querySelector('#xsg-track');
    var knob = el.querySelector('#xsg-knob');
    var stat = el.querySelector('#xsg-stat');
    if (sw) sw.setAttribute('aria-checked', state.auto ? 'true' : 'false');
    if (track) track.style.backgroundColor = state.auto ? '#6bc9fb' : '#939393';
    if (knob) {
      knob.style.left = state.auto ? '20px' : '0px';
      knob.style.backgroundColor = state.auto ? '#1d9bf0' : '#fafafa';
    }
    var tags = (state.filters.value && state.filters.value.snoozedTags) || {};
    var known = loadKnown();
    if (stat) {
      stat.textContent = state.filters.key === null
        ? '没有找到 X 的时间线设置'
        : state.error ? state.error : statusLine(tags, known);
      stat.style.color = state.error ? '#f4212e' : '#71767b';
    }
  }

  function findDialog() {
    var dialogs = document.querySelectorAll(DIALOG_SEL);
    for (var i = 0; i < dialogs.length; i++) {
      var d = dialogs[i];
      if (d.querySelectorAll('input[role="switch"]').length >= 5) return d;
    }
    return null;
  }

  function tryInject() {
    var dlg = findDialog();
    if (!dlg) { state.injectedEl = null; return; }
    if (dlg.querySelector('#xsg-inline')) {
      state.injectedEl = dlg.querySelector('#xsg-inline');
      paintInline();
      return;
    }
    var firstSwitch = dlg.querySelector('input[role="switch"]');
    var list = firstSwitch;
    while (list && list.parentElement && list.parentElement !== dlg && list.parentElement.children.length < 10) {
      list = list.parentElement;
    }
    var container = list && list.parentElement ? list.parentElement : dlg;
    var el = buildInline();
    var resetBtn = null;
    var kids = container.children;
    for (var j = kids.length - 1; j >= 0; j--) {
      if (kids[j].tagName === 'BUTTON') { resetBtn = kids[j]; break; }
    }
    if (resetBtn) container.insertBefore(el, resetBtn);
    else container.appendChild(el);
    state.injectedEl = el;
    paintInline();
  }

  var injectTimer = null;
  function scheduleInject() {
    if (injectTimer) return;
    injectTimer = setTimeout(function () {
      injectTimer = null;
      tryInject();
    }, 180);
  }

  function refresh() {
    return readFilters().then(function (res) {
      state.filters = res;
      state.error = null;
      var tags = (res.value && res.value.snoozedTags) || {};
      var known = syncKnown(tags);
      var now = Date.now();
      var expired = known.filter(function (id) { return tags[id] && tags[id] <= now; });
      if (!expired.length) clearAttempts();
      paintInline();
      if (state.auto && expired.length > 0 && res.key) {
        if (attempts() >= 2) {
          state.error = '自动续期连续失败 ' + attempts() + ' 次，已停止';
          paintInline();
          return;
        }
        bumpAttempt();
        var nextTags = Object.assign({}, tags);
        expired.forEach(function (id) { nextTags[id] = now + DAY; });
        var next = Object.assign({}, res.value, { snoozedTags: nextTags, _lastPersisted: now });
        return writeFilters(res.key, next).then(function () {
          state.filters.value = next;
          paintInline();
          console.log('[X 暂停话题推送] 已续期 ' + expired.length + ' 个话题');
          setTimeout(function () { location.reload(); }, 300);
        });
      }
    }).catch(function (e) {
      state.error = String(e && e.message ? e.message : e);
      paintInline();
    });
  }

  function boot() {
    var obs = new MutationObserver(scheduleInject);
    obs.observe(document.body, { childList: true, subtree: true });
    scheduleInject();
    setTimeout(refresh, 2000);
    setInterval(refresh, RECHECK_MS);
    console.log('[X 暂停话题推送] 已启动');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

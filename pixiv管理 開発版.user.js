// ==UserScript==
// @name         pixiv管理 開発版v1.1
// @namespace    https://www.pixiv.net/
// @version      1.1
// @description  Grays out thumbnails from followed users on pixiv lists and cards.
// @match        https://www.pixiv.net/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const HOST = 'https://www.pixiv.net';
  const DEFAULTS = {
    grayscale: 100,
    opacity: 0.45,
    borderColor: '#888888',
    enableBorder: false,
    debug: false,
    cacheDuration: 1000 * 60 * 60 * 6
  };

  const state = {
    followIds: null,
    followIdsLoaded: false,
    followIdsLoading: null,
    followIdsUpdatedAt: 0,
    scheduled: false,
    observer: null,
    ui: null
  };

  const storage = {
    get(key, fallback) {
      try {
        if (typeof GM_getValue === 'function') {
          return GM_getValue(key, fallback);
        }
      } catch (e) {}
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) {
          return fallback;
        }
        return JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (typeof GM_setValue === 'function') {
          GM_setValue(key, value);
          return;
        }
      } catch (e) {}
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {}
    }
  };

  const settings = loadSettings();

  function loadSettings() {
    const saved = storage.get('pixivFollowGraySettings', null);
    if (saved && typeof saved === 'object') {
      return Object.assign({}, DEFAULTS, saved);
    }
    return Object.assign({}, DEFAULTS);
  }

  function saveSettings() {
    storage.set('pixivFollowGraySettings', settings);
  }

  function logDebug(message, detail) {
    if (settings.debug) {
      console.log('[pixiv-follow-gray]', message, detail);
    }
  }

  function applySettingsToUi() {
    if (!state.ui || !state.ui.panel) {
      return;
    }
    const { grayscaleInput, opacityInput, borderInput, borderColorInput, debugInput } = state.ui;
    if (grayscaleInput) {
      grayscaleInput.value = String(settings.grayscale);
    }
    if (opacityInput) {
      opacityInput.value = String(settings.opacity);
    }
    if (borderInput) {
      borderInput.checked = Boolean(settings.enableBorder);
    }
    if (borderColorInput) {
      borderColorInput.value = settings.borderColor || '#888888';
    }
    if (debugInput) {
      debugInput.checked = Boolean(settings.debug);
    }
  }

  function updateSettingsFromUi() {
    if (!state.ui) {
      return;
    }
    const { grayscaleInput, opacityInput, borderInput, borderColorInput, debugInput } = state.ui;
    if (grayscaleInput) {
      const parsed = parseInt(grayscaleInput.value, 10);
      if (!Number.isNaN(parsed)) {
        settings.grayscale = Math.max(0, Math.min(100, parsed));
      }
    }
    if (opacityInput) {
      const parsed = parseFloat(opacityInput.value);
      if (!Number.isNaN(parsed)) {
        settings.opacity = Math.max(0, Math.min(1, parsed));
      }
    }
    if (borderInput) {
      settings.enableBorder = Boolean(borderInput.checked);
    }
    if (borderColorInput) {
      settings.borderColor = borderColorInput.value || '#888888';
    }
    if (debugInput) {
      settings.debug = Boolean(debugInput.checked);
    }
    saveSettings();
    applySettingsToUi();
    reprocessAll();
  }

  function createSettingsUi() {
    if (state.ui && state.ui.button) {
      return;
    }

    if (typeof GM_addStyle === 'function') {
      GM_addStyle(`
        .pixiv-follow-gray-settings-btn {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 2147483647;
          border: 1px solid rgba(0, 0, 0, 0.2);
          border-radius: 999px;
          padding: 10px 14px;
          background: rgba(255, 255, 255, 0.95);
          color: #222;
          font-size: 13px;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
          cursor: pointer;
        }
        .pixiv-follow-gray-settings-panel {
          position: fixed;
          right: 16px;
          bottom: 58px;
          z-index: 2147483647;
          width: min(320px, calc(100vw - 24px));
          padding: 12px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
          font-size: 13px;
          color: #222;
        }
        .pixiv-follow-gray-settings-panel label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin: 6px 0;
        }
        .pixiv-follow-gray-settings-panel input[type="range"],
        .pixiv-follow-gray-settings-panel input[type="color"],
        .pixiv-follow-gray-settings-panel input[type="checkbox"] {
          accent-color: #1e8fff;
        }
        .pixiv-follow-gray-settings-panel .pixiv-follow-gray-settings-actions {
          display: flex;
          gap: 8px;
          margin-top: 10px;
          flex-wrap: wrap;
        }
        .pixiv-follow-gray-settings-panel button {
          border: 1px solid #d0d0d0;
          border-radius: 6px;
          background: #f7f7f7;
          padding: 6px 8px;
          cursor: pointer;
        }
      `);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pixiv-follow-gray-settings-btn';
    button.textContent = '設定';
    button.addEventListener('click', () => {
      if (!state.ui || !state.ui.panel) {
        return;
      }
      state.ui.panel.hidden = !state.ui.panel.hidden;
      if (!state.ui.panel.hidden) {
        applySettingsToUi();
      }
    });

    const panel = document.createElement('div');
    panel.className = 'pixiv-follow-gray-settings-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div style="font-weight:700; margin-bottom:8px;">pixiv follow gray</div>
      <label>グレースケール <input type="range" min="0" max="100" step="1" data-setting="grayscale"></label>
      <label>透明度 <input type="range" min="0" max="1" step="0.01" data-setting="opacity"></label>
      <label><span>枠線</span> <input type="checkbox" data-setting="enableBorder"></label>
      <label>枠線色 <input type="color" data-setting="borderColor"></label>
      <label><span>デバッグ</span> <input type="checkbox" data-setting="debug"></label>
      <div class="pixiv-follow-gray-settings-actions">
        <button type="button" data-action="refresh">再読込</button>
        <button type="button" data-action="reset">リセット</button>
        <button type="button" data-action="close">閉じる</button>
      </div>
    `;

    panel.querySelectorAll('input[data-setting]').forEach((input) => {
      input.addEventListener('input', updateSettingsFromUi);
      input.addEventListener('change', updateSettingsFromUi);
    });

    panel.querySelectorAll('button[data-action]').forEach((buttonElement) => {
      buttonElement.addEventListener('click', () => {
        const action = buttonElement.getAttribute('data-action');
        if (action === 'refresh') {
          state.followIds = null;
          state.followIdsLoaded = false;
          state.followIdsLoading = null;
          state.followIdsUpdatedAt = 0;
          saveSettings();
          void processDocument();
        } else if (action === 'reset') {
          Object.assign(settings, DEFAULTS);
          saveSettings();
          applySettingsToUi();
          reprocessAll();
        } else if (action === 'close') {
          panel.hidden = true;
        }
      });
    });

    document.body.appendChild(button);
    document.body.appendChild(panel);

    state.ui = {
      button,
      panel,
      grayscaleInput: panel.querySelector('input[data-setting="grayscale"]'),
      opacityInput: panel.querySelector('input[data-setting="opacity"]'),
      borderInput: panel.querySelector('input[data-setting="enableBorder"]'),
      borderColorInput: panel.querySelector('input[data-setting="borderColor"]'),
      debugInput: panel.querySelector('input[data-setting="debug"]')
    };
    applySettingsToUi();
  }

  function ensureSettingsUi() {
    if (!document.body) {
      return;
    }
    createSettingsUi();
  }

  function parseNumericId(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const text = String(value).trim();
    return /^\d+$/.test(text) ? text : null;
  }

  function findCardRoot(startNode) {
    let current = startNode;
    let depth = 0;

    while (current && current !== document.documentElement && current !== document.body && depth < 8) {
      const hasArtworkLink = current.matches && current.matches('a[href*="/artworks/"]');
      const artworkDescendant = current.querySelector && current.querySelector('a[href*="/artworks/"]');
      const authorCandidate = (current.matches && current.matches('a[href*="/users/"], [data-user-id], [data-user_id], [data-user-id]')) ||
        (current.querySelector && current.querySelector('a[href*="/users/"], [data-user-id], [data-user_id], [data-user-id]'));
      const hasImage = current.querySelector && current.querySelector('img, video, canvas, picture');

      if ((hasArtworkLink || artworkDescendant) && (authorCandidate || hasImage || current.matches('article, li, section, figure'))) {
        return current;
      }

      current = current.parentElement;
      depth += 1;
    }

    return null;
  }

  function extractAuthorId(node) {
    if (!node) {
      return null;
    }

    const attrs = [
      node.getAttribute('data-user-id'),
      node.getAttribute('data-user_id'),
      node.getAttribute('data-userid'),
      node.getAttribute('data-uid'),
      node.dataset && node.dataset.userId,
      node.dataset && node.dataset.user_id,
      node.dataset && node.dataset.userid,
      node.dataset && node.dataset.uid
    ];

    for (const value of attrs) {
      const numericId = parseNumericId(value);
      if (numericId) {
        return numericId;
      }
    }

    const links = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/users\/(\d+)/i);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  function clearGrayStyle(node) {
    node.style.filter = '';
    node.style.opacity = '';
    node.style.border = '';
    node.style.boxSizing = '';
  }

  function applyGrayStyle(node, isFollowed) {
    if (!node) {
      return;
    }

    if (!isFollowed) {
      clearGrayStyle(node);
      return;
    }

    node.style.filter = `grayscale(${settings.grayscale}%)`;
    node.style.opacity = String(settings.opacity);
    if (settings.enableBorder) {
      node.style.border = `1px solid ${settings.borderColor}`;
      node.style.boxSizing = 'border-box';
    } else {
      node.style.border = '';
      node.style.boxSizing = '';
    }
  }

  function reprocessAll() {
    document.querySelectorAll('[data-pixiv-follow-gray-processed]').forEach((element) => {
      element.removeAttribute('data-pixiv-follow-gray-processed');
      clearGrayStyle(element);
    });
    void processDocument();
  }

  function getCurrentUserIdFromObject(value, seen = new Set()) {
    if (!value || typeof value !== 'object') {
      return null;
    }
    if (seen.has(value)) {
      return null;
    }
    seen.add(value);

    const directKeys = ['userId', 'user_id', 'user_id_str', 'uid', 'id'];
    for (const key of directKeys) {
      const currentValue = value[key];
      if (currentValue !== undefined && currentValue !== null) {
        const parsed = parseNumericId(currentValue);
        if (parsed) {
          return parsed;
        }
      }
    }

    const entries = Object.entries(value);
    for (const [, nestedValue] of entries) {
      const nestedId = getCurrentUserIdFromObject(nestedValue, seen);
      if (nestedId) {
        return nestedId;
      }
    }
    return null;
  }

  function getCurrentUserId() {
    const candidates = [
      window.__INITIAL_STATE__,
      window.__INITIAL_PROPS__,
      window._sharedData,
      window.globalInitData,
      window.__NUXT__,
      window.__NEXT_DATA__
    ];

    for (const candidate of candidates) {
      const id = getCurrentUserIdFromObject(candidate);
      if (id) {
        return id;
      }
    }

    const metaUserId = document.querySelector('meta[name="user_id"]');
    if (metaUserId) {
      const id = parseNumericId(metaUserId.getAttribute('content'));
      if (id) {
        return id;
      }
    }

    const bodyUserId = document.body && document.body.getAttribute('data-user-id');
    if (bodyUserId) {
      const id = parseNumericId(bodyUserId);
      if (id) {
        return id;
      }
    }

    return null;
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        'x-requested-with': 'XMLHttpRequest'
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  function extractIdsFromApiPayload(payload) {
    const ids = [];

    function visit(value) {
      if (!value || typeof value !== 'object') {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      if (typeof value.userId === 'number' || typeof value.user_id === 'number') {
        ids.push(String(value.userId || value.user_id));
      }
      if (typeof value.id === 'number' || typeof value.id === 'string') {
        const parsed = parseNumericId(value.id);
        if (parsed) {
          ids.push(parsed);
        }
      }
      if (typeof value.userId === 'string' || typeof value.user_id === 'string') {
        const parsed = parseNumericId(value.userId || value.user_id);
        if (parsed) {
          ids.push(parsed);
        }
      }
      if (typeof value.user === 'object' && value.user) {
        visit(value.user);
      }
      if (typeof value.body === 'object' && value.body) {
        visit(value.body);
      }
      if (typeof value.users === 'object' && value.users) {
        visit(value.users);
      }
      if (typeof value.list === 'object' && value.list) {
        visit(value.list);
      }

      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key) && !['userId', 'user_id', 'id', 'user', 'body', 'users', 'list'].includes(key)) {
          visit(value[key]);
        }
      }
    }

    visit(payload);
    return ids;
  }

  async function fetchFollowIdsFromApi(userId, offset, limit) {
    const url = `${HOST}/ajax/user/${userId}/following?offset=${offset}&limit=${limit}`;
    const payload = await fetchJson(url);
    const ids = extractIdsFromApiPayload(payload);
    if (ids.length) {
      return ids;
    }
    return [];
  }

  async function fetchFollowIdsFromHtml(userId, offset) {
    const url = `${HOST}/users/${userId}/following?offset=${offset}`;
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        'x-requested-with': 'XMLHttpRequest'
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const idSet = new Set();
    const links = doc.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/users\/(\d+)/i);
      if (match) {
        idSet.add(match[1]);
      }
    }
    return Array.from(idSet);
  }

  async function loadFollowIds() {
    if (state.followIdsLoaded && state.followIds) {
      return state.followIds;
    }
    if (state.followIdsLoading) {
      return state.followIdsLoading;
    }

    state.followIdsLoading = (async () => {
      const now = Date.now();
      const cached = storage.get('pixivFollowGrayFollowIds', null);
      if (cached && cached.ids && cached.timestamp && now - cached.timestamp < settings.cacheDuration) {
        state.followIds = new Set(cached.ids);
        state.followIdsLoaded = true;
        state.followIdsUpdatedAt = cached.timestamp;
        logDebug('follow cache hit', state.followIds.size);
        return state.followIds;
      }

      const userId = getCurrentUserId();
      if (!userId) {
        state.followIds = new Set();
        state.followIdsLoaded = true;
        state.followIdsUpdatedAt = now;
        logDebug('no current user id', null);
        return state.followIds;
      }

      const followIds = new Set();
      const limit = 100;
      try {
        for (let offset = 0; offset < 1000; offset += limit) {
          let pageIds = [];
          try {
            pageIds = await fetchFollowIdsFromApi(userId, offset, limit);
          } catch (apiError) {
            try {
              pageIds = await fetchFollowIdsFromHtml(userId, offset);
            } catch (htmlError) {
              break;
            }
          }
          if (!pageIds.length) {
            break;
          }
          pageIds.forEach((id) => followIds.add(id));
          if (pageIds.length < limit) {
            break;
          }
        }
      } catch (error) {
        logDebug('follow load failed', error);
      }

      state.followIds = followIds;
      state.followIdsLoaded = true;
      state.followIdsUpdatedAt = now;
      storage.set('pixivFollowGrayFollowIds', {
        ids: Array.from(followIds),
        timestamp: now
      });
      logDebug('follow list fetched', followIds.size);
      return state.followIds;
    })();

    return state.followIdsLoading;
  }

  async function processDocument() {
    const followIds = await loadFollowIds();
    const rootsToProcess = [];
    const seenRoots = new Set();

    document.querySelectorAll('a[href*="/artworks/"]').forEach((link) => {
      const root = findCardRoot(link);
      if (!root || seenRoots.has(root) || root.hasAttribute('data-pixiv-follow-gray-processed')) {
        return;
      }
      seenRoots.add(root);
      rootsToProcess.push(root);
    });

    let grayCount = 0;
    let processedAuthorIds = [];
    rootsToProcess.forEach((root) => {
      const authorId = extractAuthorId(root);
      if (!authorId) {
        root.setAttribute('data-pixiv-follow-gray-processed', '1');
        return;
      }

      processedAuthorIds.push(authorId);
      const isFollowed = followIds.has(authorId);
      applyGrayStyle(root, isFollowed);
      root.setAttribute('data-pixiv-follow-gray-processed', isFollowed ? '1' : '0');
      if (isFollowed) {
        grayCount += 1;
      }
    });

    if (settings.debug) {
      console.log('[pixiv-follow-gray] follow count', followIds.size);
      console.log('[pixiv-follow-gray] author ids', processedAuthorIds);
      console.log('[pixiv-follow-gray] gray count', grayCount);
    }
  }

  function scheduleProcess() {
    if (state.scheduled) {
      return;
    }
    state.scheduled = true;
    requestAnimationFrame(() => {
      state.scheduled = false;
      void processDocument();
    });
  }

  function startObserver() {
    if (state.observer) {
      return;
    }
    state.observer = new MutationObserver(() => {
      scheduleProcess();
    });
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: false
    });
  }

  function patchHistoryApis() {
    const patch = (methodName) => {
      const original = history[methodName];
      history[methodName] = function patchedHistoryMethod() {
        const result = original.apply(this, arguments);
        scheduleProcess();
        return result;
      };
    };

    patch('pushState');
    patch('replaceState');
    window.addEventListener('popstate', () => scheduleProcess());
    window.addEventListener('pageshow', () => scheduleProcess());
  }

  function bootstrap() {
    if (!/^https:\/\/www\.pixiv\.net\//.test(location.href)) {
      return;
    }
    ensureSettingsUi();
    patchHistoryApis();
    startObserver();
    if (typeof GM_addStyle === 'function') {
      GM_addStyle('.pixiv-follow-gray-card { transition: filter 0.2s ease, opacity 0.2s ease; }');
    }
    scheduleProcess();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();

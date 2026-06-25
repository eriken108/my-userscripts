// ==UserScript==
// @name         動画既読 開発版v3.3.8
// @namespace    https://missav.ai/
// @version      3.3.8
// @description  MissAVの動画ページで既読/お気に入りを保存し、関連動画だけにバッジを表示します。
// @match        https://missav.ai/*
// @match        https://*.missav.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const DATA_KEY = 'missav-video-data';
  const OLD_READ_KEY = 'missav-read-list';
  const OLD_FAV_KEY = 'missav-fav-list';

  const CONTROL_ID = 'missav-rf-controls';
  const STYLE_ID = 'missav-rf-style';
  const STATUS_BADGE_ID = 'missav-rf-status-floating-badge';
  const BADGE_CLASS = 'missav-rf-badge';
  const READ_EFFECT_CLASS = 'missav-rf-read-effect';
  const FAV_VISUAL_CLASS = 'missav-rf-fav-visual';
  const FAV_FRAME_CLASS = 'missav-rf-fav-frame';
  const READ_FRAME_CLASS = 'missav-rf-read-frame';

  const NON_VIDEO_SLUGS = new Set([
    'vip',
    'new',
    'release',
    'uncensored-leak',
    'actresses',
    'genres',
    'makers',
    'today-hot',
    'weekly-hot',
    'monthly-hot',
    'siro',
    'luxu',
    'gana',
    'maan',
    'scute',
    'ara',
    'fc2',
    'heyzo',
    'tokyohot',
    '1pondo',
    'caribbeancom',
    'caribbeancompr',
    '10musume',
    'pacopacomama',
    'gachinco',
    'xxxav',
    'marriedslash',
    'naughty4610',
    'naughty0930',
    'madou',
    'twav',
    'furuke',
    'korean-live',
    'chinese-live',
    'my',
    'playlist',
    'history',
    'english-subtitle',
  ]);

  let videoData = new Map();
  let observer = null;
  let applyQueued = false;

  function normalizeUrl(input) {
    if (!input) return null;

    let url;
    try {
      url = new URL(String(input), location.href);
    } catch (_error) {
      return null;
    }

    if (!/(\.|^)missav\.ai$/i.test(url.hostname)) return null;

    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    const match = path.match(/^\/(?:dm\d+\/)?([a-z]{2,3})\/([^/]+)$/i);
    if (!match) return null;

    const lang = match[1].toLowerCase();
    const slug = decodeURIComponent(match[2]).toLowerCase();
    if (!slug || NON_VIDEO_SLUGS.has(slug)) return null;

    return `${url.origin}/${lang}/${encodeURIComponent(slug)}`;
  }

  function hasClasses(element, classNames) {
    return Boolean(element) && classNames.every((className) => element.classList.contains(className));
  }

  function loadVideoData() {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return new Map(Object.entries(parsed));
      } catch (error) {
        console.warn('[MissAV read/fav] データの読み込みに失敗しました:', error);
      }
    }

    // 移行ロジック: 旧データがある場合は統合
    const legacyMap = new Map();
    const migrate = (key, isFav) => {
      const rawOld = localStorage.getItem(key);
      if (!rawOld) return;
      try {
        const urls = JSON.parse(rawOld);
        if (Array.isArray(urls)) {
          urls.forEach(u => {
            const n = normalizeUrl(u);
            if (n) {
              const existing = legacyMap.get(n);
              legacyMap.set(n, {
                fav: isFav || (existing ? existing.fav : false),
                memo: existing?.memo || '',
                added: existing?.added || Date.now()
              });
            }
          });
        }
      } catch (e) {}
    };
    migrate(OLD_READ_KEY, false);
    migrate(OLD_FAV_KEY, true);

    if (legacyMap.size > 0) {
      saveVideoData(legacyMap);
    }
    return legacyMap;
  }

  function saveVideoData(map) {
    localStorage.setItem(DATA_KEY, JSON.stringify(Object.fromEntries(map)));
  }

  function reloadData() {
    videoData = loadVideoData();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CONTROL_ID} {
        align-items: flex-end;
        bottom: 16px;
        display: flex;
        gap: 8px;
        position: fixed;
        right: 16px;
        z-index: 2147483647 !important;
      }

      #missav-rf-button-group {
        display: flex;
        flex-direction: column-reverse;
        gap: 8px;
      }

      #${CONTROL_ID} > div {
        flex-shrink: 0;
        position: relative;
        z-index: 2147483647 !important;
      }

      #${CONTROL_ID} button {
        appearance: none;
        background: rgba(255,255,255,.96) !important;
        border: 1px solid rgba(0,0,0,.35) !important;
        border-radius: 999px !important;
        box-shadow: 0 6px 18px rgba(0,0,0,.18) !important;
        color: #111 !important;
        cursor: pointer !important;
        font: inherit;
        font-size: 14px !important;
        line-height: 1 !important;
        padding: 10px 14px !important;
      }

      #${CONTROL_ID} button:hover {
        transform: translateY(-1px);
      }

      #${CONTROL_ID} textarea {
        background: rgba(255,255,255,.96) !important;
        border: 1px solid rgba(0,0,0,.35) !important;
        border-radius: 8px !important;
        box-shadow: 0 2px 8px rgba(0,0,0,.1) !important;
        color: #111 !important;
        font-family: inherit;
        font-size: 12px !important;
        line-height: 1.4 !important;
        min-height: 34px !important;
        height: auto !important;
        padding: 8px !important;
        resize: none !important;
        overflow-y: hidden !important;
      }

      #missav-rf-video-list-container {
        background: rgba(240, 240, 240, 0.98);
        border: 1px solid rgba(0,0,0,.2);
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,.1);
        max-height: 40vh;
        overflow-y: auto;
        width: min(350px, calc(100vw - 32px));
        box-sizing: border-box;
        touch-action: auto !important;
        -webkit-overflow-scrolling: touch !important;
        padding: 8px;
        margin-top: 8px;
      }

      #missav-rf-video-list-controls {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
      }

      #missav-rf-video-list-controls input {
        flex-grow: 1;
        font-size: 11px !important;
        padding: 4px 8px !important;
        border: 1px solid #ccc !important;
        border-radius: 4px !important;
        box-shadow: none !important;
        line-height: 1.4 !important;
        height: auto !important;
      }

      #missav-rf-video-list-controls button {
        font-size: 11px !important;
        padding: 4px 8px !important;
        background: #fff !important;
        border: 1px solid #ccc !important;
        box-shadow: none !important;
      }

      @media (max-width: 767px) {
        #missav-rf-controls {
          align-items: flex-end;
          left: 16px !important;
          right: 16px !important;
          justify-content: flex-end;
          max-width: calc(100vw - 32px);
        }

        #missav-rf-button-group {
          width: auto;
          align-items: flex-end;
        }

        #missav-rf-video-list-container {
          width: calc((100vw - 32px) * 0.6);
          max-width: calc((100vw - 32px) * 0.6);
          align-self: flex-end;
        }

        #missav-rf-video-list-controls {
          flex-direction: column;
          gap: 6px;
        }

        #missav-rf-video-list-controls input,
        #missav-rf-video-list-controls button {
          width: 100%;
          box-sizing: border-box;
        }

        .missav-rf-video-list-item {
          flex-direction: row;
          align-items: center;
          gap: 4px;
          min-height: 36px;
        }

        .missav-rf-video-list-item span {
          width: auto;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }

      #missav-rf-video-list-controls button[data-active="true"] {
        background: #333 !important;
        color: #fff !important;
        border-color: #333 !important;
      }

      .missav-rf-video-list-item {
        display: flex;
        align-items: center;
        font-size: 12px;
        padding: 4px;
        border-bottom: 1px solid #ddd;
        cursor: pointer;
        color: #333;
        text-decoration: none;
      }

      .missav-rf-video-list-item:hover {
        background: #fff;
      }

      #${CONTROL_ID} button[data-active="true"] {
        background: rgba(255,255,255,.96) !important;
        border-color: rgba(0,0,0,.55) !important;
        color: #111 !important;
        font-weight: 700 !important;
      }

      #${STATUS_BADGE_ID} {
        bottom: 24px !important;
        display: none;
        left: 50% !important;
        pointer-events: none !important;
        position: fixed !important;
        transform: translateX(-50%) !important;
        z-index: 2147483647 !important;
      }

      @media (max-width: 767px) {
        #${STATUS_BADGE_ID} {
          left: 16px !important;
          transform: none !important;
        }
      }

      .missav-rf-status-floating-item {
        background: #fff !important;
        border: 1px solid rgba(0, 0, 0, 0.2) !important;
        border-radius: 999px !important;
        color: #000 !important;
        font-size: 15px !important;
        font-weight: bold !important;
        padding: 8px 20px !important;
        box-shadow: 0 4px 15px rgba(0,0,0,0.4) !important;
      }

      .${READ_EFFECT_CLASS} {
        opacity: 0.35 !important;
        filter: grayscale(1) !important;
      }

      .${FAV_VISUAL_CLASS} {
        opacity: 1 !important;
        filter: none !important;
      }

      [data-missav-rf-visual] {
        position: relative !important;
      }

      .${FAV_FRAME_CLASS}, .${READ_FRAME_CLASS} {
        border: 4px solid rgba(255,255,255,.98) !important;
        border-radius: inherit !important;
        box-shadow:
          inset 0 0 0 1px rgba(0,0,0,.75),
          0 0 0 2px rgba(0,0,0,.65),
          0 0 16px rgba(255,255,255,.72) !important;
        inset: 0 !important;
        pointer-events: none !important;
        position: absolute !important;
        z-index: 2147483646 !important;
      }

      .${READ_FRAME_CLASS} {
        border: 3px solid rgba(100,100,100,.6) !important;
        box-shadow: inset 0 0 0 1px rgba(0,0,0,.3) !important;
        opacity: 0.8;
      }

      .${BADGE_CLASS} {
        align-items: center;
        border-radius: 999px !important;
        display: inline-flex;
        font-size: 11px !important;
        font-weight: 800;
        left: 6px !important;
        letter-spacing: 0.02em;
        line-height: 1 !important;
        padding: 4px 6px !important;
        pointer-events: none !important;
        position: absolute !important;
        top: 6px !important;
        z-index: 2147483647 !important;
      }

      .missav-rf-badge-read {
        background: rgba(90,90,90,.85) !important;
        color: #fff !important;
        border: 1px solid rgba(255,255,255,.3) !important;
      }

      .missav-rf-badge-fav {
        background: rgba(255,255,255,.95) !important;
        color: #000 !important;
        text-shadow: none !important;
        border: 1px solid rgba(0,0,0,.2) !important;
      }

      .missav-rf-badge-memo {
        background: rgba(255, 235, 59, 0.95) !important;
        color: #000 !important;
        border: 1px solid rgba(0,0,0,.2) !important;
        left: auto !important;
        right: 6px !important;
      }
    `;
    document.head.appendChild(style);
  }

  function getContentRoot() {
    return [...document.querySelectorAll('div.content-without-search')]
      .find((root) => root.querySelector('div.thumbnail.group'));
  }

  function getMainLayout() {
    const root = getContentRoot();
    if (!root) return null;

    return [...root.children]
      .find((child) => child.matches('div.flex') && child.querySelector('div.thumbnail.group')) || null;
  }

  function findRelatedContainers() {
    const layout = getMainLayout();
    if (!layout) return [];

    const containers = [];

    const sidebar = [...layout.children].find((child) =>
      hasClasses(child, ['hidden', 'lg:flex', 'h-full', 'ml-6', 'order-last']) &&
      child.querySelector('div.thumbnail.group')
    );
    if (sidebar) containers.push({ type: 'sidebar', element: sidebar });

    const mainColumn = [...layout.children].find((child) => hasClasses(child, ['flex-1', 'order-first']));
    if (mainColumn) {
      const grids = [...mainColumn.querySelectorAll('div.grid')]
        .filter((grid) =>
          hasClasses(grid, ['grid', 'grid-cols-2', 'md:grid-cols-3', 'xl:grid-cols-4', 'gap-5']) &&
          grid.querySelector('div.thumbnail.group')
        );

      for (const grid of grids) {
        containers.push({ type: 'grid', element: grid });
      }
    }

    return containers;
  }

  function isVideoPage() {
    if (!normalizeUrl(location.href)) return false;

    const title = document.querySelector('h1.text-base, h1');
    if (!title) return false;

    const hasPlayer = Boolean(document.querySelector('video, .plyr, [id*="player" i], [class*="player" i]'));
    const hasRelatedMarker = [...document.scripts].some((script) =>
      script.textContent.includes('placeHolderRelatedItems')
    );

    return hasPlayer || hasRelatedMarker || findRelatedContainers().length > 0;
  }

  function findTitleMount() {
    const title = document.querySelector('h1.text-base, h1');
    return title?.parentElement || title;
  }

  function handleImport() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          const newData = new Map(videoData);
          let count = 0;
          let updated = 0;

          // インポート用の一時的なデータを作成
          let importSource = {};
          if (parsed.videos) {
            importSource = parsed.videos;
          } else if (parsed.read || parsed.fav) {
            // 旧形式 {read: [], fav: []} からの変換
            (parsed.read || []).forEach(u => { importSource[u] = importSource[u] || { fav: false }; });
            (parsed.fav || []).forEach(u => { importSource[u] = { fav: true }; });
          } else {
            // 今回統一するフラット形式
            importSource = parsed;
          }

          // Support both object-mapped imports and array-style imports (with display-only numbering).
          let entries = [];
          if (Array.isArray(importSource)) {
            entries = importSource.map(item => {
              // item may be a string URL, an object { url, state }, or { url, fav, memo }
              if (typeof item === 'string') return [item, {}];
              if (item && typeof item === 'object' && item.url) return [item.url, item.state || { fav: !!item.fav, memo: item.memo, added: item.added }];
              if (Array.isArray(item) && item.length >= 2) return [item[0], item[1]];
              return null;
            }).filter(Boolean);
          } else {
            entries = Object.entries(importSource);
          }

          entries.forEach(([u, state]) => {
            const n = normalizeUrl(u);
            if (!n) return;

            // Remove display-only numbering fields if present so they don't affect stored data
            const cleanState = Object.assign({}, state);
            delete cleanState.no;
            delete cleanState.__no_for_display;

            if (!newData.has(n)) {
              // タイムスタンプがないデータにはインポート時の時間を付与
              newData.set(n, { ...cleanState, added: cleanState.added || Date.now() });
              count++;
            } else if (cleanState.fav && !newData.get(n).fav) {
              const existing = newData.get(n);
              newData.set(n, { ...existing, fav: true, memo: cleanState.memo || existing.memo });
              updated++;
            } else if (cleanState.memo && !newData.get(n).memo) {
              const existing = newData.get(n);
              newData.set(n, { ...existing, memo: cleanState.memo });
            }
          });

          videoData = newData;
          saveVideoData(videoData);
          alert(`インポート完了: 新規 ${count} 件 / 更新(お気に入り) ${updated} 件`);
          updateControls();
          scheduleApplyRelatedState();
        } catch (err) {
          alert('ファイルの解析に失敗しました。正しい形式のJSONファイルか確認してください。');
        }
      };
      reader.readAsText(file);
    };
    fileInput.click();
  }

  function setupControls() {
    if (!isVideoPage()) return;

    const currentUrl = normalizeUrl(location.href);
    if (!currentUrl) return;

    if (!document.getElementById(STATUS_BADGE_ID)) {
      const badgeContainer = document.createElement('div');
      badgeContainer.id = STATUS_BADGE_ID;
      document.body.appendChild(badgeContainer);
    }

    let controls = document.getElementById(CONTROL_ID);
    if (!controls) {
      const mount = findTitleMount();
      if (!mount?.parentElement) return;

      controls = document.createElement('div');
      controls.id = CONTROL_ID;
      controls.innerHTML = `
        <div id="missav-rf-video-list-container" style="display: none;">
          <div id="missav-rf-video-list-controls" style="flex-wrap: wrap; display: flex; gap: 8px;">
            <input type="search" id="missav-rf-list-search" placeholder="検索..." style="width: 100%; margin-bottom: 4px;">
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              <button type="button" data-filter="all" data-active="true">すべて</button>
              <button type="button" data-filter="fav">★のみ</button>
              <button type="button" data-filter="read">既読のみ</button>
            </div>
            <div style="display: flex; gap: 4px; border-left: 1px solid #ccc; padding-left: 8px; flex-wrap: wrap;">
              <button type="button" data-sort="newest" data-active="true">新着順</button>
              <button type="button" data-sort="oldest">古い順</button>
              <button type="button" data-sort="id-asc">ID昇順</button>
              <button type="button" data-sort="id-desc">ID降順</button>
            </div>
          </div>
          <div id="missav-rf-video-list"></div>
        </div>
        <div id="missav-rf-button-group">
          <div data-kind="stats" style="font-size: 11px !important; color: #fff !important; text-align: center; padding: 2px 0; font-weight: bold; text-shadow: 0 1px 3px rgba(0,0,0,0.8) !important;"></div>
          <textarea data-kind="memo" placeholder="メモを入力..." rows="1"></textarea>
          <button type="button" data-kind="read" aria-pressed="false">既読</button>
          <button type="button" data-kind="fav" aria-pressed="false">お気に入り</button>
          <button type="button" data-kind="settings" aria-expanded="false" title="同期設定">⚙️ 設定</button>
          <button type="button" data-kind="export" style="display: none; font-size: 12px !important;" title="この端末のデータをファイルに保存">同期(保存)</button>
          <button type="button" data-kind="import" style="display: none; font-size: 12px !important;" title="保存したファイルを読み込み">同期(読込)</button>
          <button type="button" data-kind="clear" style="display: none; font-size: 12px !important; color: #d32f2f !important;" title="すべてのデータを消去">データを全消去</button>
        </div>
      `;
      document.body.appendChild(controls);

      controls.addEventListener('input', (event) => {
        if (event.target.dataset.kind === 'memo') {
          adjustMemoHeight(event.target);
          const targetUrl = normalizeUrl(location.href);
          if (!targetUrl) return;
          const state = videoData.get(targetUrl) || { fav: false, added: Date.now() };
          state.memo = event.target.value;
          videoData.set(targetUrl, state);
          saveVideoData(videoData);
          scheduleApplyRelatedState();
        }
        if (event.target.id === 'missav-rf-list-search') {
          // 検索入力時にリストを再描画
          renderVideoList();
        }
      });

      controls.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;

        if (button.closest('#missav-rf-video-list-controls')) {
          const sort = button.dataset.sort;
          if (sort) {
            renderVideoList(sort, undefined);
          }
          const filter = button.dataset.filter;
          if (filter) {
            renderVideoList(undefined, undefined, filter);
          }
          return;
        }

        const kind = button.dataset.kind;
        if (!kind) return;

        if (kind === 'settings') {
          const isExpanded = button.getAttribute('aria-expanded') === 'true';
          const newState = !isExpanded;
          button.setAttribute('aria-expanded', String(newState));
          document.querySelectorAll('#missav-rf-button-group [data-kind="import"], #missav-rf-button-group [data-kind="export"], #missav-rf-button-group [data-kind="clear"], #missav-rf-video-list-container').forEach(el => {
            el.style.display = newState ? 'block' : 'none';
          });
          if (newState) {
            renderVideoList();
          }
          return;
        }

        if (kind === 'export') {
          // JSONも統一：LocalStorageと同じフラットなオブジェクト形式で書き出し
          const formatDateForExport = (d) => {
            const dt = d instanceof Date ? d : new Date(d);
            const y = dt.getFullYear();
            const m = String(dt.getMonth() + 1).padStart(2, '0');
            const day = String(dt.getDate()).padStart(2, '0');
            const hh = String(dt.getHours()).padStart(2, '0');
            const mm = String(dt.getMinutes()).padStart(2, '0');
            return `${y}-${m}-${day} ${hh}:${mm}`;
          };

          const orderedUrls = [...videoData.keys()];
          const transformedObj = Object.fromEntries(orderedUrls.map((u, idx) => {
            const state = Object.assign({}, videoData.get(u) || {});
            if (state.added !== undefined && state.added !== null) {
              state.added = formatDateForExport(state.added);
            }
            // display-only numbering inside each entry
            state.no = idx + 1;
            return [u, state];
          }));

          // Compute export timestamp used for filename
          const now = new Date();
          const y = now.getFullYear();
          const m = String(now.getMonth() + 1).padStart(2, '0');
          const d = String(now.getDate()).padStart(2, '0');
          const h = String(now.getHours()).padStart(2, '0');
          const min = String(now.getMinutes()).padStart(2, '0');
          const timestamp = `${y}-${m}-${d}_${h}-${min}`;

          const exportObj = { videos: transformedObj };

          const data = JSON.stringify(exportObj, null, 2);
          const blob = new Blob([data], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');

          a.href = url;
          const totalCount = videoData.size;
          a.download = `${totalCount}件_${timestamp}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          return;
        }

        if (kind === 'import') {
          handleImport();
          return;
        }

        if (kind === 'clear') {
          const isConfirming = button.getAttribute('data-confirming') === 'true';

          if (!isConfirming) {
            // 1段階目: 確認状態へ移行
            button.setAttribute('data-confirming', 'true');
            button.textContent = '確定: 全データを削除';
            button.style.setProperty('background', '#d32f2f', 'important');
            button.style.setProperty('color', '#fff', 'important');
            button.style.setProperty('opacity', '1', 'important');

            // 3秒経過したら元に戻す
            setTimeout(() => {
              button.setAttribute('data-confirming', 'false');
              button.textContent = 'データを全消去';
              button.style.setProperty('background', 'rgba(255,255,255,.96)', 'important');
              button.style.setProperty('color', '#d32f2f', 'important');
              button.style.removeProperty('opacity');
            }, 3000);
          } else {
            // 2段階目: 実際の削除処理
            localStorage.removeItem(DATA_KEY);
            localStorage.removeItem(OLD_READ_KEY);
            localStorage.removeItem(OLD_FAV_KEY);
            videoData = new Map();
            updateControls();
            scheduleApplyRelatedState();
            alert('すべてのデータを消去しました。');
          }
          return;
        }

        const targetUrl = normalizeUrl(location.href);
        if (!targetUrl) return;

        if (kind === 'read') {
          if (videoData.has(targetUrl)) {
            videoData.delete(targetUrl);
          } else {
            videoData.set(targetUrl, { fav: false, added: Date.now() });
          }
        }

        if (kind === 'fav') {
          const state = videoData.get(targetUrl) || { fav: false, added: Date.now() };
          videoData.set(targetUrl, {
            ...state,
            fav: !state.fav,
          });
        }

        saveVideoData(videoData);
        updateControls();
        scheduleApplyRelatedState();
      });
    }

    updateControls();
  }

  function renderVideoList(newSortOrder, newSearchTerm, newFilter) {
    const listEl = document.getElementById('missav-rf-video-list');
    const controlsEl = document.getElementById('missav-rf-video-list-controls');
    const searchInput = document.getElementById('missav-rf-list-search');
    if (!listEl || !controlsEl || !searchInput) return;

    // 現在の状態を取得または更新
    const currentSortBtn = controlsEl.querySelector('button[data-sort][data-active="true"]');
    const currentFilterBtn = controlsEl.querySelector('button[data-filter][data-active="true"]');
    let sortOrder = newSortOrder || currentSortBtn?.dataset.sort || 'newest';
    let filter = newFilter || currentFilterBtn?.dataset.filter || 'all';
    let searchTerm = (newSearchTerm !== undefined) ? newSearchTerm : searchInput.value.toLowerCase();

    if (searchInput.value.toLowerCase() !== searchTerm) {
      searchInput.value = searchTerm;
    }

    // ボタンのアクティブ状態を更新
    if (newSortOrder) {
      controlsEl.querySelectorAll('button[data-sort]').forEach(btn => {
        btn.dataset.active = String(btn.dataset.sort === newSortOrder);
      });
    }
    if (newFilter) {
      controlsEl.querySelectorAll('button[data-filter]').forEach(btn => {
        btn.dataset.active = String(btn.dataset.filter === newFilter);
      });
    }

    const items = [...videoData.entries()].filter(([url, state]) => {
      if (filter === 'fav') return state.fav;
      if (filter === 'read') return !state.fav;
      return true; // 'all'
    });

    let filteredItems = items.filter(([url, state]) => {
      const slug = url.split('/').pop().toLowerCase();
      const memo = state.memo?.toLowerCase() || '';
      return slug.includes(searchTerm) || memo.includes(searchTerm);
    });

    filteredItems.sort((a, b) => {
      const slugA = a[0].split('/').pop();
      const slugB = b[0].split('/').pop();

      const toTs = (v) => {
        if (v === undefined || v === null) return 0;
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
          // Accept "YYYY-MM-DD HH:MM" by converting space to 'T', and fallback to Date constructor
          const iso = v.replace(' ', 'T');
          const t = Date.parse(iso);
          if (!isNaN(t)) return t;
          const d = new Date(v);
          return isNaN(d.getTime()) ? 0 : d.getTime();
        }
        if (v instanceof Date) return v.getTime();
        return 0;
      };

      const addedA = toTs(a[1].added);
      const addedB = toTs(b[1].added);

      switch (sortOrder) {
        case 'oldest':
          return addedA - addedB;
        case 'id-asc':
          return slugA.localeCompare(slugB, undefined, { numeric: true, sensitivity: 'base' });
        case 'id-desc':
          return slugB.localeCompare(slugA, undefined, { numeric: true, sensitivity: 'base' });
        case 'newest':
        default:
          return addedB - addedA; // Default to newest
      }
    });

    listEl.innerHTML = '';
    if (filteredItems.length === 0) {
      listEl.textContent = 'データがありません。';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const [url, state] of filteredItems) {
      const item = document.createElement('a');
      item.href = url;
      item.className = 'missav-rf-video-list-item';

      const slug = url.split('/').pop();
      const status = state.fav ? '★' : '既読';
      const memo = (state.memo && state.memo.trim()) ? '📝' : '';
      const date = state.added ? new Date(state.added).toLocaleDateString() : '日付不明';

      item.innerHTML = `
        <span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${slug}</span>
        <span style="margin-left: 8px; color: #888; font-size: 11px;">${date}</span>
        <span style="margin-left: 8px; width: 50px; text-align: right;">${status} ${memo}</span>`;

      // 左クリック時に新しいタブで開くようにする
      item.addEventListener('mousedown', (e) => {
        if (e.button === 0) { // 左クリックのみ
          e.preventDefault();
          window.open(item.href, '_blank');
        }
      });
      fragment.appendChild(item);
    }
    listEl.appendChild(fragment);
  }

  function updateControls() {
    const controls = document.getElementById(CONTROL_ID);
    const currentUrl = normalizeUrl(location.href);
    if (!controls) return;

    if (!isVideoPage() || !currentUrl) {
      controls.style.display = 'none';
      return;
    }
    controls.style.display = 'flex';

    const readButton = controls.querySelector('[data-kind="read"]');
    const favButton = controls.querySelector('[data-kind="fav"]');
    const stats = controls.querySelector('[data-kind="stats"]');
    const memoArea = controls.querySelector('[data-kind="memo"]');
    const statusBadge = document.getElementById(STATUS_BADGE_ID);

    const state = videoData.get(currentUrl);

    // isVideoPageがtrueのときだけ表示
    const buttonGroup = document.getElementById('missav-rf-button-group');
    if (buttonGroup) {
        buttonGroup.style.display = 'flex';
    }

    setButtonState(readButton, !!state, '既読');

    if (memoArea) {
      memoArea.style.display = state?.fav ? 'block' : 'none';
    }

    setButtonState(favButton, !!state?.fav, 'お気に入り');

    if (memoArea) {
      // 入力中の内容を上書きしないよう、フォーカス時は更新しない
      if (document.activeElement !== memoArea) {
        memoArea.value = state?.memo || '';
        adjustMemoHeight(memoArea);
      }
    }

    if (stats) {
      const favCount = [...videoData.values()].filter(v => v.fav).length;
      stats.textContent = `既読: ${videoData.size} / ★: ${favCount}`;
    }

    if (statusBadge) {
      if (state) {
        statusBadge.style.display = 'block';
        statusBadge.innerHTML = state.fav
          ? '<div class="missav-rf-status-floating-item">★ お気に入り済み</div>'
          : '<div class="missav-rf-status-floating-item">既読済み</div>';
      } else {
        statusBadge.style.display = 'none';
      }
    }
  }

  function adjustMemoHeight(el) {
    if (!el) return;
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('height', `${el.scrollHeight}px`, 'important');
  }

  function setButtonState(button, active, label) {
    if (!button) return;
    button.dataset.active = String(active);
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? `${label}済み` : label;
  }

  function getCards(containerInfo) {
    if (containerInfo.type === 'sidebar') {
      return [...containerInfo.element.querySelectorAll('.flex.mb-6')]
        .filter((card) => card.querySelector('div.thumbnail.group'));
    }

    return [...containerInfo.element.children]
      .filter((card) => card.matches('div.thumbnail.group'));
  }

  function getCardParts(card) {
    const thumbnail = card.matches('div.thumbnail.group')
      ? card
      : card.querySelector('div.thumbnail.group');

    const visual = card;
    const frameTarget = thumbnail?.querySelector('.relative.aspect-w-16.aspect-h-9') || thumbnail || card;
    const link = thumbnail?.querySelector('a[href]') || card.querySelector('a[href]');

    return {
      thumbnail,
      visual,
      frameTarget,
      url: normalizeUrl(link?.href),
    };
  }

  function clearCardState(card) {
    card.removeAttribute('data-missav-rf-card');
    card.removeAttribute('data-missav-rf-state');
    card.classList.remove(READ_EFFECT_CLASS, FAV_VISUAL_CLASS);

    for (const element of card.querySelectorAll(`.${BADGE_CLASS}`)) {
      element.remove();
    }

    for (const element of card.querySelectorAll(`.${FAV_FRAME_CLASS}, .${READ_FRAME_CLASS}`)) {
      element.remove();
    }

    for (const element of card.querySelectorAll(`.${READ_EFFECT_CLASS}`)) {
      element.classList.remove(READ_EFFECT_CLASS);
    }

    for (const element of card.querySelectorAll(`.${FAV_VISUAL_CLASS}`)) {
      element.classList.remove(FAV_VISUAL_CLASS);
    }

    for (const element of card.querySelectorAll('[data-missav-rf-visual]')) {
      element.removeAttribute('data-missav-rf-visual');
    }
  }

  function applyReadEffect(card, visual) {
    card.classList.add(READ_EFFECT_CLASS);
  }

  function addBadge(visual, text, kind) {
    const badge = document.createElement('span');
    badge.className = `${BADGE_CLASS} missav-rf-badge-${kind}`;
    badge.textContent = text;
    visual.appendChild(badge);
  }

  function applyCardState(card) {
    const { visual, frameTarget, url } = getCardParts(card);
    clearCardState(card);

    if (!url || !visual) return;

    const state = videoData.get(url);
    if (!state) return;

    card.dataset.missavRfCard = 'true';
    visual.dataset.missavRfVisual = 'true';

    if (state.fav) {
      card.dataset.missavRfState = 'fav';
      visual.classList.add(FAV_VISUAL_CLASS);
      frameTarget.dataset.missavRfVisual = 'true';
      const frame = document.createElement('span');
      frame.className = FAV_FRAME_CLASS;
      frameTarget.appendChild(frame);
      addBadge(visual, '★', 'fav');

      // お気に入りの時だけメモバッジを表示
      if (state.memo && state.memo.trim()) {
        addBadge(visual, '📝', 'memo');
      }
      return;
    }

    card.dataset.missavRfState = 'read';
    applyReadEffect(card, visual);

    frameTarget.dataset.missavRfVisual = 'true';
    const frame = document.createElement('span');
    frame.className = READ_FRAME_CLASS;
    frameTarget.appendChild(frame);
    addBadge(visual, '既読', 'read');
  }

  function applyRelatedState() {
    if (!isVideoPage()) return;

    const containers = findRelatedContainers();
    for (const container of containers) {
      for (const card of getCards(container)) {
        applyCardState(card);
      }
    }
  }

  function scheduleApplyRelatedState() {
    if (applyQueued) return;

    applyQueued = true;
    requestAnimationFrame(() => {
      applyQueued = false;
      applyRelatedState();
    });
  }

  function startObserver() {
    if (observer) return;

    const root = getContentRoot();
    if (!root) return;

    observer = new MutationObserver(scheduleApplyRelatedState);
    observer.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  function boot() {
    reloadData();
    injectStyles();
    setupControls();
    applyRelatedState();
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener('load', boot, { once: true });
  window.addEventListener('storage', (event) => {
    if (event.key !== DATA_KEY) return;
    reloadData();
    updateControls();
    if (document.getElementById('missav-rf-video-list-container')?.style.display === 'block') renderVideoList();
    scheduleApplyRelatedState();
  });

  for (const delay of [500, 1500, 3000, 6000]) {
    window.setTimeout(() => {
      setupControls();
      scheduleApplyRelatedState();
      startObserver();
    }, delay);
  }
})();

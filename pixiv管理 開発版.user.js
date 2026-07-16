// ==UserScript==
// @name         Pixiv管理 開発版v4.0.8
// @namespace    https://example.com/userscripts
// @version      4.0.8
// @description  Pixiv の関連項目に表示される、設定したユーザーのサムネをグレー化します。右下に設定ボタンを追加します。
// @match        https://www.pixiv.net/*
// @match        https://pixiv.net/*
// @match        https://touch.pixiv.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'pixiv_follow_gray_users_v1';
    const DEFAULT_STATE = { enabled: true, users: [], mobileLayout: false };
    let state = loadState();
    const IS_FOLLOWING_PAGE = /^\/users\/\d+\/following\/?$/.test(location.pathname) || (/^\/bookmark\.php$/.test(location.pathname) && /[?&]type=user/.test(location.search));
    const IS_USER_PAGE = /^\/users\/(\d+)\/?$/.test(location.pathname) || (/^\/member\.php$/.test(location.pathname) && /[?&]id=\d+/.test(location.search));
    let observer = null;
    let scheduled = false;
    let userListSortOrder = 'asc';
    let userListFilter = '';

    // Memory cache for mapping artwork ID to user ID
    const illustToUserMap = new Map();

    // Intercept fetch to gather artwork-to-user mappings
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const clone = response.clone();
            clone.json().then(data => {
                extractMappings(data);
            }).catch(() => {});
        } catch (e) {}
        return response;
    };

    function extractMappings(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            obj.forEach(extractMappings);
            return;
        }
        const id = obj.id || obj.illustId || obj.illust_id;
        const userId = obj.userId || obj.user_id || obj.authorId;
        if (id && userId && String(id).match(/^\d+$/) && String(userId).match(/^\d+$/)) {
            illustToUserMap.set(String(id), String(userId));
        }
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const val = obj[key];
                if (val && typeof val === 'object') {
                    extractMappings(val);
                }
            }
        }
    }

    // Parse preloaded data if any
    try {
        const preloadEl = document.getElementById('meta-preload-data');
        if (preloadEl) {
            const content = preloadEl.getAttribute('content');
            if (content) {
                extractMappings(JSON.parse(content));
            }
        }
    } catch (e) {}

    injectStyles();
    createSettingsUI();
    applyMobileLayoutClass();
    bindEvents();
    applyGrayStyle();
    showUserPageBadge();
    startObserver();

    // Safety timer to guarantee periodic execution in mobile environment
    setInterval(() => {
        if (state.enabled && state.users.length) {
            applyGrayStyle();
        }
    }, 1500);

    window.addEventListener('load', () => applyGrayStyle());

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...DEFAULT_STATE };
            const parsed = JSON.parse(raw);
            return {
                enabled: parsed.enabled !== false,
                users: Array.isArray(parsed.users) ? parsed.users : [],
                mobileLayout: parsed.mobileLayout === true
            };
        } catch (e) {
            return { ...DEFAULT_STATE };
        }
    }

    function saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        updateCountLabel();
        showUserPageBadge();
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.id = 'pixiv-follow-gray-style';
        style.textContent = `
            .pixiv-follow-gray-target {
                filter: grayscale(1) !important;
                opacity: 0.6 !important;
                will-change: filter, opacity;
                transform: translateZ(0);
                -webkit-transform: translateZ(0);
            }
            .pixiv-follow-gray-target img,
            .pixiv-follow-gray-target picture,
            .pixiv-follow-gray-target canvas,
            .pixiv-follow-gray-target a {
                filter: grayscale(1) !important;
            }
            #pixiv-follow-gray-settings {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 2147483647;
                display: flex;
                flex-direction: column-reverse;
                align-items: flex-end;
                gap: 8px;
                font-family: Arial, sans-serif;
                font-size: 12px;
                color: #111827;
                pointer-events: none;
            }
            #pixiv-follow-gray-toggle-btn,
            #pixiv-follow-gray-panel {
                pointer-events: auto;
            }
            #pixiv-follow-gray-toggle-btn {
                width: 48px;
                height: 48px;
                border: 2px solid rgba(255,255,255,0.95);
                border-radius: 50%;
                background: linear-gradient(135deg, #2563eb, #1d4ed8);
                color: #ffffff;
                box-shadow: 0 6px 16px rgba(0,0,0,0.25);
                cursor: pointer;
                font-size: 22px;
                font-weight: 700;
                line-height: 1;
            }
            #pixiv-follow-gray-panel {
                display: none;
                width: 320px;
                max-width: calc(100vw - 32px);
                margin-top: 2px;
                padding: 14px;
                border: 1px solid rgba(37, 99, 235, 0.18);
                border-radius: 12px;
                background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
                box-shadow: 0 10px 24px rgba(15, 23, 42, 0.24);
                color: #111827;
            }
            #pixiv-follow-gray-panel.open {
                display: block;
            }
            #pixiv-follow-gray-panel .panel-title {
                font-size: 13px;
                font-weight: 700;
                color: #0f172a;
                margin-bottom: 8px;
            }
            #pixiv-follow-gray-panel input[type="text"] {
                width: 100%;
                margin-top: 6px;
                box-sizing: border-box;
                padding: 8px;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                background: #ffffff;
                color: #111827;
                font-size: 12px;
                line-height: 1.4;
            }
            #pixiv-follow-gray-panel button {
                margin-top: 8px;
                margin-right: 8px;
                padding: 7px 11px;
                border: 1px solid #2563eb;
                border-radius: 8px;
                background: #2563eb;
                color: #ffffff;
                cursor: pointer;
                font-weight: 600;
            }
            #pixiv-follow-gray-panel button:hover {
                background: #1d4ed8;
            }
            #pixiv-follow-gray-panel label,
            #pixiv-follow-gray-panel .count-label {
                display: block;
                margin-top: 6px;
                color: #334155;
                font-weight: 600;
            }
            #pixiv-follow-gray-settings .list-controls {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                margin-top: 8px;
            }
            #pixiv-follow-gray-settings .list-controls input[type="text"] {
                flex: 1 1 auto;
                min-width: 120px;
                padding: 7px 8px;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                background: #fff;
                color: #111827;
                font-size: 12px;
            }
            /* user list: move left of panel and keep vertical scroll */
            #pixiv-follow-gray-panel {
                position: relative;
            }
            #pixiv-follow-gray-panel .user-list {
                position: absolute;
                right: 100%;
                bottom: 0;
                width: 260px;
                max-height: 260px;
                overflow-y: auto;
                overflow-x: hidden;
                border: 1px solid #cbd5e1;
                border-radius: 10px;
                background: #f8fafc;
                padding: 8px;
                display: block;
                box-shadow: 0 8px 20px rgba(2,6,23,0.08);
                transform: translateX(-12px);
            }
            #pixiv-follow-gray-panel .user-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                margin-bottom: 6px;
                padding: 6px 8px;
                border-radius: 8px;
                background: #ffffff;
                border: 1px solid rgba(148,163,184,0.2);
                font-size: 12px;
                color: #111827;
                width: 100%;
                box-sizing: border-box;
            }
            #pixiv-follow-gray-panel .user-item:last-child {
                margin-bottom: 0;
            }
            #pixiv-follow-gray-panel .user-item button {
                margin-top: 0;
                margin-right: 0;
                padding: 4px 8px;
                border-radius: 8px;
                font-size: 11px;
            }
            #pixiv-follow-gray-panel .user-item .delete-btn {
                background: #ef4444;
                border-color: #ef4444;
            }
            #pixiv-follow-gray-panel .user-item .delete-btn:hover {
                background: #dc2626;
            }
            #pixiv-follow-gray-panel input[type="checkbox"] {
                accent-color: #2563eb;
                transform: translateY(1px);
            }
            /* mobile tweaks */
            @media (max-width: 640px) {
                #pixiv-follow-gray-settings {
                    bottom: 80px !important; /* Avoid overlapping with mobile browser UI and Pixiv footer */
                }
                #pixiv-follow-gray-panel {
                    width: 90vw;
                    left: 5vw;
                    right: auto;
                    padding: 10px;
                    font-size: 13px;
                }
                #pixiv-follow-gray-toggle-btn {
                    width: 44px;
                    height: 44px;
                    font-size: 20px;
                }
                #pixiv-follow-gray-panel .user-list {
                    position: static;
                    width: 100%;
                    max-height: 200px;
                    transform: none;
                    box-shadow: none;
                }
                #pixiv-follow-badge {
                    bottom: 14px;
                }
            }
            /* PC layout responsive design for mobile screens (unconditional when active) */
            .pixiv-mobile-layout-active,
            .pixiv-mobile-layout-active body,
            .pixiv-mobile-layout-active #root,
            .pixiv-mobile-layout-active #app-mount-point {
                min-width: unset !important;
                width: 100% !important;
                overflow-x: hidden !important;
            }
            .pixiv-mobile-layout-active main {
                width: 100% !important;
                min-width: unset !important;
                padding: 0 !important;
                margin: 0 !important;
            }
            /* Main columns container (illustration + sidebar) */
            .pixiv-mobile-layout-active main > div {
                display: flex !important;
                flex-direction: column !important;
                width: 100% !important;
                padding: 0 !important;
            }
            /* Illustration area and sidebar area */
            .pixiv-mobile-layout-active main > div > div {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 8px !important;
                box-sizing: border-box !important;
            }
            /* Image adjustments */
            .pixiv-mobile-layout-active main img {
                max-width: 100% !important;
                height: auto !important;
                object-fit: contain !important;
            }
            /* Header / Nav area */
            .pixiv-mobile-layout-active header {
                width: 100% !important;
                min-width: unset !important;
                padding: 0 8px !important;
            }
            /* Target grids to be 2 columns on mobile screens */
            .pixiv-mobile-layout-active div[style*="grid-template-columns"], 
            .pixiv-mobile-layout-active ul[style*="grid-template-columns"] {
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 8px !important;
            }
            /* Common Pixiv PC recommendation grid classes */
            .pixiv-mobile-layout-active [class*="Grid"], 
            .pixiv-mobile-layout-active [class*="grid"] {
                grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)) !important;
                gap: 8px !important;
            }
        `;
        document.head.appendChild(style);
    }

    function applyMobileLayoutClass() {
        if (state.mobileLayout) {
            document.documentElement.classList.add('pixiv-mobile-layout-active');
        } else {
            document.documentElement.classList.remove('pixiv-mobile-layout-active');
        }
    }

    function createSettingsUI() {
        const wrap = document.createElement('div');
        wrap.id = 'pixiv-follow-gray-settings';

        const button = document.createElement('button');
        button.id = 'pixiv-follow-gray-toggle-btn';
        button.type = 'button';
        button.title = 'Pixiv 管理設定';
        button.textContent = '⚙';
        wrap.appendChild(button);

        const panel = document.createElement('div');
        panel.id = 'pixiv-follow-gray-panel';
        panel.innerHTML = `
            <div class="panel-title">Pixiv 管理</div>
            <label><input id="pixiv-follow-gray-enabled" type="checkbox"> 機能を有効化</label>
            <label><input id="pixiv-follow-mobile-layout" type="checkbox"> PC版でモバイル表示化</label>
            <div class="count-label" id="pixiv-follow-gray-count">適用ユーザー数: 0人　記録ユーザー数: 0人</div>
            <input id="pixiv-follow-gray-user-list" type="text" placeholder="追加するユーザーIDまたはURLを入力\n例: 12345\nhttps://www.pixiv.net/users/12345"></textarea>
            <div class="list-controls">
                <input id="pixiv-follow-search-input" type="text" placeholder="リスト検索">
                <button id="pixiv-follow-sort-asc-btn" type="button">昇順</button>
                <button id="pixiv-follow-sort-desc-btn" type="button">降順</button>
            </div>
            <div class="user-list" id="pixiv-follow-user-list-container"></div>
            <div>
                <button id="pixiv-follow-gray-save-btn" type="button">保存</button>
                <button id="pixiv-follow-gray-load-btn" type="button">読み込み</button>
                <button id="pixiv-follow-clear-all-btn" type="button">全削除</button>
                <button id="pixiv-follow-export-btn" type="button">エクスポート</button>
                <button id="pixiv-follow-import-btn" type="button">インポート</button>
                <input id="pixiv-follow-import-file" type="file" accept="application/json" style="display:none">
            </div>
            <hr>
            <div>
                <label><input id="pixiv-follow-auto-save-checkbox" type="checkbox"> フォロー済みを自動で保存</label>
                <button id="pixiv-follow-scan-btn" type="button">hoverでスキャンして保存</button>
                <div id="pixiv-follow-scan-status" style="margin-top:6px;font-size:12px;color:#374151">状態: 停止中</div>
            </div>
        `;
        wrap.appendChild(panel);
        document.body.appendChild(wrap);
    }

    // ユーザーページ用の「記録済み」バッジを作成/表示
    function createUserPageBadge() {
        if (document.getElementById('pixiv-follow-badge')) return;
        const el = document.createElement('div');
        el.id = 'pixiv-follow-badge';
        el.style.position = 'fixed';
        el.style.bottom = '20px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.padding = '8px 12px';
        el.style.borderRadius = '12px';
        el.style.background = 'linear-gradient(90deg,#2563eb,#1d4ed8)';
        el.style.color = '#ffffff';
        el.style.fontWeight = '700';
        el.style.zIndex = '2147483647';
        el.style.boxShadow = '0 8px 20px rgba(15,23,42,0.28)';
        el.style.pointerEvents = 'auto';
        el.style.fontFamily = 'Arial, sans-serif';
        el.style.fontSize = '13px';
        el.style.display = 'none';
        el.innerHTML = '<span>記録済み</span> <button id="pixiv-follow-badge-delete" style="margin-left:10px;padding:4px 8px;border:none;border-radius:8px;background:#ef4444;color:#fff;font-size:11px;cursor:pointer;">削除</button>';
        document.body.appendChild(el);
        el.addEventListener('click', (ev) => {
            if (ev.target && ev.target.id === 'pixiv-follow-badge-delete') {
                let userId = '';
                const m = location.pathname.match(/^\/users\/(\d+)\/?$/);
                if (m) {
                    userId = m[1];
                } else {
                    const searchParams = new URLSearchParams(location.search);
                    userId = searchParams.get('id') || '';
                }
                if (userId) {
                    removeUserById(userId);
                }
            }
        });
    }

    function showUserPageBadge() {
        try {
            if (!IS_USER_PAGE) return;
            createUserPageBadge();
            let userId = '';
            const m = location.pathname.match(/^\/users\/(\d+)\/?$/);
            if (m) {
                userId = m[1];
            } else {
                const searchParams = new URLSearchParams(location.search);
                userId = searchParams.get('id') || '';
            }
            if (!userId) return;
            const badge = document.getElementById('pixiv-follow-badge');
            if (!badge) return;
            // 表示条件: 記録済みユーザーであれば表示
            const recorded = Array.isArray(state.users) && state.users.indexOf(userId) !== -1;
            if (recorded) {
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        } catch (e) {
            // ignore
        }
    }

    function bindEvents() {
        const toggleBtn = document.getElementById('pixiv-follow-gray-toggle-btn');
        const panel = document.getElementById('pixiv-follow-gray-panel');
        const enabledInput = document.getElementById('pixiv-follow-gray-enabled');
        const mobileLayoutInput = document.getElementById('pixiv-follow-mobile-layout');
        const userList = document.getElementById('pixiv-follow-gray-user-list');
        const saveBtn = document.getElementById('pixiv-follow-gray-save-btn');
        const loadBtn = document.getElementById('pixiv-follow-gray-load-btn');

        toggleBtn.addEventListener('click', () => {
            panel.classList.toggle('open');
        });

        enabledInput.addEventListener('change', () => {
            state.enabled = enabledInput.checked;
            saveState();
            applyGrayStyle();
        });

        mobileLayoutInput.addEventListener('change', () => {
            state.mobileLayout = mobileLayoutInput.checked;
            saveState();
            applyMobileLayoutClass();
        });

        saveBtn.addEventListener('click', () => {
            const newUsers = parseUserIds(userList.value);
            if (newUsers.length) {
                const existing = Array.isArray(state.users) ? state.users : [];
                const set = new Set(existing.concat(newUsers));
                state.users = Array.from(set);
                state.enabled = enabledInput.checked;
                saveState();
                applyGrayStyle();
                userList.value = '';
                renderUserList();
            }
        });

        loadBtn.addEventListener('click', () => {
            loadUiFromState();
        });

        const clearAllBtn = document.getElementById('pixiv-follow-clear-all-btn');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                if (!confirm('記録を全て削除しますか？')) return;
                state.users = [];
                saveState();
                loadUiFromState();
                applyGrayStyle();
                showUserPageBadge();
            });
        }

        const searchInput = document.getElementById('pixiv-follow-search-input');
        const sortAscBtn = document.getElementById('pixiv-follow-sort-asc-btn');
        const sortDescBtn = document.getElementById('pixiv-follow-sort-desc-btn');
        const userListContainer = document.getElementById('pixiv-follow-user-list-container');

        searchInput.addEventListener('input', () => {
            userListFilter = searchInput.value;
            renderUserList();
        });

        sortAscBtn.addEventListener('click', () => {
            userListSortOrder = 'asc';
            renderUserList();
        });

        sortDescBtn.addEventListener('click', () => {
            userListSortOrder = 'desc';
            renderUserList();
        });

        userListContainer.addEventListener('click', (ev) => {
            const target = ev.target;
            if (target && target.matches('.delete-btn')) {
                const userId = target.getAttribute('data-user-id');
                if (userId) {
                    removeUserById(userId);
                }
            }
        });

        // auto-save controls
        const autoChk = document.getElementById('pixiv-follow-auto-save-checkbox');
        const scanBtn = document.getElementById('pixiv-follow-scan-btn');
        const statusEl = document.getElementById('pixiv-follow-scan-status');
        let autoScanInterval = null;

        scanBtn.addEventListener('click', async () => {
            statusEl.textContent = '状態: スキャン中...';
            await scanAndAutoSave();
            statusEl.textContent = '状態: 停止中';
        });

        autoChk.addEventListener('change', () => {
            if (autoChk.checked) {
                statusEl.textContent = '状態: 自動スキャン 有効';
                autoScanInterval = setInterval(() => {
                    scanAndAutoSave();
                }, 8000);
            } else {
                statusEl.textContent = '状態: 停止中';
                if (autoScanInterval) clearInterval(autoScanInterval);
                autoScanInterval = null;
            }
        });

        // If we're on the user's following page, enable auto behavior by default
        if (IS_FOLLOWING_PAGE) {
            try {
                autoChk.checked = true;
                autoChk.dispatchEvent(new Event('change'));
            } catch (e) {
                // ignore
            }
        }

        // export / import
        const exportBtn = document.getElementById('pixiv-follow-export-btn');
        const importBtn = document.getElementById('pixiv-follow-import-btn');
        const fileInput = document.getElementById('pixiv-follow-import-file');

        exportBtn.addEventListener('click', () => {
            exportStateToFile();
        });

        importBtn.addEventListener('click', () => {
            fileInput.value = '';
            fileInput.click();
        });

        fileInput.addEventListener('change', (ev) => {
            const f = ev.target.files && ev.target.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const txt = String(e.target.result || '');
                    importStateFromText(txt);
                    alert('インポート完了');
                    loadUiFromState();
                    applyGrayStyle();
                } catch (err) {
                    alert('インポートに失敗しました: ' + err);
                }
            };
            reader.readAsText(f, 'utf-8');
        });

        document.addEventListener('click', (event) => {
            const panelOpen = panel.classList.contains('open');
            const clickedInside = wrapContains(event.target, 'pixiv-follow-gray-settings');
            if (panelOpen && !clickedInside) {
                panel.classList.remove('open');
            }
        });

        loadUiFromState();
    }

    function wrapContains(target, id) {
        const root = document.getElementById(id);
        return !!(root && root.contains(target));
    }

    function loadUiFromState() {
        const enabledInput = document.getElementById('pixiv-follow-gray-enabled');
        const mobileLayoutInput = document.getElementById('pixiv-follow-mobile-layout');
        const userList = document.getElementById('pixiv-follow-gray-user-list');
        enabledInput.checked = state.enabled;
        if (mobileLayoutInput) mobileLayoutInput.checked = !!state.mobileLayout;
        userList.value = '';
        renderUserList();
        updateCountLabel();
        applyMobileLayoutClass();
    }

    function renderUserList() {
        const container = document.getElementById('pixiv-follow-user-list-container');
        if (!container) return;
        const users = getSortedAndFilteredUsers();
        if (!users.length) {
            container.innerHTML = '<div style="color:#475569;font-size:12px;padding:8px;">記録したユーザーはありません。</div>';
            return;
        }
        container.innerHTML = users.map((userId) => {
            return `<div class="user-item" data-user-id="${userId}"><span>${userId}</span><button type="button" class="delete-btn" data-user-id="${userId}">削除</button></div>`;
        }).join('');
    }

    function getSortedAndFilteredUsers() {
        const filter = String(userListFilter || '').trim();
        const filtered = Array.isArray(state.users) ? state.users.filter((userId) => {
            if (!filter) return true;
            return userId.includes(filter);
        }) : [];
        return filtered.slice().sort((a, b) => {
            const aNum = parseInt(a, 10);
            const bNum = parseInt(b, 10);
            if (userListSortOrder === 'asc') {
                return aNum - bNum;
            }
            return bNum - aNum;
        });
    }

    function removeUserById(userId) {
        const existing = Array.isArray(state.users) ? state.users : [];
        const updated = existing.filter((id) => id !== userId);
        state.users = updated;
        saveState();
        loadUiFromState();
        applyGrayStyle();
        showUserPageBadge();
    }

    function clearAllUsers() {
        state.users = [];
        saveState();
        loadUiFromState();
        applyGrayStyle();
        showUserPageBadge();
    }

    // Parse user ID from node (either PC/Mobile user links or cached illust ID mapping)
    function getUserIdFromElement(node) {
        const direct = node.getAttribute('data-user-id') || node.getAttribute('data-user') || node.getAttribute('data-id');
        if (direct) return String(direct).trim();
        const href = node.getAttribute('href') || '';
        let match = href.match(/\/users\/(\d+)/i) || href.match(/member\.php\?.*id=(\d+)/i) || href.match(/[?&]id=(\d+)/i);
        if (match) return match[1];
        match = href.match(/\/artworks\/(\d+)/i) || href.match(/member_illust\.php\?.*illust_id=(\d+)/i) || href.match(/[?&]illust_id=(\d+)/i);
        if (match) {
            const illustId = match[1];
            if (illustToUserMap.has(illustId)) {
                return illustToUserMap.get(illustId);
            }
        }
        return '';
    }

    function updateCountLabel(appliedCount) {
        const countEl = document.getElementById('pixiv-follow-gray-count');
        if (!countEl) return;
        const applied = typeof appliedCount === 'number' ? appliedCount : (state.enabled ? state.users.length : 0);
        const recorded = Array.isArray(state.users) ? state.users.length : 0;
        countEl.textContent = `適用ユーザー数: ${applied}人　記録ユーザー数: ${recorded}人`;
    }

    function parseUserIds(text) {
        if (!text) return [];
        const trimmed = String(text).trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed.map(normalizeUserId).filter(Boolean);
                }
            } catch (e) {
                // fall through
            }
        }
        const rawItems = trimmed.split(/[\s,，\n]+/);
        return Array.from(new Set(rawItems.map(normalizeUserId).filter(Boolean)));
    }

    function normalizeUserId(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        const match = text.match(/\/users\/(\d+)/i) || text.match(/(\d{2,})/);
        return match ? match[1] : '';
    }

    function startObserver() {
        if (observer) return;
        observer = new MutationObserver(() => scheduleApply());
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['href', 'src', 'class', 'data-user-id']
        });
    }

    function scheduleApply() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            applyGrayStyle();
            if (IS_FOLLOWING_PAGE) markFollowingPageUsersApplied();
        });
    }

    function applyGrayStyle() {
        removeGrayStyleFromAll();

        if (!(/\/artworks\//.test(location.pathname) || /member_illust\.php/.test(location.pathname)) || !state.enabled || !state.users.length) {
            updateCountLabel(0);
            return;
        }

        let relatedSection = findRelatedWorksSection();
        if (!relatedSection) {
            // Fallback to document.body if related works section cannot be determined (especially on mobile)
            relatedSection = document.body;
        }

        const targets = new Set(state.users);
        const relatedNodes = relatedSection.querySelectorAll('a[href*="/users/"], a[href*="users/"], a[href*="member.php"], a[href*="/artworks/"], a[href*="member_illust.php"], [data-user-id]');
        let matchedCount = 0;

        relatedNodes.forEach((node) => {
            const userId = getUserIdFromElement(node);
            if (!userId || !targets.has(userId)) return;
            matchedCount += 1;

            const card = findRelatedItemCard(node);
            card.classList.add('pixiv-follow-gray-target');
        });

        updateCountLabel(matchedCount);
    }

    function findRelatedWorksSection() {
        const sectionLabel = /関連作品|おすすめ作品|Related works|Related illustrations|Recommended works|Recommended/i;
        const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span'))
            .filter((el) => {
                const text = (el.textContent || '').trim();
                return text.length > 0 && text.length < 40 && sectionLabel.test(text);
            });

        for (const el of candidates) {
            const section = el.closest('section') || el.closest('div');
            if (section) {
                return section;
            }
        }

        // Fallback for mobile or different layouts: find a container after the main artwork area
        try {
            const main = document.querySelector('main, article, [role="main"], #root');
            if (main) {
                let sib = main.nextElementSibling;
                while (sib) {
                    const anchors = Array.from(sib.querySelectorAll('a[href*="/users/"]'));
                    if (anchors.length >= 3) return sib;
                    sib = sib.nextElementSibling;
                }
            }
        } catch (e) {
            // ignore
        }

        // Another fallback: find any container with multiple thumbnails linking to users
        const allContainers = Array.from(document.querySelectorAll('div,section'));
        for (const c of allContainers) {
            try {
                const anchors = c.querySelectorAll('a[href*="/users/"]');
                if (anchors && anchors.length >= 4) {
                    // avoid picking the whole page
                    if (!c.closest('body')) continue;
                    return c;
                }
            } catch (e) {}
        }

        return null;
    }

    function findRelatedItemCard(node) {
        let closestCard = node;
        let current = node.parentElement;

        while (current && current !== document.body) {
            // Find parent containing work link (works on both PC & mobile)
            if (current.querySelector('a[href*="/artworks/"]') || current.querySelector('a[href*="member_illust.php"]')) {
                return current;
            }
            const media = Array.from(current.querySelectorAll('img, video, picture, canvas'));
            const outsideMedia = media.filter((el) => !node.contains(el));
            if (outsideMedia.length > 0) {
                return current;
            }
            if (media.length > 1) {
                return current;
            }
            closestCard = current;
            current = current.parentElement;
        }

        return closestCard;
    }

    function removeGrayStyleFromAll() {
        document.querySelectorAll('.pixiv-follow-gray-target').forEach((el) => {
            el.classList.remove('pixiv-follow-gray-target');
            el.style.filter = '';
        });
    }

    // --- hover 判定と自動保存機能 ---
    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    async function scanAndAutoSave() {
        if (!(/\/artworks\//.test(location.pathname) || /member_illust\.php/.test(location.pathname))) return;
        const relatedNodes = Array.from(document.querySelectorAll('a[href*="/users/"], a[href*="users/"], a[href*="member.php"], a[href*="/artworks/"], a[href*="member_illust.php"], [data-user-id]'));
        let added = 0;
        for (const node of relatedNodes) {
            const userId = getUserIdFromElement(node);
            if (!userId) continue;
            if (state.users.includes(userId)) continue;
            try {
                const followed = await checkFollowByHover(node);
                if (followed) {
                    state.users.push(userId);
                    saveState();
                    added += 1;
                }
            } catch (e) {
                // ignore per-node errors
            }
            // 少し待つ
            await sleep(250 + Math.random() * 200);
        }
        updateCountLabel();
        return added;
    }

    async function checkFollowByHover(node) {
        // トリガーとしてマウスイベントを発火させ、hoverカードの生成を待つ
        try {
            node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
            node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
            node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
        } catch (e) {
            // ignore
        }

        const card = await waitForHoverCard(node, 900);
        if (!card) return false;
        const text = (card.textContent || '').replace(/\s+/g, ' ');
        // 日本語/英語両対応で判定
        if (/フォロー中|フォロー解除|Following|Unfollow/.test(text)) return true;
        if (/フォローする|Follow/.test(text)) return false;
        // 明確な情報がなければ false
        return false;
    }

    function findHoverCandidatesByText(node) {
        const keywords = /フォロー中|フォロー解除|フォローする|Following|Unfollow|Follow/;
        const els = Array.from(document.querySelectorAll('div,span,button,section'));
        const rect = node.getBoundingClientRect();
        const near = els.filter(el => {
            if (!el.textContent) return false;
            if (!keywords.test(el.textContent)) return false;
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return false;
            // 近接している要素を探す
            const dx = Math.max(0, Math.max(r.left - rect.right, rect.left - r.right));
            const dy = Math.max(0, Math.max(r.top - rect.bottom, rect.top - r.bottom));
            const dist = Math.hypot(dx, dy);
            return dist < 400; // 近ければ候補
        });
        return near;
    }

    async function waitForHoverCard(node, timeout = 800) {
        const interval = 120;
        const max = Math.max(1, Math.floor(timeout / interval));
        for (let i = 0; i < max; i++) {
            const cand = findHoverCandidatesByText(node);
            if (cand.length) {
                // 可能性の高いものを返す
                return cand[0];
            }
            await sleep(interval);
        }
        return null;
    }

    // followingページに表示されているユーザー要素をグレー表示する
    function markFollowingPageUsersApplied() {
        try {
            const targets = new Set(state.users || []);
            const anchors = Array.from(document.querySelectorAll('a[href*="/users/"], a[href*="member.php"]'));
            anchors.forEach((a) => {
                const id = getUserIdFromElement(a);
                if (!id) return;
                // フォロー一覧ではカード全体ではなくアイコン画像のみを対象にする
                // まず a 要素内の img を探す。見つからなければ関連カード内を探す。
                let img = a.querySelector('img');
                if (!img) {
                    const card = findRelatedItemCard(a) || a;
                    img = card.querySelector('img');
                }
                if (!img) return;
                if (!state.enabled) {
                    // 機能が無効なら常に解除
                    img.classList.remove('pixiv-follow-gray-target');
                } else if (targets.has(id)) {
                    img.classList.add('pixiv-follow-gray-target');
                } else {
                    img.classList.remove('pixiv-follow-gray-target');
                }
            });
            // カウント更新: followingページでは適用されているアイコン数を数える
            if (state.enabled) {
                const applied = document.querySelectorAll('#content .pixiv-follow-gray-target, .pixiv-follow-gray-target').length;
                updateCountLabel(applied);
            } else {
                updateCountLabel(0);
            }
        } catch (e) {
            // ignore
        }
    }

    // フォロー一覧ページからユーザーIDを収集して保存する
    function importFromFollowingPage() {
        try {
            const anchors = Array.from(document.querySelectorAll('a[href*="/users/"], a[href*="member.php"]'));
            const ids = anchors.map(getUserIdFromElement).filter(Boolean);
            if (!ids.length) return 0;
            const set = new Set(state.users || []);
            let added = 0;
            ids.forEach(id => {
                if (!set.has(id)) {
                    set.add(id);
                    added += 1;
                }
            });
            state.users = Array.from(set);
            state.enabled = true;
            saveState();
            updateCountLabel();
            applyGrayStyle();
            return added;
        } catch (e) {
            return 0;
        }
    }

    // 初期化時、自動的にフォロー一覧ページなら取り込む
    if (IS_FOLLOWING_PAGE) {
        // give the page a moment to render
        setTimeout(() => {
            importFromFollowingPage();
        }, 600);
    }

    // エクスポート/インポート
    function exportStateToFile() {
        const data = JSON.stringify(state, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        const count = Array.isArray(state.users) ? state.users.length : 0;
        const now = new Date();
        const pad = (v) => String(v).padStart(2, '0');
        const filename = `${count}件_pixiv管理${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}.json`;

        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function importStateFromText(text) {
        try {
            const parsed = JSON.parse(text);
            if (parsed && Array.isArray(parsed.users)) {
                state.users = Array.from(new Set(parsed.users.map(String)));
                state.enabled = parsed.enabled !== false;
                saveState();
                return;
            }
        } catch (e) {
            // fall through to line-based import
        }

        const users = parseUserIds(text);
        if (users.length) {
            state.users = Array.from(new Set((state.users || []).concat(users)));
            saveState();
            return;
        }

        throw new Error('不明なインポート形式');
    }
})();

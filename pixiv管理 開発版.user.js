// ==UserScript==
// @name         Pixiv管理 開発版v2.9
// @namespace    https://example.com/userscripts
// @version      2.9
// @description  Pixiv の関連項目に表示される、設定したユーザーのサムネをグレー化します。右下に設定ボタンを追加します。
// @match        https://www.pixiv.net/*
// @match        https://pixiv.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'pixiv_follow_gray_users_v1';
    const DEFAULT_STATE = { enabled: true, users: [] };
    let state = loadState();
    const IS_FOLLOWING_PAGE = /^\/users\/\d+\/following\/?$/.test(location.pathname);
    let observer = null;
    let scheduled = false;

    injectStyles();
    createSettingsUI();
    bindEvents();
    applyGrayStyle();
    startObserver();

    window.addEventListener('load', () => applyGrayStyle());

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...DEFAULT_STATE };
            const parsed = JSON.parse(raw);
            return {
                enabled: parsed.enabled !== false,
                users: Array.isArray(parsed.users) ? parsed.users : []
            };
        } catch (e) {
            return { ...DEFAULT_STATE };
        }
    }

    function saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        updateCountLabel();
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.id = 'pixiv-follow-gray-style';
        style.textContent = `
            .pixiv-follow-gray-target {
                filter: grayscale(1) !important;
                opacity: 0.6 !important;
            }
            #pixiv-follow-gray-settings {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
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
            #pixiv-follow-gray-panel textarea {
                width: 100%;
                min-height: 110px;
                margin-top: 6px;
                resize: vertical;
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
            #pixiv-follow-gray-panel input[type="checkbox"] {
                accent-color: #2563eb;
                transform: translateY(1px);
            }
        `;
        document.head.appendChild(style);
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
            <div class="count-label" id="pixiv-follow-gray-count">適用中ユーザー数: 0人</div>
            <textarea id="pixiv-follow-gray-user-list" placeholder="ユーザーIDやURLを1行ごとに入力\n例: 12345\nhttps://www.pixiv.net/users/12345"></textarea>
            <div>
                <button id="pixiv-follow-gray-save-btn" type="button">保存</button>
                <button id="pixiv-follow-gray-load-btn" type="button">読み込み</button>
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

    function bindEvents() {
        const toggleBtn = document.getElementById('pixiv-follow-gray-toggle-btn');
        const panel = document.getElementById('pixiv-follow-gray-panel');
        const enabledInput = document.getElementById('pixiv-follow-gray-enabled');
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

        saveBtn.addEventListener('click', () => {
            state.users = parseUserIds(userList.value);
            state.enabled = enabledInput.checked;
            saveState();
            applyGrayStyle();
        });

        loadBtn.addEventListener('click', () => {
            loadUiFromState();
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
        const userList = document.getElementById('pixiv-follow-gray-user-list');
        enabledInput.checked = state.enabled;
        userList.value = state.users.join('\n');
        updateCountLabel();
    }

    function updateCountLabel(appliedCount) {
        const countEl = document.getElementById('pixiv-follow-gray-count');
        if (!countEl) return;
        const resolvedCount = typeof appliedCount === 'number' ? appliedCount : (state.enabled ? state.users.length : 0);
        countEl.textContent = `適用中ユーザー数: ${resolvedCount}人`;
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

        if (!/^\/artworks\//.test(location.pathname) || !state.enabled || !state.users.length) {
            updateCountLabel(0);
            return;
        }

        const targets = new Set(state.users);
        const relatedNodes = document.querySelectorAll('a[href*="/users/"], a[href*="users/"], [data-user-id]');
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

    function getUserIdFromElement(node) {
        const direct = node.getAttribute('data-user-id') || node.getAttribute('data-user') || node.getAttribute('data-id');
        if (direct) return String(direct).trim();
        const href = node.getAttribute('href') || '';
        const match = href.match(/\/users\/(\d+)/i);
        return match ? match[1] : '';
    }

    function findRelatedItemCard(node) {
        let closestCard = node;
        let current = node.parentElement;

        while (current && current !== document.body) {
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
        if (!/^\/artworks\//.test(location.pathname)) return;
        const relatedNodes = Array.from(document.querySelectorAll('a[href*="/users/"], a[href*="users/"], [data-user-id]'));
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
            const anchors = Array.from(document.querySelectorAll('a[href*="/users/"]'));
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
                if (targets.has(id)) {
                    img.classList.add('pixiv-follow-gray-target');
                } else {
                    img.classList.remove('pixiv-follow-gray-target');
                }
            });
        } catch (e) {
            // ignore
        }
    }

    // フォロー一覧ページからユーザーIDを収集して保存する
    function importFromFollowingPage() {
        try {
            const anchors = Array.from(document.querySelectorAll('a[href*="/users/"]'));
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
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pixiv_follow_gray_state.json';
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

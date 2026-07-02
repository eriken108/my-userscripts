// ==UserScript==
// @name         Pixiv管理 開発版v1.8
// @namespace    https://example.com/userscripts
// @version      1.8
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
            .pixiv-follow-gray-target img,
            .pixiv-follow-gray-target video,
            .pixiv-follow-gray-target picture,
            .pixiv-follow-gray-target canvas {
                filter: grayscale(1) !important;
            }
            .pixiv-follow-gray-target * {
                color: inherit !important;
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
        });
    }

    function applyGrayStyle() {
        removeGrayStyleFromAll();

        if (!state.enabled || !state.users.length) {
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
            node.classList.add('pixiv-follow-gray-target');

            const media = node.querySelectorAll('img, video, picture, canvas');
            media.forEach((el) => el.classList.add('pixiv-follow-gray-target'));

            if (node.tagName === 'IMG' || node.tagName === 'VIDEO' || node.tagName === 'PICTURE' || node.tagName === 'CANVAS') {
                node.classList.add('pixiv-follow-gray-target');
            }
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

    function removeGrayStyleFromAll() {
        document.querySelectorAll('.pixiv-follow-gray-target').forEach((el) => {
            el.classList.remove('pixiv-follow-gray-target');
            el.style.filter = '';
        });
    }
})();

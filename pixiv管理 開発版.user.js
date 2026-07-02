// ==UserScript==
// @name         Pixiv管理 開発版v1.5
// @namespace    https://example.com/userscripts
// @version      1.5
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
            .pixiv-follow-gray-target img {
                filter: grayscale(1) !important;
            }
            #pixiv-follow-gray-settings {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 2147483647;
                font-family: Arial, sans-serif;
                font-size: 12px;
                color: #222;
            }
            #pixiv-follow-gray-toggle-btn {
                width: 42px;
                height: 42px;
                border: none;
                border-radius: 50%;
                background: #fff;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                cursor: pointer;
                font-size: 20px;
            }
            #pixiv-follow-gray-panel {
                display: none;
                width: 300px;
                margin-top: 8px;
                padding: 12px;
                border-radius: 10px;
                background: rgba(255,255,255,0.96);
                box-shadow: 0 4px 16px rgba(0,0,0,0.25);
            }
            #pixiv-follow-gray-panel.open {
                display: block;
            }
            #pixiv-follow-gray-panel textarea {
                width: 100%;
                min-height: 100px;
                margin-top: 6px;
                resize: vertical;
                box-sizing: border-box;
                padding: 6px;
            }
            #pixiv-follow-gray-panel button {
                margin-top: 8px;
                margin-right: 8px;
                padding: 6px 10px;
                border: 1px solid #ccc;
                border-radius: 6px;
                background: #f5f5f5;
                cursor: pointer;
            }
            #pixiv-follow-gray-panel label,
            #pixiv-follow-gray-panel .count-label {
                display: block;
                margin-top: 6px;
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
            <div><strong>Pixiv 管理</strong></div>
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
            const images = node.querySelectorAll('img');
            images.forEach((img) => img.classList.add('pixiv-follow-gray-target'));
            if (node.tagName === 'IMG') {
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

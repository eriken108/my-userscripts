// ==UserScript==
// @name         Pixiv管理 開発版v1.4
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Pixivでフォロー済みの作者のサムネイルをCSSフィルターでグレー表示する
// @author       あなたの名前
// @match        https://www.pixiv.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEYS = {
        enabled: 'pixivGrayEnabled',
        refreshInterval: 'pixivRefreshInterval',
        showBadge: 'pixivShowBadge',
        followedList: 'pixivFollowedList'
    };

    const DEFAULT_SETTINGS = {
        enabled: true,
        refreshInterval: 5,
        showBadge: true
    };

    let settings = {
        enabled: getStoredBoolean(STORAGE_KEYS.enabled, DEFAULT_SETTINGS.enabled),
        refreshInterval: getStoredNumber(STORAGE_KEYS.refreshInterval, DEFAULT_SETTINGS.refreshInterval),
        showBadge: getStoredBoolean(STORAGE_KEYS.showBadge, DEFAULT_SETTINGS.showBadge)
    };

    let followedSet = new Set();
    let refreshTimer = null;
    let ui = null;

    GM_addStyle(`
        .pixiv-followed-gray {
            filter: grayscale(100%) !important;
        }
        #pixiv-admin-floating {
            position: fixed;
            right: 18px;
            bottom: 18px;
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #pixiv-admin-toggle {
            width: 46px;
            height: 46px;
            border: none;
            border-radius: 50%;
            background: #ffffff;
            color: #222;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
        }
        #pixiv-admin-badge {
            position: absolute;
            top: -6px;
            right: -4px;
            min-width: 20px;
            height: 20px;
            border-radius: 999px;
            background: #ff5a5f;
            color: white;
            font-size: 12px;
            font-weight: 700;
            padding: 0 6px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        #pixiv-admin-panel {
            position: absolute;
            right: 0;
            bottom: 58px;
            width: 250px;
            padding: 12px;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.97);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
            display: none;
            color: #222;
        }
        #pixiv-admin-panel.open {
            display: block;
        }
        #pixiv-admin-panel h4 {
            margin: 0 0 8px;
            font-size: 14px;
        }
        .pixiv-admin-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            font-size: 13px;
            gap: 8px;
        }
        .pixiv-admin-row label {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
        }
        .pixiv-admin-row select {
            border: 1px solid #d0d0d0;
            border-radius: 6px;
            padding: 4px 6px;
            font-size: 12px;
        }
        .pixiv-admin-hint {
            margin-top: 8px;
            font-size: 11px;
            opacity: 0.75;
        }
    `);

    function getStoredBoolean(key, fallback) {
        const value = GM_getValue(key, fallback);
        return value === true || value === 'true';
    }

    function getStoredNumber(key, fallback) {
        const value = Number(GM_getValue(key, fallback));
        return Number.isFinite(value) ? value : fallback;
    }

    function saveSettings() {
        GM_setValue(STORAGE_KEYS.enabled, settings.enabled);
        GM_setValue(STORAGE_KEYS.refreshInterval, settings.refreshInterval);
        GM_setValue(STORAGE_KEYS.showBadge, settings.showBadge);
    }

    function getMyUserId() {
        return fetch('https://www.pixiv.net/bookmark.php?type=user', { credentials: 'include' })
            .then(res => res.text())
            .then(text => {
                const m = text.match(/member\.php\?id=(\d+)/);
                return m ? m[1] : null;
            })
            .catch(() => null);
    }

    async function updateFollowedList() {
        const userId = await getMyUserId();
        if (!userId) {
            console.warn('Pixiv: ユーザーIDが取得できませんでした。ログイン状態を確認してください。');
            return;
        }

        let offset = 0;
        const limit = 48;
        let hasMore = true;
        const newSet = new Set();

        while (hasMore) {
            const url = `https://www.pixiv.net/ajax/user/${userId}/following?offset=${offset}&limit=${limit}&rest=show`;
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) {
                console.warn('Pixiv: フォローリスト取得に失敗', res.status);
                break;
            }

            const data = await res.json();
            const users = Array.isArray(data.body?.users) ? data.body.users : [];
            for (const u of users) {
                newSet.add(String(u.userId));
            }
            hasMore = users.length === limit;
            offset += limit;
        }

        followedSet = newSet;
        GM_setValue(STORAGE_KEYS.followedList, JSON.stringify([...followedSet]));
        updateBadge();
        scanPage();
    }

    function loadFollowedListCache() {
        const saved = GM_getValue(STORAGE_KEYS.followedList, null);
        if (!saved) {
            return;
        }
        try {
            followedSet = new Set(JSON.parse(saved));
        } catch (e) {
            followedSet = new Set();
        }
    }

    function createUi() {
        if (ui) {
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.id = 'pixiv-admin-floating';

        const button = document.createElement('button');
        button.id = 'pixiv-admin-toggle';
        button.type = 'button';
        button.setAttribute('aria-label', 'Pixiv管理設定');
        button.textContent = '⚙️';

        const badge = document.createElement('div');
        badge.id = 'pixiv-admin-badge';
        badge.textContent = '0';

        const panel = document.createElement('div');
        panel.id = 'pixiv-admin-panel';
        panel.innerHTML = `
            <h4>Pixiv管理設定</h4>
            <div class="pixiv-admin-row">
                <label><input type="checkbox" id="pixiv-admin-enable" /> グレー表示</label>
            </div>
            <div class="pixiv-admin-row">
                <label><input type="checkbox" id="pixiv-admin-show-badge" /> カウント表示</label>
            </div>
            <div class="pixiv-admin-row">
                <span>更新間隔</span>
                <select id="pixiv-admin-interval">
                    <option value="5">5分</option>
                    <option value="10">10分</option>
                    <option value="30">30分</option>
                </select>
            </div>
            <div class="pixiv-admin-hint">現在適用中のフォローユーザー数を右下のアイコンに表示します。</div>
        `;

        wrapper.appendChild(button);
        wrapper.appendChild(badge);
        wrapper.appendChild(panel);
        document.body.appendChild(wrapper);

        const enableInput = panel.querySelector('#pixiv-admin-enable');
        const showBadgeInput = panel.querySelector('#pixiv-admin-show-badge');
        const intervalSelect = panel.querySelector('#pixiv-admin-interval');

        button.addEventListener('click', () => {
            panel.classList.toggle('open');
        });

        enableInput.addEventListener('change', () => {
            settings.enabled = enableInput.checked;
            saveSettings();
            applySettings();
        });

        showBadgeInput.addEventListener('change', () => {
            settings.showBadge = showBadgeInput.checked;
            saveSettings();
            updateBadge();
        });

        intervalSelect.addEventListener('change', () => {
            settings.refreshInterval = Number(intervalSelect.value);
            saveSettings();
            restartAutoRefresh();
        });

        document.addEventListener('click', (event) => {
            if (!wrapper.contains(event.target)) {
                panel.classList.remove('open');
            }
        });

        ui = { wrapper, button, badge, panel, enableInput, showBadgeInput, intervalSelect };
        syncUiFromSettings();
    }

    function syncUiFromSettings() {
        if (!ui) {
            return;
        }
        ui.enableInput.checked = settings.enabled;
        ui.showBadgeInput.checked = settings.showBadge;
        ui.intervalSelect.value = String(settings.refreshInterval);
        updateBadge();
    }

    function updateBadge() {
        if (!ui) {
            return;
        }
        const count = followedSet.size;
        if (settings.showBadge) {
            ui.badge.textContent = count.toString();
            ui.badge.style.display = 'inline-flex';
        } else {
            ui.badge.style.display = 'none';
        }
    }

    function removeGrayEffects() {
        document.querySelectorAll('.pixiv-followed-gray').forEach(el => el.classList.remove('pixiv-followed-gray'));
    }

    function grayOutIfFollowed(element) {
        if (!settings.enabled) {
            return;
        }

        const a = element.querySelector("a[href*='/users/']");
        if (!a) {
            return;
        }

        const m = a.href.match(/\/users\/(\d+)/);
        if (!m || !followedSet.has(m[1])) {
            return;
        }

        const img = element.querySelector('img');
        if (img) {
            img.classList.add('pixiv-followed-gray');
        } else {
            element.classList.add('pixiv-followed-gray');
        }
    }

    function scanPage() {
        if (!settings.enabled) {
            removeGrayEffects();
            return;
        }

        removeGrayEffects();
        document.querySelectorAll('a[href*="/users/"]').forEach(a => {
            const block = a.closest('article, li, figure, section, div');
            if (block) {
                grayOutIfFollowed(block);
            }
        });
    }

    function restartAutoRefresh() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
        }
        if (settings.refreshInterval > 0) {
            refreshTimer = setInterval(() => {
                updateFollowedList();
            }, settings.refreshInterval * 60 * 1000);
        }
    }

    function applySettings() {
        syncUiFromSettings();
        scanPage();
    }

    const observer = new MutationObserver(() => {
        scanPage();
    });

    function init() {
        loadFollowedListCache();
        createUi();
        applySettings();
        updateFollowedList();
        restartAutoRefresh();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();

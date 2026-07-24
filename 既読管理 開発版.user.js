// ==UserScript==
// @name         既読管理 開発版v5.3
// @namespace    http://tampermonkey.net/
// @version      5.3
// @description  既読 / 巡回中 / 未読 管理
// @author       gpt5
// @match        http://*/*
// @match        https://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    const DEFAULTS = {
        THEME_COLOR: '#9c60de',
        UNREAD_COLOR: '#777',
        INPROGRESS_COLOR: '#ffb74d',
        PANEL_HEIGHT: 380,
        SETTINGS: {
            allowedPatterns: [],
            displayEnabled: true,
            displayMode: 'gray', // 'gray' | 'strike' | 'both' | 'none'
            badgeEnabled: true,
            badgeSize: 48
        }
    };

    const STORAGE_KEY_PAGES = 'advancedReadPagesData_v4';
    const STORAGE_KEY_PANEL_HEIGHT = 'panelHeight_v4';
    const STORAGE_KEY_SETTINGS = 'readMarkerSettings_v4';
    const MAX_PAGES = 5000; // 保存上限。必要なら調整。

    let readPagesCache = {};
    let currentPanelHeight = DEFAULTS.PANEL_HEIGHT;
    let settings = JSON.parse(JSON.stringify(DEFAULTS.SETTINGS));
    // フィルター状態: 'all' | 'read' | 'in_progress'
    let listFilterMode = 'all';

    // helpers
    const statusLabel = (s) => {
        if (!s) return '既読';
        if (s === 'in_progress') return '巡回中';
        if (s === 'read') return '既読';
        return String(s);
    };

    const escapeHtml = (str) => {
        return str ? String(str).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]) : '';
    };

    const getCanonicalUrl = (u) => {
        try {
            return new URL(u, location.href).href.split('#')[0];
        } catch (e) {
            return (u || '').split('#')[0];
        }
    };

    // normalized current page url (use canonical everywhere)
    let currentPageUrl = location.href.split('#')[0];
    currentPageUrl = getCanonicalUrl(currentPageUrl);

    const normalizeKey = (u) => getCanonicalUrl(u || '');

    // debounce for link highlighting (MutationObserver)
    let _highlightTimer = null;
    const scheduleHighlight = (delay = 120) => {
        if (_highlightTimer) clearTimeout(_highlightTimer);
        _highlightTimer = setTimeout(() => { highlightReadLinks(); _highlightTimer = null; }, delay);
    };

    /**
     * [新規追加] 外部URLからページのタイトルを取得する
     * @param {string} url - タイトルを取得したいページのURL
     * @returns {Promise<string|null>} ページのタイトル、または取得失敗時にnull
     */
    const fetchPageTitle = (url) => {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 400) {
                        const text = response.responseText;
                        // 正規表現で<title>タグの内容を抽出
                        const match = text.match(/<title[^>]*>([^<]+)<\/title>/i);
                        if (match && match[1]) {
                            // HTMLエンティティをデコードするための簡易的な処理
                            const tempEl = document.createElement('textarea');
                            tempEl.innerHTML = match[1].trim();
                            resolve(tempEl.value);
                        } else {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                },
                onerror: function() {
                    resolve(null);
                },
                ontimeout: function() {
                    resolve(null);
                }
            });
        });
    };


    // apply styles
    const applyGlobalStyles = () => {
        const existing = document.getElementById('read-marker-dynamic-styles');
        if (existing) existing.remove();
        const style = document.createElement('style');
        style.id = 'read-marker-dynamic-styles';

        const badgeSize = parseInt(settings.badgeSize || DEFAULTS.SETTINGS.badgeSize, 10) || DEFAULTS.SETTINGS.badgeSize;
        const badgeFontSize = Math.max(12, Math.round(badgeSize * 0.5));
        const badgePadding = Math.max(6, Math.round(badgeSize * 0.2));

        let readLinkCss = '';
        if (settings.displayEnabled && settings.displayMode !== 'none') {
            const rules = [];
            if (settings.displayMode === 'gray' || settings.displayMode === 'both') {
                rules.push('color: #999 !important; opacity: 0.8 !important;');
            }
            if (settings.displayMode === 'strike' || settings.displayMode === 'both') {
                rules.push('text-decoration: line-through !important;');
            }
            readLinkCss = `.tampermonkey-read-link { ${rules.join(' ')} }`;
        } else {
            readLinkCss = `.tampermonkey-read-link { text-decoration: none; color: inherit; opacity: 1; }`;
        }

        style.textContent = `
            /* basic */
            #read-marker-panel { color: #222; background-color: #fdfdfd; font-family: sans-serif; }
            #read-marker-toggle-button {
                position: fixed; bottom: 15px; right: 15px; z-index: 99998;
                width: 50px; height: 50px; color: white; border: none;
                border-radius: 50%; font-size: 22px; line-height: 50px;
                text-align: center; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                transition: transform 0.2s, background-color 0.2s;
                background-color: ${DEFAULTS.UNREAD_COLOR};
            }
            #read-marker-toggle-button.read { background-color: ${DEFAULTS.THEME_COLOR}; }
            #read-marker-toggle-button.unread { background-color: ${DEFAULTS.UNREAD_COLOR}; }
            #read-marker-toggle-button.inprogress { background-color: ${DEFAULTS.INPROGRESS_COLOR}; color:#222; }
            #read-marker-toggle-button:hover { transform: scale(1.05); }

            #read-marker-panel {
                position: fixed; bottom: 80px; right: 15px; z-index: 99999;
                width: 800px; height: ${currentPanelHeight}px;
                background-color: #fff; border: 1px solid #e0e0e0; border-radius: 8px;
                box-shadow: 0 6px 20px rgba(0,0,0,0.18); display:flex; flex-direction:column;
                transform: translateY(20px); opacity: 0; pointer-events: none;
                transition: opacity 0.25s, transform 0.25s, height 0.2s;
            }
            #read-marker-panel.show { transform: translateY(0); opacity: 1; pointer-events: auto; }

            .rm-tabs { display:flex; border-bottom:1px solid #eee; }
            .rm-tab-button { flex:1; padding:10px; background:#f7f7f7; border:none; cursor:pointer; font-size:13px; }
            .rm-tab-button.active { background:#fff; font-weight:600; border-bottom:3px solid ${DEFAULTS.THEME_COLOR}; }
            #list-count-display { font-size: 12px; color: #555; font-weight: normal; margin-left: 4px; }

            .rm-tab-content-wrapper { flex:1; overflow:auto; }
            .rm-tab-content { display:none; padding:12px; }
            .rm-tab-content.active { display:block; }

            .rm-panel-footer { padding:10px; border-top:1px solid #eee; background:#fafafa; }
            #current-page-status-button { width:100%; padding:8px; cursor:pointer; border:1px solid #ccc; border-radius:4px; background:#fff; }
            #current-page-status-button.read { background:${DEFAULTS.THEME_COLOR}; color:#fff; border-color:${DEFAULTS.THEME_COLOR}; }
            #current-page-status-button.inprogress { background:${DEFAULTS.INPROGRESS_COLOR}; color:#222; border-color:${DEFAULTS.INPROGRESS_COLOR}; }

            #read-marker-panel textarea, #read-marker-panel input[type="text"], #read-marker-panel input[type="file"] { color:#222; background:#fff; border:1px solid #ccc; }
            #search-input { width:100%; padding:8px; margin-bottom:10px; border-radius:4px; box-sizing:border-box; }
            #read-list-container { max-height: calc(${currentPanelHeight}px - 200px); overflow:auto; }
            .list-item { padding:8px; border-bottom:1px solid #f0f0f0; display:block; position:relative; }
            .list-item.current-page-highlight {
                background-color: #f5eefc;
                border-left: 4px solid ${DEFAULTS.THEME_COLOR};
                padding-left: 4px;
            }
            .list-item .title { font-weight:700; margin-bottom:4px; word-break:break-all; cursor:pointer; }
            .list-item .url { font-size:12px; color:#666; margin-bottom:4px; word-break:break-all; }
            .list-item .date { font-size:11px; color:#999; margin-bottom:4px; }
            .list-item .status-text { font-size:12px; color:#333; margin-bottom:6px; }
            .list-item .comment-section { background:#f7f7f7; padding:6px 8px; border-left:3px solid #ddd; font-size:12px; white-space:pre-wrap; cursor:pointer; }
            .list-item .actions { position:absolute; right:8px; top:8px; }
            .action-button { border:none; background:none; cursor:pointer; padding:4px 6px; font-size:14px; color:#666; }
            .action-button:hover { color:#222; }

            .setting-section { margin-bottom:14px; }
            .setting-button { padding:6px 10px; border:1px solid #ccc; border-radius:4px; background:#f0f0f0; cursor:pointer; margin-right:6px; }

            ${readLinkCss}
            .tampermonkey-inprogress-link { color: ${DEFAULTS.INPROGRESS_COLOR} !important; font-weight:700 !important; text-decoration: underline dotted !important; }

            #read-marker-badge {
                position: fixed; left:50%; transform:translateX(-50%); bottom:18px; z-index:100000;
                display:none; align-items:center; justify-content:center; min-height:${badgeSize}px;
                padding:${badgePadding}px ${Math.round(badgePadding*1.6)}px; border-radius:${Math.round(badgeSize*0.18)}px;
                background:${DEFAULTS.THEME_COLOR}; color:#fff; font-weight:700; font-size:${badgeFontSize}px;
                box-shadow: 0 6px 18px rgba(0,0,0,0.25); pointer-events:none; white-space:nowrap;
            }
            #read-marker-badge.show { display:flex; }

            /* list filter buttons (一覧タブ右) */
            #list-filter-buttons { display:flex; gap:6px; align-items:center; margin-left:8px; }
            .filter-button {
                padding:6px 10px; border-radius:6px; border:1px solid #ddd; background:#fafafa;
                cursor:pointer; font-size:13px;
            }
            .filter-button.active { background:${DEFAULTS.THEME_COLOR}; color:#fff; border-color:${DEFAULTS.THEME_COLOR}; font-weight:600; }
        `;
        document.head.appendChild(style);
    };

    // STORAGE: 読み込み（正規化）
    const getReadPages = async () => {
        const raw = await GM_getValue(STORAGE_KEY_PAGES, '{}');
        try {
            const parsed = JSON.parse(raw) || {};
            let norm = {};
            for (const k of Object.keys(parsed)) {
                const p = parsed[k] || {};
                const ck = normalizeKey(k);
                if (!norm[ck]) norm[ck] = p;
                else {
                    // 同一 canonical の場合は新しい方を採用
                    const old = norm[ck];
                    const od = new Date(old.date || 0).getTime();
                    const nd = new Date(p.date || 0).getTime();
                    norm[ck] = nd > od ? p : old;
                }
            }
            for (const k of Object.keys(norm)) {
                const e = norm[k] || {};
                if (!e.status) e.status = 'read';
                if (!e.date) e.date = new Date().toISOString();
                if (!e.title) e.title = (k === currentPageUrl) ? (document.title || k) : k;
                norm[k] = e;
            }
            readPagesCache = norm;
        } catch (e) {
            readPagesCache = {};
        }
    };

    // STORAGE: 保存（正規化・トリム）
    const saveReadPages = async (pages) => {
        // normalize keys
        let norm = {};
        for (const rawKey of Object.keys(pages || {})) {
            const p = pages[rawKey] || {};
            const ck = normalizeKey(rawKey);
            norm[ck] = p;
        }
        // trim oldest if exceed MAX_PAGES
        const keys = Object.keys(norm || {});
        if (keys.length > MAX_PAGES) {
            keys.sort((a,b) => new Date(norm[a].date) - new Date(norm[b].date));
            const keep = keys.slice(keys.length - MAX_PAGES);
            const newNorm = {};
            for (const k of keep) newNorm[k] = norm[k];
            norm = newNorm;
        }
        readPagesCache = norm || {};
        await GM_setValue(STORAGE_KEY_PAGES, JSON.stringify(readPagesCache));
    };

    const getSettings = async () => {
        const raw = await GM_getValue(STORAGE_KEY_SETTINGS, null);
        if (!raw) {
            settings = JSON.parse(JSON.stringify(DEFAULTS.SETTINGS));
            await GM_setValue(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
            return;
        }
        try {
            const parsed = JSON.parse(raw);
            settings = Object.assign(JSON.parse(JSON.stringify(DEFAULTS.SETTINGS)), parsed || {});
            // [移行処理] 古い設定形式（文字列の配列）から新しい形式（オブジェクトの配列）へ変換します。
            // これにより、過去のバージョンからアップデートした際に動作許可アドレスが正しく認識されるようになります。
            if (Array.isArray(settings.allowedPatterns) && settings.allowedPatterns.length > 0 && typeof settings.allowedPatterns[0] === 'string') {
                settings.allowedPatterns = settings.allowedPatterns.map(p => ({ pattern: p, comment: '' }));
            } else if (!Array.isArray(settings.allowedPatterns)) {
                settings.allowedPatterns = [];
            }
            settings.badgeSize = parseInt(settings.badgeSize || DEFAULTS.SETTINGS.badgeSize, 10) || DEFAULTS.SETTINGS.badgeSize;
        } catch (e) {
            settings = JSON.parse(JSON.stringify(DEFAULTS.SETTINGS));
        }
    };
    const saveSettings = async (newSettings) => {
        settings = Object.assign(settings, newSettings || {});
        if (!Array.isArray(settings.allowedPatterns)) settings.allowedPatterns = [];
        settings.badgeSize = parseInt(settings.badgeSize || DEFAULTS.SETTINGS.badgeSize, 10) || DEFAULTS.SETTINGS.badgeSize;
        await GM_setValue(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
        applyGlobalStyles();
        highlightReadLinks();
        updatePanelFooter();
        createOrUpdateBadge();
        createOrUpdateToggleButton();
    };

    const getPanelHeight = async () => {
        const h = await GM_getValue(STORAGE_KEY_PANEL_HEIGHT, DEFAULTS.PANEL_HEIGHT);
        currentPanelHeight = parseInt(h || DEFAULTS.PANEL_HEIGHT, 10);
    };
    const savePanelHeight = async (h) => {
        currentPanelHeight = parseInt(h || DEFAULTS.PANEL_HEIGHT, 10);
        await GM_setValue(STORAGE_KEY_PANEL_HEIGHT, currentPanelHeight);
        applyGlobalStyles();
    };

    // allowed check
    const isAllowedPage = (url = currentPageUrl) => {
        // 動作許可アドレスが一件も設定されていない場合は、全てのページで動作を許可します。
        // これにより、アイコンが不必要に非表示になることを防ぎます。
        if (!settings.allowedPatterns || settings.allowedPatterns.length === 0) {
            return true;
        }
        // 許可アドレスが設定されている場合は、現在のURLがパターンに一致するかどうかを返します。
        return !!findMatchingPattern(url);
    };

    /**
     * URLに一致する最初の許可パターンオブジェクトを返す
     * @param {string} url - チェックするURL
     * @returns {{pattern: string, comment: string} | null} - 一致したパターンオブジェクト、またはnull
     */
    const findMatchingPattern = (url = currentPageUrl) => {
        let u = url || '';
        let host = '';
        let path = '';
        try {
            const parsed = new URL(url);
            u = parsed.href;
            host = parsed.hostname;
            path = parsed.pathname + (parsed.search || '');
        } catch (e) {
            // location.href を基準にフォールバック
            try {
                const parsed = new URL(url, location.href);
                u = parsed.href;
                host = parsed.hostname;
                path = parsed.pathname + (parsed.search || '');
            } catch (e2) {
                u = url;
            }
        }

        for (const item of settings.allowedPatterns) {
            const pattern = (item.pattern || '').trim();
            if (!pattern) continue;
            let isMatch = false;
            if (pattern.startsWith('regex:')) {
                try {
                    const re = new RegExp(pattern.slice(6));
                    if (re.test(u) || re.test(host) || re.test(path)) isMatch = true;
                } catch (ex) { continue; }
            } else {
                const esc = pattern.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*');
                try {
                    const re = new RegExp(esc, 'i');
                    if (re.test(u) || re.test(host) || re.test(path)) isMatch = true;
                } catch (ex) {
                    if ((u && u.includes(pattern)) || (host && host.includes(pattern))) isMatch = true;
                }
            }
            if (isMatch) return item;
        }
        return null;
    };

    // set page status (canonical keys)
    const setPageStatus = async (url, status) => {
        const canonical = normalizeKey(url);
        const operatingOnCurrent = (canonical === currentPageUrl);
        if (operatingOnCurrent && !isAllowedPage(canonical)) {
            alert('このページは設定された許可パターンに含まれていないため、操作できません。');
            return;
        }

        const existing = readPagesCache[canonical];
        if (!status || status === 'unread') {
            delete readPagesCache[canonical];
        } else {
            readPagesCache[canonical] = {
                title: (existing && existing.title) || (operatingOnCurrent ? (document.title || canonical) : canonical),
                date: new Date().toISOString(),
                comment: (existing && existing.comment) || '',
                status: status
            };
        }
        await saveReadPages(readPagesCache);
        updatePanelFooter();
        updateToggleButtonStatus();
        renderList();
        highlightReadLinks();
        createOrUpdateBadge();
    };

    // badge
    const createOrUpdateBadge = () => {
        let badge = document.getElementById('read-marker-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'read-marker-badge';
            document.body.appendChild(badge);
        }
        const ent = readPagesCache[currentPageUrl];
        if (!isAllowedPage(currentPageUrl) || !settings.badgeEnabled) {
            badge.classList.remove('show');
            return;
        }
        if (ent && ent.status) {
            badge.classList.add('show');
            if (ent.status === 'read') {
                badge.textContent = '既読済み';
                badge.style.backgroundColor = DEFAULTS.THEME_COLOR;
                badge.style.color = '#fff';
            } else if (ent.status === 'in_progress') {
                badge.textContent = '巡回中';
                badge.style.backgroundColor = DEFAULTS.INPROGRESS_COLOR;
                badge.style.color = '#222';
            } else {
                badge.classList.remove('show');
            }
        } else {
            badge.classList.remove('show');
        }
        const size = parseInt(settings.badgeSize || DEFAULTS.SETTINGS.badgeSize, 10);
        const fontSize = Math.max(12, Math.round(size * 0.5));
        const padding = Math.max(6, Math.round(size * 0.2));
        badge.style.minHeight = `${size}px`;
        badge.style.padding = `${padding}px ${Math.round(padding * 1.6)}px`;
        badge.style.borderRadius = `${Math.round(size * 0.18)}px`;
        badge.style.fontSize = `${fontSize}px`;
    };

    // toggle icon management
    const createOrUpdateToggleButton = () => {
        const existing = document.getElementById('read-marker-toggle-button');
        if (!isAllowedPage(currentPageUrl)) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;
        const btn = document.createElement('button');
        btn.id = 'read-marker-toggle-button';
        btn.textContent = '📖';
        document.body.appendChild(btn);
        btn.addEventListener('click', () => {
            const panel = document.getElementById('read-marker-panel');
            if (!panel) return;

            const isOpening = !panel.classList.contains('show');
            panel.classList.toggle('show');

            if (isOpening) {
                const listTabButton = panel.querySelector('.rm-tab-button[data-tab="list"]');
                if (listTabButton && listTabButton.classList.contains('active')) {
                    scrollToAndHighlightCurrentPage();
                }
            }
        });
        updateToggleButtonStatus();
    };

    // create panel (avoid direct injection of unescaped URL into innerHTML attributes)
    const createPanel = () => {
        const existing = document.getElementById('read-marker-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'read-marker-panel';
        panel.innerHTML = `
            <div class="rm-tabs">
                <button class="rm-tab-button active" data-tab="list">一覧 <span id="list-count-display"></span></button>
                <button class="rm-tab-button" data-tab="add">追加</button>
                <button class="rm-tab-button" data-tab="settings">設定</button>
            </div>
            <div class="rm-tab-content-wrapper">
                <div id="tab-content-list" class="rm-tab-content active">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                        <input type="text" id="search-input" placeholder="タイトル, URL, コメントで検索..." style="flex:1;">
                        <div id="list-filter-buttons">
                            <button class="filter-button active" data-filter="all" title="全て表示">全て</button>
                            <button class="filter-button" data-filter="read" title="既読のみ表示">既読のみ</button>
                            <button class="filter-button" data-filter="in_progress" title="巡回のみ表示">巡回のみ</button>
                        </div>
                    </div>
                    <div id="read-list-container"></div>
                </div>
                <div id="tab-content-add" class="rm-tab-content">
                    <p>追加したいURLを貼り付けてください。</p>
                    <textarea id="add-url-input" rows="3" style="width:100%; box-sizing:border-box;"></textarea>
                    <div style="margin-top:8px;">
                        <button id="add-as-read-button" class="setting-button">既読として追加</button>
                        <button id="add-as-inprogress-button" class="setting-button">巡回中として追加</button>
                    </div>
                    <p id="add-status-message"></p>
                </div>
                <div id="tab-content-settings" class="rm-tab-content">
                    <div class="setting-section">
                        <h4>表示設定</h4>
                        <label for="panel-height-slider">パネルの高さ: <span id="panel-height-value">${currentPanelHeight}</span>px</label>
                        <input type="range" id="panel-height-slider" min="250" max="800" step="10" value="${currentPanelHeight}">
                        <div style="margin-top:10px;">
                            <label><input type="checkbox" id="display-enabled-checkbox"> 既読リンクの表示を有効にする</label>
                        </div>
                        <div style="margin-top:8px;">
                            表示方法:
                            <label><input type="radio" name="display-mode" value="gray"> グレーのみ</label>
                            <label><input type="radio" name="display-mode" value="strike"> 横線のみ</label>
                            <label><input type="radio" name="display-mode" value="both"> 両方</label>
                            <label><input type="radio" name="display-mode" value="none"> 無効</label>
                        </div>
                        <div style="margin-top:10px;">
                            <label><input type="checkbox" id="badge-enabled-checkbox"> ページ下に「既読/巡回中」バッジを表示</label>
                        </div>
                        <div style="margin-top:8px;">
                            バッジ大きさ: <span id="badge-size-value">${settings.badgeSize}</span>px
                            <input type="range" id="badge-size-slider" min="24" max="120" step="2" value="${settings.badgeSize}">
                        </div>
                    </div>
                    <div class="setting-section">
                        <h4>動作許可アドレスとコメント</h4>
                        <p style="margin:6px 0 4px; font-size:12px; color:#666;">動作を許可するURLパターンと、それに対応するコメントを管理します。<br>ワイルドカード(*)や正規表現(<code>regex:</code>)が使用できます。</p>
                        <div id="allowed-patterns-list-container" style="max-height: 120px; overflow-y: auto; border: 1px solid #eee; padding: 5px; margin-bottom: 10px; background: #fdfdfd;"></div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="text" id="new-pattern-input" placeholder="パターン (例: example.com/*)" style="flex: 1;">
                            <input type="text" id="new-comment-input" placeholder="コメント (例: 毎日チェック)" style="flex: 1;">
                            <button id="add-new-pattern-button" class="setting-button" style="padding: 6px 8px;">追加</button>
                        </div>

                        <div style="margin-top:12px;">
                            <button id="save-settings-button" class="setting-button">設定を保存</button>
                            <button id="reset-settings-button" class="setting-button">初期化</button>
                        </div>
                        <p id="setting-status-message"></p>
                    </div>
                    <div class="setting-section">
                        <h4>データ管理</h4>
                        <button id="export-button" class="setting-button">エクスポート</button>
                        <button id="import-button" class="setting-button">インポート</button>
                        <input type="file" id="import-file-input" accept=".json" style="display:none;">
                        <button id="delete-all-button" class="setting-button" style="background:#fff;border-color:#d9534f;color:#d9534f;">全データ削除</button>
                    </div>
                </div>
            </div>
            <div class="rm-panel-footer">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <p style="margin:0; font-size:12px; color:#333;"></p>
                    <p id="current-page-pattern-comment" style="margin:0; font-size:11px; color:#666; font-style:italic; max-width: 60%; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></p>
                </div>
                <button id="current-page-status-button"></button>
            </div>
        `;
        document.body.appendChild(panel);

        // set title attribute safely (avoid injecting via innerHTML)
        try {
            const footerP = panel.querySelector('.rm-panel-footer p');
            if (footerP) {
                footerP.textContent = '現在のページ';
                footerP.setAttribute('title', currentPageUrl);
            }
        } catch (e) { /* ignore */ }

        // toggle button created/removed by createOrUpdateToggleButton
        createOrUpdateToggleButton();

        // tabs
        panel.querySelectorAll('.rm-tab-button').forEach(b => b.addEventListener('click', (e) => {
            const t = e.target.closest('.rm-tab-button').dataset.tab;
            panel.querySelectorAll('.rm-tab-button, .rm-tab-content').forEach(x => x.classList.remove('active'));
            e.target.closest('.rm-tab-button').classList.add('active');
            const cont = panel.querySelector(`#tab-content-${t}`);
            if (cont) cont.classList.add('active');
            if (t === 'list') {
                scrollToAndHighlightCurrentPage();
            }
        }));

        // フィルタボタン動作
        const filterBtnWrap = panel.querySelector('#list-filter-buttons');
        if (filterBtnWrap) {
            const filterButtons = filterBtnWrap.querySelectorAll('.filter-button');
            filterButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    filterButtons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    listFilterMode = btn.dataset.filter || 'all';
                    renderList();
                });
            });
        }

        // actions
        const currentBtn = panel.querySelector('#current-page-status-button');
        if (currentBtn) currentBtn.addEventListener('click', () => toggleCurrentPageStatus());
        const searchInput = panel.querySelector('#search-input');
        if (searchInput) searchInput.addEventListener('input', () => renderList());
        const addReadBtn = panel.querySelector('#add-as-read-button');
        const addInBtn = panel.querySelector('#add-as-inprogress-button');
        if (addReadBtn) addReadBtn.addEventListener('click', () => addUrlManually('read'));
        if (addInBtn) addInBtn.addEventListener('click', () => addUrlManually('in_progress'));
        const exportBtn = panel.querySelector('#export-button');
        if (exportBtn) exportBtn.addEventListener('click', exportData);
        const importBtn = panel.querySelector('#import-button');
        if (importBtn) importBtn.addEventListener('click', () => panel.querySelector('#import-file-input').click());
        const importInput = panel.querySelector('#import-file-input');
        if (importInput) importInput.addEventListener('change', importData);
        const deleteAllBtn = panel.querySelector('#delete-all-button');
        if (deleteAllBtn) deleteAllBtn.addEventListener('click', deleteAllData);

        const heightSlider = panel.querySelector('#panel-height-slider');
        const heightValueSpan = panel.querySelector('#panel-height-value');
        if (heightSlider) {
            heightSlider.addEventListener('input', () => { if (heightValueSpan) heightValueSpan.textContent = heightSlider.value; });
            heightSlider.addEventListener('change', async () => {
                const v = parseInt(heightSlider.value, 10);
                await savePanelHeight(v);
                const container = document.getElementById('read-list-container');
                if (container) {
                    container.style.maxHeight = `calc(${currentPanelHeight}px - 200px)`;
                }
            });
        }

        const badgeSlider = panel.querySelector('#badge-size-slider');
        const badgeValueSpan = panel.querySelector('#badge-size-value');
        const badgeCheckbox = panel.querySelector('#badge-enabled-checkbox');
        if (badgeSlider) {
            badgeSlider.addEventListener('input', () => {
                badgeValueSpan.textContent = badgeSlider.value;
                settings.badgeSize = parseInt(badgeSlider.value, 10);
                createOrUpdateBadge();
            });
        }
        if (badgeCheckbox) {
            badgeCheckbox.addEventListener('change', () => {
                settings.badgeEnabled = badgeCheckbox.checked;
                createOrUpdateBadge();
            });
        }

        const saveSettingsBtn = panel.querySelector('#save-settings-button');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', async () => {
                const patternsRaw = (panel.querySelector('#allowed-patterns-input') || { value: '' }).value;
                const newAllowedPatterns = [];
                panel.querySelectorAll('#allowed-patterns-list-container .pattern-row').forEach(row => {
                    const pattern = row.querySelector('.pattern-item-pattern').value.trim();
                    const comment = row.querySelector('.pattern-item-comment').value.trim();
                    if (pattern) {
                        newAllowedPatterns.push({ pattern, comment });
                    }
                });

                const displayEnabled = !!(panel.querySelector('#display-enabled-checkbox') && panel.querySelector('#display-enabled-checkbox').checked);
                const modeEl = panel.querySelector('input[name="display-mode"]:checked');
                const displayMode = modeEl ? modeEl.value : 'gray';
                const badgeEnabled = !!(panel.querySelector('#badge-enabled-checkbox') && panel.querySelector('#badge-enabled-checkbox').checked);
                const badgeSize = parseInt((panel.querySelector('#badge-size-slider') || { value: DEFAULTS.SETTINGS.badgeSize }).value, 10);
                await saveSettings({ allowedPatterns: newAllowedPatterns, displayEnabled, displayMode, badgeEnabled, badgeSize });
                showSettingMessage('設定を保存しました。');
                updatePanelFooter();
                updateToggleButtonStatus();
                renderList();
                highlightReadLinks();
                createOrUpdateBadge();
                createOrUpdateToggleButton();
            });
        }

        const resetBtn = panel.querySelector('#reset-settings-button');
        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                if (confirm('設定を初期化します。よろしいですか？')) {
                    await saveSettings(JSON.parse(JSON.stringify(DEFAULTS.SETTINGS)));
                    await savePanelHeight(DEFAULTS.PANEL_HEIGHT);
                    populateSettingsControls();
                    showSettingMessage('設定を初期化しました。');
                    createOrUpdateToggleButton();
                }
            });
        }

        populateSettingsControls();
    };

    const createPatternRow = (pattern, comment) => {
        const row = document.createElement('div');
        row.className = 'pattern-row';
        row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 5px;';
        row.innerHTML = `
            <input type="text" class="pattern-item-pattern" value="${escapeHtml(pattern)}" placeholder="パターン" style="flex: 1;">
            <input type="text" class="pattern-item-comment" value="${escapeHtml(comment)}" placeholder="コメント" style="flex: 1;">
            <button class="delete-pattern-button" title="削除" style="background:none; border:none; cursor:pointer; font-size:16px; padding:0 4px; line-height: 1;">✖</button>
        `;
        row.querySelector('.delete-pattern-button').addEventListener('click', () => row.remove());
        return row;
    };

    const populateSettingsControls = () => {
        const elDisplay = document.getElementById('display-enabled-checkbox');
        const mode = settings.displayMode || 'gray';
        const heightSlider = document.getElementById('panel-height-slider');
        const heightValueSpan = document.getElementById('panel-height-value');
        const badgeSlider = document.getElementById('badge-size-slider');
        const badgeValueSpan = document.getElementById('badge-size-value');
        const badgeCheckbox = document.getElementById('badge-enabled-checkbox');
        const patternsContainer = document.getElementById('allowed-patterns-list-container');
        const addPatternBtn = document.getElementById('add-new-pattern-button');

        if (elDisplay) elDisplay.checked = !!settings.displayEnabled;
        const modeEls = document.querySelectorAll('input[name="display-mode"]');
        modeEls.forEach(r => { r.checked = (r.value === mode); });

        if (heightSlider) heightSlider.value = currentPanelHeight;
        if (heightValueSpan) heightValueSpan.textContent = currentPanelHeight;

        if (badgeSlider) badgeSlider.value = settings.badgeSize;
        if (badgeValueSpan) badgeValueSpan.textContent = settings.badgeSize;
        if (badgeCheckbox) badgeCheckbox.checked = !!settings.badgeEnabled;

        if (patternsContainer && addPatternBtn) {
            patternsContainer.innerHTML = ''; // Clear previous items
            (settings.allowedPatterns || []).forEach(item => {
                const row = createPatternRow(item.pattern, item.comment);
                patternsContainer.appendChild(row);
            });

            // Attach listener only once
            if (!addPatternBtn.dataset.listenerAttached) {
                addPatternBtn.addEventListener('click', () => {
                    const patternInput = document.getElementById('new-pattern-input');
                    const commentInput = document.getElementById('new-comment-input');
                    if (patternInput.value.trim()) {
                        const row = createPatternRow(patternInput.value.trim(), commentInput.value.trim());
                        patternsContainer.appendChild(row);
                        patternInput.value = '';
                        commentInput.value = '';
                    }
                });
                addPatternBtn.dataset.listenerAttached = 'true';
            }
        }
    };

    // format date safely
    const formatDateSafe = (iso) => {
        try {
            const t = new Date(iso);
            if (isNaN(t.getTime())) return iso || '';
            return t.toLocaleString();
        } catch (e) {
            return iso || '';
        }
    };

    // list rendering & interactions
    const renderList = () => {
        const container = document.getElementById('read-list-container');
        const countDisplay = document.getElementById('list-count-display');
        if (!container) return;

        const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase();
        const pages = Object.entries(readPagesCache).map(([url, d]) => ({ url, ...d })).sort((a,b) => new Date(b.date) - new Date(a.date));
        const filtered = pages
            .filter(p => (p.title||'').toLowerCase().includes(searchTerm) || (p.url||'').toLowerCase().includes(searchTerm) || ((p.comment||'').toLowerCase().includes(searchTerm)))
            .filter(p => {
                if (listFilterMode === 'all') return true;
                if (listFilterMode === 'read') return (p.status || 'read') === 'read';
                if (listFilterMode === 'in_progress') return (p.status || 'read') === 'in_progress';
                return true;
            });

        if (countDisplay) {
            countDisplay.textContent = `(${filtered.length})`;
        }

        if (filtered.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#888;margin-top:18px;">データがありません。</p>';
            return;
        }

        container.innerHTML = filtered.map(page => {
            const st = page.status || 'read';
            const safeTitle = escapeHtml(page.title || page.url || '');
            const safeUrl = escapeHtml(page.url || '');
            const safeComment = escapeHtml(page.comment || '');
            const dateStr = escapeHtml(formatDateSafe(page.date));
            return `
                <div class="list-item" data-url="${safeUrl}" data-status="${escapeHtml(st)}">
                    <div class="actions">
                        <button class="action-button copy-url-button" title="URLをコピー">📋</button>
                        <button class="action-button set-inprogress-button" title="巡回中に設定">🟠</button>
                        <button class="action-button set-read-button" title="既読に設定">✅</button>
                        <button class="action-button delete-button" title="削除">✖</button>
                    </div>
                    <div class="title" title="クリックして項目名を編集">${safeTitle}</div>
                    <div class="url">${safeUrl}</div>
                    <div class="date">更新: ${dateStr}</div>
                    <div class="status-text">状態: ${escapeHtml(statusLabel(st))}</div>
                    <div class="comment-section" title="クリックしてコメントを編集">${safeComment || 'コメントはありません'}</div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.list-item').forEach(item => {
            const del = item.querySelector('.delete-button');
            const cmt = item.querySelector('.comment-section');
            const setRead = item.querySelector('.set-read-button');
            const setIn = item.querySelector('.set-inprogress-button');
            const titleEl = item.querySelector('.title');
            const copyBtn = item.querySelector('.copy-url-button');

            const getItemUrl = (el) => {
                const raw = el.closest('.list-item').getAttribute('data-url') || '';
                return normalizeKey(raw);
            };

            del && del.addEventListener('click', async (e) => {
                e.stopPropagation();
                const url = getItemUrl(e.target);
                if (confirm(`この項目を削除しますか？\n\n${url}`)) {
                    delete readPagesCache[url];
                    await saveReadPages(readPagesCache);
                    renderList();
                    highlightReadLinks();
                    updatePanelFooter();
                    updateToggleButtonStatus();
                }
            });

            cmt && cmt.addEventListener('click', async (e) => {
                e.stopPropagation();
                const url = getItemUrl(e.target);
                const cur = readPagesCache[url] && readPagesCache[url].comment || '';
                const n = prompt('コメントを編集してください:', cur);
                if (n !== null) {
                    readPagesCache[url] = Object.assign({}, readPagesCache[url] || {}, { comment: n.trim(), date: new Date().toISOString() });
                    await saveReadPages(readPagesCache);
                    renderList();
                }
            });

            titleEl && titleEl.addEventListener('click', async (e) => {
                e.stopPropagation();
                const url = getItemUrl(e.target);
                const cur = readPagesCache[url] && readPagesCache[url].title || '';
                const n = prompt('項目名を編集してください:', cur);
                if (n !== null) {
                    readPagesCache[url] = Object.assign({}, readPagesCache[url] || {}, { title: n.trim(), date: new Date().toISOString() });
                    await saveReadPages(readPagesCache);
                    renderList();
                }
            });

            setRead && setRead.addEventListener('click', async (e) => {
                e.stopPropagation();
                const url = getItemUrl(e.target);
                await setPageStatus(url, 'read');
            });

            setIn && setIn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const url = getItemUrl(e.target);
                await setPageStatus(url, 'in_progress');
            });

            copyBtn && copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const url = getItemUrl(e.target);
                if (!url) return;
                try {
                    await navigator.clipboard.writeText(url);
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = '✔️';
                    copyBtn.title = 'コピーしました！';
                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                        copyBtn.title = 'URLをコピー';
                    }, 1500);
                } catch (err) {
                    console.error('URLのコピーに失敗しました: ', err);
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = '❌';
                    copyBtn.title = 'コピーに失敗';
                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                        copyBtn.title = 'URLをコピー';
                    }, 2000);
                }
            });
        });
    };

    /**
     * [新規追加] 現在のページがリストにある場合、その項目へスクロールしてハイライトする
     */
    const scrollToAndHighlightCurrentPage = () => {
        setTimeout(() => {
            const container = document.getElementById('read-list-container');
            if (!container) return;

            const existingHighlights = container.querySelectorAll('.list-item.current-page-highlight');
            existingHighlights.forEach(el => el.classList.remove('current-page-highlight'));

            const currentItem = container.querySelector(`.list-item[data-url="${escapeHtml(currentPageUrl)}"]`);
            if (currentItem) {
                currentItem.classList.add('current-page-highlight');
                currentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 50);
    };

    // link highlighting (use canonical)
    const highlightReadLinks = () => {
        const links = document.getElementsByTagName('a');
        for (const link of links) {
            try {
                const href = link.href || link.getAttribute('href') || '';
                const linkUrl = getCanonicalUrl(href);
                const ent = readPagesCache[linkUrl];
                if (ent && ent.status === 'read') {
                    link.classList.add('tampermonkey-read-link');
                    link.classList.remove('tampermonkey-inprogress-link');
                } else if (ent && ent.status === 'in_progress') {
                    link.classList.add('tampermonkey-inprogress-link');
                    link.classList.remove('tampermonkey-read-link');
                } else {
                    link.classList.remove('tampermonkey-read-link');
                    link.classList.remove('tampermonkey-inprogress-link');
                }
            } catch (err) { /* ignore malformed href */ }
        }
    };

    // fill missing titles from anchors
    const fillMissingTitlesFromAnchors = async () => {
        const anchors = document.querySelectorAll('a[href]');
        const anchorMap = {};
        for (const a of anchors) {
            try {
                const href = getCanonicalUrl(a.href || a.getAttribute('href'));
                if (!anchorMap[href]) {
                    const text = (a.textContent || a.title || '').trim();
                    if (text) anchorMap[href] = text;
                }
            } catch (e) {}
        }
        let changed = false;
        for (const k of Object.keys(readPagesCache)) {
            const p = readPagesCache[k] || {};
            if (!p.title || p.title === k) {
                const fromAnchor = anchorMap[k];
                const newTitle = fromAnchor || ((getCanonicalUrl(k) === currentPageUrl) ? (document.title || k) : k);
                if (newTitle && newTitle !== p.title) {
                    p.title = newTitle;
                    p.date = p.date || new Date().toISOString();
                    readPagesCache[k] = p;
                    changed = true;
                }
            }
        }
        if (changed) {
            await saveReadPages(readPagesCache);
        }
    };

    // current page controls
    const updateToggleButtonStatus = () => {
        const btn = document.getElementById('read-marker-toggle-button');
        if (!btn) return;
        btn.classList.remove('read','unread','inprogress');
        const ent = readPagesCache[currentPageUrl];
        if (ent && ent.status === 'read') btn.classList.add('read');
        else if (ent && ent.status === 'in_progress') btn.classList.add('inprogress');
        else btn.classList.add('unread');
    };

    const updatePanelFooter = () => {
        const btn = document.getElementById('current-page-status-button');
        if (!btn) return;
        if (!isAllowedPage(currentPageUrl)) {
            btn.textContent = 'このページは許可されていません';
            btn.className = '';
            btn.disabled = true;
            // also ensure toggle icon removed
            createOrUpdateToggleButton();
            createOrUpdateBadge();
        } else {
            btn.disabled = false;
            btn.className = '';
        }
        const ent = readPagesCache[currentPageUrl];
        btn.classList.remove('read','unread','inprogress');
        if (ent && ent.status === 'read') {
            btn.textContent = '既読済み (クリックして未読に戻す)';
            btn.classList.add('read');
        } else if (ent && ent.status === 'in_progress') {
            btn.textContent = '巡回中 (クリックして既読へ)';
            btn.classList.add('inprogress');
        } else {
            btn.textContent = 'このページを巡回中にする (クリックで巡回中→既読→未読)';
            btn.classList.add('unread');
        }

        // コメント表示を更新
        const commentEl = document.getElementById('current-page-pattern-comment');
        if (commentEl) {
            const matchingPattern = findMatchingPattern(currentPageUrl);
            const comment = matchingPattern ? matchingPattern.comment : '';
            commentEl.textContent = comment;
            commentEl.title = comment;
        }
    };

    const toggleCurrentPageStatus = async () => {
        if (!isAllowedPage(currentPageUrl)) {
            alert('このページは設定された許可パターンに含まれていないため、操作できません。');
            return;
        }
        const ent = readPagesCache[currentPageUrl];
        if (!ent) {
            await setPageStatus(currentPageUrl, 'in_progress');
        } else if (ent.status === 'in_progress') {
            await setPageStatus(currentPageUrl, 'read');
        } else if (ent.status === 'read') {
            await setPageStatus(currentPageUrl, 'unread');
        } else {
            await setPageStatus(currentPageUrl, 'in_progress');
        }
    };

    /**
     * [修正] add URL manually
     * 外部サイトのタイトルを自動取得するように修正
     */
    const addUrlManually = async (status) => {
        const input = document.getElementById('add-url-input');
        const msg = document.getElementById('add-status-message');
        const urlRaw = (input.value || '').trim();
        if (!urlRaw) {
            if (msg) { msg.textContent = 'URLを入力してください。'; msg.style.color = 'red'; }
            return;
        }
        const canonical = normalizeKey(urlRaw);
        const st = (status === 'in_progress') ? 'in_progress' : 'read';

        // 1. URLを仮タイトルとして即時追加
        readPagesCache[canonical] = {
            title: urlRaw,
            date: new Date().toISOString(),
            comment: '',
            status: st
        };
        await saveReadPages(readPagesCache);

        // 2. UIを即時更新
        input.value = '';
        renderList();
        if (msg) {
            msg.textContent = '追加しました。タイトルを取得中です...';
            msg.style.color = '#555';
        }

        // 3. バックグラウンドで本当のタイトルを取得
        let finalTitle = null;
        if (canonical === currentPageUrl) {
            finalTitle = document.title || canonical;
        } else {
            finalTitle = await fetchPageTitle(canonical);
        }

        // 4. タイトルが取得できたらデータを更新
        if (finalTitle && readPagesCache[canonical]) {
            readPagesCache[canonical].title = finalTitle;
            if (msg) {
                msg.textContent = (st === 'read') ? '既読として追加しました。' : '巡回中として追加しました。';
                msg.style.color = 'green';
            }
        } else {
            // 取得失敗時はURLのまま
            if (msg) {
                msg.textContent = 'タイトルを取得できませんでした。URLを項目名として登録しました。';
                msg.style.color = '#c65102';
            }
        }

        // 5. 最終的なデータを保存し、UIを再度更新
        await saveReadPages(readPagesCache);
        setTimeout(() => { if (msg) msg.textContent = ''; }, 3500);

        await fillMissingTitlesFromAnchors();
        renderList();
        highlightReadLinks();
        createOrUpdateBadge();
        updatePanelFooter();
        updateToggleButtonStatus();
    };


    // export / import / delete
    const exportData = async () => {
        const exportObj = {
            meta: { version: '5.3', exportedAt: new Date().toISOString() },
            pages: readPagesCache || {},
            settings: settings || {},
            panelHeight: currentPanelHeight || DEFAULTS.PANEL_HEIGHT
        };
        const dataStr = JSON.stringify(exportObj, null, 2);
        const blob = new Blob([dataStr], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        a.href = url;
        a.download = `${y}-${m}-${d}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSettingMessage('データをエクスポートしました。');
    };

    const importData = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                const hasPages = imported && typeof imported.pages === 'object';
                const hasSettings = imported && typeof imported.settings === 'object';
                const hasPanelHeight = imported && (typeof imported.panelHeight === 'number' || typeof imported.panelHeight === 'string');

                if (hasPages || hasSettings || hasPanelHeight) {
                    const overwriteAll = confirm('ファイルに既読データと/または設定が含まれています。ファイルの内容で既存データと設定を上書きしますか？\n\nOK = 上書き  /  キャンセル = マージ（既存に統合）');
                    if (overwriteAll) {
                        if (hasPages) {
                            const norm = {};
                            for (const rawKey of Object.keys(imported.pages || {})) {
                                const p = imported.pages[rawKey] || {};
                                const ck = normalizeKey(rawKey);
                                p.status = p.status || 'read';
                                p.date = p.date || new Date().toISOString();
                                p.title = p.title || ((ck === currentPageUrl) ? (document.title || ck) : ck);
                                norm[ck] = p;
                            }
                            await saveReadPages(norm);
                        }
                        if (hasSettings) await saveSettings(imported.settings || {});
                        if (hasPanelHeight) await savePanelHeight(parseInt(imported.panelHeight, 10));
                        applyGlobalStyles();
                        createPanel();
                        populateSettingsControls();
                        await fillMissingTitlesFromAnchors();
                        renderList();
                        updatePanelFooter();
                        updateToggleButtonStatus();
                        createOrUpdateBadge();
                        createOrUpdateToggleButton();
                        showSettingMessage('インポートして上書きしました。');
                    } else {
                        if (hasPages) {
                            const merged = Object.assign({}, readPagesCache);
                            for (const rawKey of Object.keys(imported.pages || {})) {
                                const p = imported.pages[rawKey] || {};
                                const ck = normalizeKey(rawKey);
                                p.status = p.status || 'read';
                                p.date = p.date || new Date().toISOString();
                                p.title = p.title || ((ck === currentPageUrl) ? (document.title || ck) : ck);
                                merged[ck] = p;
                            }
                            await saveReadPages(merged);
                        }
                        if (hasSettings) await saveSettings(imported.settings || {});
                        if (hasPanelHeight) {
                            if (confirm('インポートファイルにパネル高さが含まれています。反映しますか？')) {
                                await savePanelHeight(parseInt(imported.panelHeight, 10));
                            }
                        }
                        applyGlobalStyles();
                        createPanel();
                        populateSettingsControls();
                        await fillMissingTitlesFromAnchors();
                        renderList();
                        updatePanelFooter();
                        updateToggleButtonStatus();
                        createOrUpdateBadge();
                        createOrUpdateToggleButton();
                        showSettingMessage('インポートしてマージしました。');
                    }
                } else if (imported && typeof imported === 'object') {
                    const overwrite = confirm('インポートファイルにページデータが含まれている可能性があります。既存の既読データを上書きしますか？\nOK = 上書き / キャンセル = マージ');
                    if (overwrite) {
                        const norm = {};
                        for (const rawKey of Object.keys(imported)) {
                            const p = imported[rawKey] || {};
                            const ck = normalizeKey(rawKey);
                            p.status = p.status || 'read';
                            p.date = p.date || new Date().toISOString();
                            p.title = p.title || ((ck === currentPageUrl) ? (document.title || ck) : ck);
                            norm[ck] = p;
                        }
                        await saveReadPages(norm);
                        showSettingMessage('既読データをインポートして上書きしました。');
                    } else {
                        const merged = Object.assign({}, readPagesCache);
                        for (const rawKey of Object.keys(imported)) {
                            const p = imported[rawKey] || {};
                            const ck = normalizeKey(rawKey);
                            p.status = p.status || 'read';
                            p.date = p.date || new Date().toISOString();
                            p.title = p.title || ((ck === currentPageUrl) ? (document.title || ck) : ck);
                            merged[ck] = p;
                        }
                        await saveReadPages(merged);
                        showSettingMessage('既読データをインポートしてマージしました。');
                    }
                    applyGlobalStyles();
                    createPanel();
                    populateSettingsControls();
                    await fillMissingTitlesFromAnchors();
                    renderList();
                    updatePanelFooter();
                    updateToggleButtonStatus();
                    createOrUpdateBadge();
                    createOrUpdateToggleButton();
                } else {
                    throw new Error('不明な形式');
                }
            } catch (err) {
                showSettingMessage('無効なファイル形式です。', true);
            } finally {
                event.target.value = '';
            }
        };
        reader.readAsText(file);
    };

    const deleteAllData = async () => {
        if (confirm('本当にすべての既読データを削除しますか？この操作は元に戻せません。')) {
            if (prompt('削除を実行するには、「delete」と入力してください。') === 'delete') {
                await saveReadPages({});
                renderList();
                highlightReadLinks();
                updatePanelFooter();
                updateToggleButtonStatus();
                showSettingMessage('全データを削除しました。', true);
            } else {
                showSettingMessage('入力を確認できなかったため中断しました。');
            }
        }
    };

    const showSettingMessage = (text, isError = false) => {
        const el = document.getElementById('setting-status-message');
        if (!el) return;
        el.textContent = text;
        el.style.color = isError ? 'red' : 'green';
        setTimeout(() => { el.textContent = ''; }, 4000);
    };

    // main
    const main = async () => {
        await getPanelHeight();
        await getSettings();
        await getReadPages();
        applyGlobalStyles();
        createPanel();
        updatePanelFooter();
        updateToggleButtonStatus();
        renderList();
        highlightReadLinks();
        await fillMissingTitlesFromAnchors();
        renderList();
        highlightReadLinks();
        createOrUpdateBadge();
        createOrUpdateToggleButton();

        const observer = new MutationObserver(() => scheduleHighlight());
        observer.observe(document.body, { childList: true, subtree: true, attributes: false });
    };

    main();

})();

// ==UserScript==
// @name         Pixiv管理 開発版v1.3
// @namespace    http://tampermonkey.net/
// @version      1.3
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

    // CSSクラスを追加してグレースケール効果を定義
    GM_addStyle(`
        .pixiv-followed-gray {
            filter: grayscale(100%) !important;
        }
    `);

    // ログイン中の自分のユーザーIDを取得する（フォロー一覧ページのHTMLから抽出）
    async function getMyUserId() {
        const res = await fetch('https://www.pixiv.net/bookmark.php?type=user', { credentials: 'include' });
        const text = await res.text();
        // ページ内に "member.php?id=数字" という表記があるので正規表現で抽出
        const m = text.match(/member\.php\?id=(\d+)/);
        return m ? m[1] : null;
    }

    // フォロー中ユーザーIDのセットを取得・更新
    let followedSet = new Set();
    async function updateFollowedList() {
        const userId = await getMyUserId();
        if (!userId) {
            console.warn('Pixiv: ユーザーIDが取得できませんでした。ログイン状態を確認してください。');
            return;
        }
        let offset = 0, limit = 48, hasMore = true;
        const newSet = new Set();
        while (hasMore) {
            // Pixiv Ajax APIを利用しフォロー中リストを取得
            const url = `https://www.pixiv.net/ajax/user/${userId}/following?offset=${offset}&limit=${limit}&rest=show`;
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) {
                console.warn('Pixiv: フォローリスト取得に失敗', res.status);
                break;
            }
            const data = await res.json();
            const users = data.body.users;
            for (const u of users) {
                newSet.add(u.userId.toString());
            }
            // 次ページの判断: 返ってきた件数がlimit未満なら終了
            hasMore = (users.length === limit);
            offset += limit;
        }
        followedSet = newSet;
        // キャッシュに保存
        GM_setValue('pixivFollowedList', JSON.stringify([...followedSet]));
        // 次回呼び出しでdiffを使いたい場合は古いキャッシュと比較するなどの工夫も可能
    }

    // キャッシュが残っていればそれを読み込む
    (function loadCache() {
        const saved = GM_getValue('pixivFollowedList', null);
        if (saved) {
            try {
                followedSet = new Set(JSON.parse(saved));
            } catch(e) {
                followedSet = new Set();
            }
        }
    })();

    // サムネイル要素に対してグレースケールを適用
    function grayOutIfFollowed(element) {
        // 作者リンクのURLからIDを取得
        const a = element.querySelector("a[href*='/users/']");
        if (!a) return;
        const m = a.href.match(/\/users\/(\d+)/);
        if (m && followedSet.has(m[1])) {
            // サムネイル画像またはその親にグレークラスを付与
            const img = element.querySelector("img");
            if (img) {
                img.classList.add('pixiv-followed-gray');
            } else {
                element.classList.add('pixiv-followed-gray');
            }
        }
    }

    // ページ上の全サムネイルをスキャン
    function scanPage() {
        // 一般的なPixivのサムネイル要素の例：作品リストや関連項目のliやdivなど
        document.querySelectorAll("a[href*='/users/']").forEach(a => {
            // 親要素（サムネイルブロック）を対象に
            const block = a.closest('.sc-'); // クラス名は版毎に異なるため汎用的に修正必要
            if (block) grayOutIfFollowed(block);
        });
    }

    // MutationObserverで動的追加要素を監視
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    // 新たにDOM要素が追加された場合に再スキャン
                    if (node.querySelector) scanPage();
                }
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 初期読み込み時と定期的にフォローリスト取得を実行
    (async function init() {
        await updateFollowedList();
        scanPage();
        // 5分ごとにフォローリストを更新
        setInterval(updateFollowedList, 1000 * 60 * 5);
    })();
})();

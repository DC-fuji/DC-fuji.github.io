// レビューでえらぶ 買いものさがし（GitHub Pages で動く静的ページ）
// 楽天市場商品検索API（2026-07-01版）にブラウザから問い合わせる。
// まず通常の取得（fetch）を試し、ブラウザの制限で失敗したら JSONP（callback）で取り直す。
(function () {
  "use strict";

  var ENDPOINT = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";
  var MIN_INTERVAL_MS = 1100;   // 楽天への問い合わせは1秒に1回まで
  var cfg = window.SITE_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var state = { page: 1, pageCount: 1, lastAt: 0, busy: false, mode: "fetch", shown: 0 };

  var DEMO = /[?&]demo=1\b/.test(location.search);   // 見た目の確認用。楽天には問い合わせない

  function ready() {
    return DEMO || (cfg.applicationId && cfg.accessKey);
  }

  function readForm() {
    return {
      q: $("q").value.trim(), g: $("g").value, s: $("s").value,
      pmin: $("pmin").value, pmax: $("pmax").value,
      rc: $("rc").value, ra: $("ra").value,
      pt: $("pt").checked ? "1" : "", pf: $("pf").checked ? "1" : ""
    };
  }

  function writeForm(v) {
    if (v.q != null) $("q").value = v.q;
    if (v.g != null) $("g").value = v.g;
    if (v.s != null) $("s").value = v.s;
    $("pmin").value = v.pmin || ""; $("pmax").value = v.pmax || "";
    $("rc").value = v.rc || "0"; $("ra").value = v.ra || "0";
    $("pt").checked = v.pt === "1"; $("pf").checked = v.pf === "1";
  }

  // 検索条件をアドレスに残す（ブックマークや共有ができるように）。鍵は入れない
  function syncUrl(v) {
    var p = new URLSearchParams();
    Object.keys(v).forEach(function (k) { if (v[k] && v[k] !== "0") p.set(k, v[k]); });
    if (DEMO) p.set("demo", "1");
    var qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  function buildParams(v, page) {
    var p = new URLSearchParams();
    p.set("applicationId", cfg.applicationId);
    p.set("accessKey", cfg.accessKey);
    if (cfg.affiliateId) p.set("affiliateId", cfg.affiliateId);
    p.set("format", "json");
    p.set("formatVersion", "2");
    p.set("hits", "30");
    p.set("page", String(page));
    p.set("availability", "1");
    if (v.q) p.set("keyword", v.q);
    if (v.g) p.set("genreId", v.g);
    if (!v.q && !v.g) p.set("genreId", "0");
    p.set("sort", v.s || "standard");
    if (v.pmin) p.set("minPrice", v.pmin);
    if (v.pmax) p.set("maxPrice", v.pmax);
    if (Number(v.rc) > 0 || Number(v.ra) > 0) p.set("hasReviewFlag", "1");
    if (v.pt) { p.set("pointRateFlag", "1"); p.set("pointRate", "2"); }
    if (v.pf) p.set("postageFlag", "1");
    return p;
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function throttle() {
    var gap = Date.now() - state.lastAt;
    state.lastAt = Date.now() + Math.max(0, MIN_INTERVAL_MS - gap);
    return wait(Math.max(0, MIN_INTERVAL_MS - gap));
  }

  function viaFetch(params) {
    return fetch(ENDPOINT + "?" + params.toString(), { method: "GET", credentials: "omit" })
      .then(function (r) {
        return r.text().then(function (t) {
          var body = null;
          try { body = JSON.parse(t); } catch (e) { /* 下で扱う */ }
          if (!r.ok) {
            var err = new Error(apiMessage(body) || ("HTTP " + r.status));
            err.http = r.status;
            throw err;
          }
          return body;
        });
      });
  }

  function viaJsonp(params) {
    return new Promise(function (resolve, reject) {
      var name = "rkcb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
      var s = document.createElement("script");
      var timer = setTimeout(function () { cleanup(); reject(new Error("応答がありませんでした")); }, 12000);
      function cleanup() { clearTimeout(timer); delete window[name]; s.remove(); }
      window[name] = function (data) { cleanup(); resolve(data); };
      params.set("callback", name);
      s.src = ENDPOINT + "?" + params.toString();
      s.onerror = function () { cleanup(); reject(new Error("読み込めませんでした")); };
      document.head.appendChild(s);
    });
  }

  function apiMessage(body) {
    if (!body) return "";
    if (body.error_description) return body.error_description;
    if (body.errors && body.errors.errorMessage) return body.errors.errorMessage;
    if (body.error) return String(body.error);
    return "";
  }

  function request(params) {
    if (state.mode === "jsonp") return viaJsonp(params);
    return viaFetch(params).catch(function (e) {
      if (e && e.http) throw e;              // 楽天がエラーを返した（通信はできている）
      state.mode = "jsonp";                  // ブラウザの制限で取れなかったときは JSONP に切り替える
      return viaJsonp(params);
    });
  }

  function itemsOf(body) {
    if (!body) return [];
    var arr = body.Items || body.items || [];
    return arr.map(function (x) { return x.Item || x.item || x; });
  }

  function img(it) {
    var m = it.mediumImageUrls || [];
    var u = m.length ? (typeof m[0] === "string" ? m[0] : (m[0].imageUrl || "")) : "";
    return u ? u.replace(/\?_ex=\d+x\d+/, "?_ex=300x300") : "";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function yen(n) { return Number(n || 0).toLocaleString("ja-JP") + "円"; }

  function safeLink(u) {
    // 楽天のサイトへのリンクだけを出す（楽天ウェブサービス利用規約 第8条4項）
    return /^https:\/\/([a-z0-9-]+\.)*rakuten\.co\.jp\//.test(u || "") ? u : "https://www.rakuten.co.jp/";
  }

  function card(it) {
    var link = safeLink(it.affiliateUrl || it.itemUrl);
    var avg = Number(it.reviewAverage || 0);
    var cnt = Number(it.reviewCount || 0);
    var pr = Number(it.pointRate || 1);
    var postage = Number(it.postageFlag || 0) === 0 ? "送料込み" : "送料別";
    var src = img(it);
    return '<article class="item">' +
      (src ? '<a href="' + esc(link) + '" target="_blank" rel="noopener sponsored"><img src="' + esc(src) + '" alt="" loading="lazy"></a>' : "") +
      '<div class="name"><a href="' + esc(link) + '" target="_blank" rel="noopener sponsored">' + esc(it.itemName) + "</a></div>" +
      '<div class="price">' + yen(it.itemPrice) + ' <span class="tag">' + postage + "</span></div>" +
      '<div class="meta"><span>' + (cnt ? "★" + avg.toFixed(1) + "（" + cnt.toLocaleString("ja-JP") + "件）" : "レビューなし") + "</span>" +
      (pr > 1 ? "<span>ポイント" + pr + "倍</span>" : "") +
      "<span>" + esc(it.shopName || "") + "</span></div>" +
      "</article>";
  }

  function passes(it, v) {
    if (Number(v.rc) > 0 && Number(it.reviewCount || 0) < Number(v.rc)) return false;
    if (Number(v.ra) > 0 && Number(it.reviewAverage || 0) < Number(v.ra)) return false;
    return true;
  }

  function setStatus(text, isErr) {
    var el = $("status");
    el.textContent = text;
    el.className = "status" + (isErr ? " err" : "");
  }

  function demoBody() {
    var names = ["【見本】長袖Tシャツ 3枚セット 80〜140cm", "【見本】ワイドパンツ ウエストゴム M〜3L", "【見本】収納ラック 3段 幅60cm",
                 "【見本】メンズ スウェット 裏起毛", "【見本】電気ケトル 1.0L", "【見本】キッズ ボアジャケット 100〜130cm"];
    return { pageCount: 1, Items: names.map(function (n, i) {
      return { itemName: n, itemPrice: 1980 + i * 1000, itemUrl: "https://www.rakuten.co.jp/", mediumImageUrls: [],
               reviewCount: [3400, 12000, 860, 450, 2100, 86][i], reviewAverage: [4.4, 4.2, 4.5, 4.3, 4.6, 4.6][i],
               pointRate: [5, 1, 3, 1, 10, 10][i], postageFlag: i % 3 === 0 ? 1 : 0, shopName: "見本ショップ" };
    }) };
  }

  function search(append) {
    if (state.busy) return;
    if (!ready()) {
      setStatus("準備中です。もうすぐ検索できるようになります。", false);
      return;
    }
    var v = readForm();
    if (!append) { state.page = 1; state.shown = 0; $("list").innerHTML = ""; }
    syncUrl(v);
    state.busy = true;
    $("go").disabled = true; $("more").hidden = true;
    setStatus("さがしています…", false);

    var job = DEMO ? Promise.resolve(demoBody()) : throttle().then(function () { return request(buildParams(v, state.page)); });
    job.then(function (body) {
      var all = itemsOf(body);
      var hit = all.filter(function (it) { return passes(it, v); });
      $("list").insertAdjacentHTML("beforeend", hit.map(card).join(""));
      state.shown += hit.length;
      state.pageCount = Number(body.pageCount || 1);
      var more = state.page < state.pageCount;
      $("more").hidden = !more;
      if (!state.shown && !more) setStatus("条件に合う商品が見つかりませんでした。条件をゆるめてみてください。", false);
      else if (!hit.length) setStatus("このページには条件に合う商品がありませんでした。「もっと見る」で続きを探せます。", false);
      else setStatus(state.shown + "件を表示中" + (DEMO ? "（表示確認用の見本です）" : ""), false);
    }).catch(function (e) {
      var msg = (e && e.message) || "";
      if (/REFERRER|Referer|referrer|ORIGIN/i.test(msg)) msg = "このページからの問い合わせが許可されていません（アプリの『許可されたWebサイト』を確認）";
      if (e && e.http === 429) msg = "問い合わせが多すぎました。少し待ってからもう一度お試しください。";
      setStatus("うまく取得できませんでした。" + (msg ? "（" + msg + "）" : ""), true);
    }).then(function () {
      state.busy = false; $("go").disabled = false;
    });
  }

  $("f").addEventListener("submit", function (e) { e.preventDefault(); search(false); });
  $("more").addEventListener("click", function () { state.page += 1; search(true); });
  document.querySelectorAll("[data-preset]").forEach(function (b) {
    b.addEventListener("click", function () {
      var p = JSON.parse(b.getAttribute("data-preset"));
      writeForm({ q: "", g: p.g || "", s: p.s || "-reviewCount", pmin: p.pmin, pmax: p.pmax, rc: p.rc, ra: p.ra, pt: p.pt, pf: p.pf });
      search(false);
    });
  });

  // アドレスに条件があれば、それで検索する
  var init = {};
  new URLSearchParams(location.search).forEach(function (val, key) { init[key] = val; });
  if (Object.keys(init).some(function (k) { return k !== "demo"; })) {
    writeForm(init);
    search(false);
  } else if (!ready()) {
    setStatus("準備中です。もうすぐ検索できるようになります。", false);
  }
})();

// LENS Extension v2.7.11 — CA auto-detect: CA → deployer → Bankrbot

(function () {
  'use strict';
  let lastUrl = location.href;
  let scanTimeout = null;

  // Guard: extension context can be invalidated after reload/update.
  // Returns false when chrome APIs are no longer usable, so we skip gracefully.
  function ctxValid() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
    catch (e) { return false; }
  }
  function safeStorageGet(keys, cb) {
    if (!ctxValid()) return;
    try { chrome.storage.local.get(keys, r => { if (!chrome.runtime.lastError) cb(r || {}); }); }
    catch (e) {}
  }
  function safeSendMessage(msg, cb) {
    if (!ctxValid()) { if (cb) cb(null); return; }
    try { chrome.runtime.sendMessage(msg, r => { if (chrome.runtime.lastError) { if (cb) cb(null); return; } if (cb) cb(r); }); }
    catch (e) { if (cb) cb(null); }
  }

  // ── User settings (synced from the popup via chrome.storage.local) ──
  const SETTINGS_DEFAULTS = {
    show_pleasebro: true, show_dev_sold: true, show_claim: true, show_new_token: true,
    auto_inject: true, detect_ca_bio: true, compact_mode: false, launch_alerts: true,
    src_bankr: true, src_alchemy: true, src_github: true, crowd_report: true,
    auto_origin: true, ai_verdict: true,
  };
  let SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);
  function loadSettings(cb) {
    safeStorageGet(['LENS_SETTINGS'], r => {
      SETTINGS = Object.assign({}, SETTINGS_DEFAULTS, (r && r.LENS_SETTINGS) || {});
      if (cb) cb();
    });
  }
  loadSettings();
  // React instantly when settings change in the popup: re-inject the panel.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.LENS_SETTINGS) return;
      SETTINGS = Object.assign({}, SETTINGS_DEFAULTS, changes.LENS_SETTINGS.newValue || {});
      const old = document.getElementById('lens-panel'); if (old) old.remove();
      const nb = document.getElementById('lens-name-badges'); if (nb) nb.remove();
      const sr0 = document.getElementById('lens-smart-namerow'); if (sr0) sr0.remove();
      const ml0 = document.getElementById('lens-mylist-row'); if (ml0) ml0.remove();
      if (SETTINGS.auto_inject) setTimeout(tryInject, 200);
    });
  } catch (e) {}

  // Manual "smart accounts" watchlist (global). LENS shows which of these follow a
  // profile by reading X's "followers you follow" list. You must follow these accounts
  // on your own X for them to appear there. Handles only (lowercase, no @).
  const SMART_ACCOUNTS = new Set([
    'pumpdotfun','degods','infinex','alliancedao','cehv','potionalpha','legion','gbv',
    'azura','probably','ai16z','alliance','iosgvc','rove','sendai',
    'jessepollak','frankdegods','binji_x','zora','ethglobal','lookonchain','rewkang',
    '0xmaki','toly','0xdeployer','everythingempty',
    'zerion','inversebrah','solana','cobie5','brian_armstrong','elonmusk','vitalikbuterin',
    'lucanetz','muststopmurad','0xmikedee','azflin','a1lon9','js_horne','haydenzadams',
    'cz_binance','maybeltr','shawmakesmagic','erikvoorhees','binance','nftboi_','game_for_one',
    'cl207','kiennguyen_nft','nansen_ai','jackbutcher','cookerflips','dingalingts',
    'asvanevik','zhusu','punk6529','notthreadguy','justinsuntron','sama'
  ]);
  // Auto-harvested handles (copied from Frontrun's rendered smart-follower pills) persist here.
  try { chrome.storage.local.get('lens_smart_harvested', (r) => { (r && r.lens_smart_harvested || []).forEach(h => SMART_ACCOUNTS.add(h)); }); } catch (e) {}

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      clearTimeout(scanTimeout);
      const old = document.getElementById('lens-panel');
      if (old) old.remove();
      const nb = document.getElementById('lens-name-badges');
      if (nb) nb.remove();
      const sr1 = document.getElementById('lens-smart-namerow'); if (sr1) sr1.remove();
      const ml1 = document.getElementById('lens-mylist-row'); if (ml1) ml1.remove();
      maybeCaptureAbout(); // if we navigated to the About page during an origin check
      maybeCaptureFollowers(); // if we navigated to followers_you_follow during a smart-follower scan
      scanTimeout = setTimeout(tryInject, 1500);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(tryInject, 2000);
  setTimeout(maybeCaptureAbout, 900); // handles full-reload landing on the About page
  setTimeout(maybeCaptureFollowers, 900); // handles landing on followers_you_follow

  function tryInject() {
    if (!SETTINGS.auto_inject) return;
    const isProfile = /^https:\/\/(x|twitter)\.com\/[^/?#]+\/?$/.test(location.href)
      && !['home','explore','notifications','messages','search','i'].some(p => location.href.includes(`/${p}`));
    if (!isProfile) return;
    if (document.getElementById('lens-panel')) return;
    const nameEl = document.querySelector('[data-testid="UserName"]');
    if (!nameEl) { setTimeout(tryInject, 1000); return; }
    injectPanel();
  }

  function getXUsername() {
    const match = location.href.match(/x\.com\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  // Hunt for token CAs across the profile, not just the bio:
  // 1) bio  2) pinned tweet + timeline tweets  3) bankr.bot/launches links  4) basescan token links
  function harvestAddresses(bio) {
    const found = [];
    const addrRe = /0x[a-fA-F0-9]{40}/g;

    // 1) bio
    if (bio && SETTINGS.detect_ca_bio) { const m = bio.match(addrRe); if (m) found.push(...m); }

    // 2) tweets (pinned shows first in the timeline; scan the first ~8 tweet texts)
    try {
      const tweets = document.querySelectorAll('[data-testid="tweetText"]');
      let count = 0;
      for (const t of tweets) {
        if (count++ >= 8) break;
        const m = (t.textContent || '').match(addrRe);
        if (m) found.push(...m);
      }
    } catch (e) {}

    // 3) bankr.bot/launches/0x... and basescan token links anywhere on the page
    try {
      document.querySelectorAll('a[href*="bankr.bot/launches/"], a[href*="basescan.org/token/"], a[href*="dexscreener.com/base/"]').forEach(a => {
        const m = (a.href || '').match(addrRe);
        if (m) found.push(...m);
      });
    } catch (e) {}

    // Dedupe, drop obvious zero address
    return [...new Set(found.map(a => a.toLowerCase()))].filter(a => a !== '0x0000000000000000000000000000000000000000');
  }

  function extractProfileData() {
    const bioEl = document.querySelector('[data-testid="UserDescription"]');
    const bio = bioEl ? bioEl.textContent : '';
    const locEl = document.querySelector('[data-testid="UserLocation"]');
    const location = locEl ? (locEl.textContent || '').trim() : '';
    const addresses = harvestAddresses(bio);
    const gh = harvestGitHub(bio);
    return { bio, location, addresses, github: gh ? gh.username : null, github_source: gh ? gh.source : null, username: getXUsername() };
  }

  // Find a dev's GitHub from multiple sources: profile links, website field,
  // github.io pages, bio text patterns, and pinned/timeline tweets.
  // Returns { username, source } or null. (X-handle fallback is verified separately.)
  function harvestGitHub(bio) {
    const skip = new Set(['github','features','about','marketplace','sponsors','pricing','enterprise','login','signup','explore','topics','collections','trending','orgs','apps','settings','notifications','site','security','readme']);
    const valid = u => !!u && u.length >= 1 && u.length <= 39 && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(u) && !skip.has(u.toLowerCase());
    const fromStr = s => {
      if (!s) return null;
      let m = s.match(/github\.com\/([a-zA-Z0-9-]+)/i);   if (m && valid(m[1])) return m[1];
      m = s.match(/\b([a-zA-Z0-9-]+)\.github\.io/i);       if (m && valid(m[1])) return m[1];
      m = s.match(/(?:github|gh)\s*[:\/]\s*@?([a-zA-Z0-9-]+)/i); if (m && valid(m[1])) return m[1];
      return null;
    };

    // 1) Any github link rendered on the page (bio links, website field, tweet links)
    try {
      const links = document.querySelectorAll('a[href*="github.com"], a[href*="github.io"]');
      for (const a of links) { const u = fromStr(a.href || ''); if (u) return { username: u, source: 'link' }; }
    } catch (e) {}

    // 2) Website field (X sometimes shows display text, so read href + text)
    try {
      const urlEl = document.querySelector('[data-testid="UserUrl"]');
      if (urlEl) { const u = fromStr((urlEl.getAttribute('href') || '') + ' ' + (urlEl.textContent || '')); if (u) return { username: u, source: 'website' }; }
    } catch (e) {}

    // 3) Bio text (bare patterns, not just full URLs)
    { const u = fromStr(bio); if (u) return { username: u, source: 'bio' }; }

    // 4) Pinned + recent tweets — devs often drop their repo in posts
    try {
      const tweets = document.querySelectorAll('[data-testid="tweetText"]');
      let n = 0;
      for (const t of tweets) { if (n++ >= 8) break; const u = fromStr(t.textContent || ''); if (u) return { username: u, source: 'tweet' }; }
    } catch (e) {}

    return null;
  }

  // ── CA-removal tracker ──
  // Remembers contract addresses shown in a profile's BIO across visits, and flags
  // when a previously-shown CA disappears (classic rug move: post CA, pump, delete CA).
  // Forward-looking: only catches removals that happen AFTER LENS first saw the CA.
  function trackCaHistory(username, bio) {
    if (!username || !SETTINGS.detect_ca_bio) return;
    const addrRe = /0x[a-fA-F0-9]{40}/g;
    const ZERO = '0x0000000000000000000000000000000000000000';
    const current = [...new Set(((bio || '').match(addrRe) || []).map(a => a.toLowerCase()))].filter(a => a !== ZERO);

    safeStorageGet(['LENS_CA_HISTORY'], (r) => {
      const all = (r && r.LENS_CA_HISTORY) || {};
      const key = username.toLowerCase();
      const rec = all[key] || { cas: {}, updated: 0 };
      const now = Date.now();

      // Refresh present CAs
      current.forEach(ca => {
        const e = rec.cas[ca] || { first: now, present: true, removedAt: null };
        e.present = true; e.removedAt = null; e.last = now;
        if (!e.first) e.first = now;
        rec.cas[ca] = e;
      });

      // Detect removals: a stored CA no longer present in the bio
      const removed = [];
      Object.keys(rec.cas).forEach(ca => {
        if (current.includes(ca)) return;
        const e = rec.cas[ca];
        if (e.present) { e.present = false; e.removedAt = now; } // newly removed this visit
        removed.push({ ca, first: e.first, removedAt: e.removedAt });
      });

      rec.updated = now;
      all[key] = rec;

      // Soft cap: keep the 400 most-recently-seen profiles
      const keys = Object.keys(all);
      if (keys.length > 400) {
        keys.sort((a, b) => (all[a].updated || 0) - (all[b].updated || 0));
        keys.slice(0, keys.length - 400).forEach(k => delete all[k]);
      }
      try { if (ctxValid()) chrome.storage.local.set({ LENS_CA_HISTORY: all }); } catch (e) {}

      if (removed.length) renderCaRemoved(removed);
    });
  }

  function renderCaRemoved(removed) {
    addLabel('ca-removed', 'CA Removed');
    const box = document.getElementById('lens-ca-history');
    if (!box) return;
    const rows = removed.slice(0, 3).map(x => {
      const short = x.ca.slice(0, 6) + '…' + x.ca.slice(-4);
      const when = x.removedAt ? timeAgo(x.removedAt) : '';
      const held = x.first ? timeAgo(x.first) : '';
      return `<div class="lens-cahist-row">
        <a href="https://basescan.org/token/${x.ca}" target="_blank" rel="noopener">${short}</a>
        <span class="lens-cahist-meta">removed${when ? ` · ${when}` : ''}${held ? ` · first seen ${held}` : ''}</span>
      </div>`;
    }).join('');
    box.style.display = 'block';
    box.innerHTML = `<div class="lens-cahist-title">⚠ CA REMOVED FROM BIO — ${removed.length} address${removed.length > 1 ? 'es' : ''}</div>${rows}${removed.length > 3 ? `<div class="lens-cahist-more">+${removed.length - 3} more</div>` : ''}`;
  }

  // ── Crowd-sourced report ──
  // Report wallet-bearing tweets visible on this profile to the backend so the network
  // builds a shared archive and can flag deleted wallet tweets over time. Public data
  // only. Gated by the "Share to network" setting.
  function reportProfile(profile) {
    if (!profile || !profile.username || !SETTINGS.crowd_report) return;
    try {
      const addrRe = /0x[a-fA-F0-9]{40}/g;
      const solRe = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
      const ZERO = '0x0000000000000000000000000000000000000000';
      const arts = document.querySelectorAll('article[data-testid="tweet"]');
      const tweets = [];
      let newest = null, oldest = null, n = 0;
      for (const art of arts) {
        if (n++ >= 25) break;
        const link = art.querySelector('a[href*="/status/"]');
        const idm = link && (link.getAttribute('href') || '').match(/\/status\/(\d+)/);
        const id = idm ? idm[1] : null;
        const timeEl = art.querySelector('time[datetime]');
        const created = timeEl ? timeEl.getAttribute('datetime') : null;
        if (!id || !created) continue;
        if (!newest || created > newest) newest = created;
        if (!oldest || created < oldest) oldest = created;
        const textEl = art.querySelector('[data-testid="tweetText"]');
        const text = textEl ? (textEl.textContent || '') : '';
        const wallets = [];
        (text.match(addrRe) || []).forEach(a => { const w = a.toLowerCase(); if (w !== ZERO) wallets.push({ wallet: w, chain: 'evm' }); });
        (text.replace(addrRe, ' ').match(solRe) || []).forEach(a => wallets.push({ wallet: a, chain: 'sol' }));
        if (wallets.length) tweets.push({ id, text: text.slice(0, 500), created_at: created, wallets });
      }
      // Bio / linked wallets harvested from the profile (CA in bio, links, pinned).
      const bioWallets = (profile.addresses || []).slice(0, 20).map(a => ({ wallet: a, chain: 'evm' }));
      // Only contribute for crypto-relevant profiles (a wallet tweet now, or a CA in bio).
      if (!tweets.length && !bioWallets.length) return;
      const payload = { username: profile.username.toLowerCase(), tweets, bio_wallets: bioWallets };
      if (newest && oldest) payload.range = { newest, oldest };
      fetch('https://lens-liard.vercel.app/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch (e) {}
  }

  // Inject a compact badge row right under the profile name (Frontrunpro-style).
  // Kept separate from the main detail panel; updated once Bankr data arrives.
  function injectNameBadges() {
    if (document.getElementById('lens-name-badges')) return;
    const nameEl = document.querySelector('[data-testid="UserName"]');
    if (!nameEl) return;
    const row = document.createElement('div');
    row.id = 'lens-name-badges';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin:4px 0 2px;font-family:-apple-system,system-ui,sans-serif';
    row.innerHTML = `<span class="lens-nb-pill" style="font-size:10px;color:#8899a6;border:1px solid #2f3b47;border-radius:6px;padding:2px 7px">LENS scanning…</span>`;
    nameEl.parentNode.insertBefore(row, nameEl.nextSibling);
  }

  // Update the name-badge row. badges = [{label, color}]
  function setNameBadges(badges) {
    const row = document.getElementById('lens-name-badges');
    if (!row) return;
    if (!badges || !badges.length) { row.innerHTML = ''; return; }
    row.innerHTML = badges.map(b =>
      `<span class="lens-nb-pill" style="font-size:10px;font-weight:700;color:${b.color};border:1px solid ${b.color}55;background:${b.color}1a;border-radius:6px;padding:2px 7px;cursor:pointer">${b.label}</span>`
    ).join('');
    // Clicking any badge scrolls to the full LENS panel
    row.querySelectorAll('.lens-nb-pill').forEach(p => {
      p.onclick = () => { const panel = document.getElementById('lens-panel'); if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    });
  }

  // Smooth, precise expand/collapse for panel sections (measures real height, no dead-time).
  let LENS_SELF_LOC = '';
  function toggleSection(section) {
    const body = section && section.querySelector('.lens-section-body');
    if (!body) { if (section) section.classList.toggle('collapsed'); return; }
    const collapsed = section.classList.contains('collapsed');
    if (collapsed) {
      body.style.maxHeight = '0px';
      section.classList.remove('collapsed');
      const target = body.scrollHeight;
      requestAnimationFrame(() => { body.style.maxHeight = target + 'px'; });
      const done = (e) => { if (e.propertyName !== 'max-height') return; body.style.maxHeight = 'none'; body.removeEventListener('transitionend', done); };
      body.addEventListener('transitionend', done);
    } else {
      body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        body.style.maxHeight = '0px';
        section.classList.add('collapsed');
      }));
    }
  }
  function wireSectionToggles(panel) {
    panel.querySelectorAll('.lens-section-header').forEach(h => {
      h.removeAttribute('onclick');
      h.onclick = () => {
        const section = h.parentElement;
        const wasCollapsed = section.classList.contains('collapsed');
        toggleSection(section);
        if (wasCollapsed && section.id === 'lens-origin-section') maybeRunOriginOnExpand();
      };
    });
  }
  // Chip bar — tap a chip to open that module inline (single-open), Frontrun-style.
  function lensChip(btn, panel) {
    const targetId = btn.getAttribute('data-target');
    const target = document.getElementById(targetId);
    if (!target) return;
    const willOpen = target.classList.contains('collapsed');
    panel.querySelectorAll('.lens-section.lens-chipped').forEach(s => { if (!s.classList.contains('collapsed')) toggleSection(s); });
    panel.querySelectorAll('.lens-chip').forEach(c => c.classList.remove('active'));
    if (willOpen) {
      toggleSection(target);
      btn.classList.add('active');
      if (targetId === 'lens-origin-section') maybeRunOriginOnExpand();
      if (targetId === 'lens-smart-section') maybeRunSmartOnExpand();
    }
  }
  function wireChips(panel) {
    panel.querySelectorAll('.lens-chip').forEach(btn => { btn.onclick = () => lensChip(btn, panel); });
  }
  function maybeRunOriginOnExpand() {
    const dataEl = document.getElementById('lens-origin-data');
    if (!dataEl) return;
    if (dataEl.querySelector('.lens-orow')) return; // already has a result
    let pend = null; try { pend = sessionStorage.getItem('lens_origin_pending'); } catch (e) {}
    const me = (getXUsername() || '').toLowerCase();
    if (pend === me) return; // already in-flight
    try { sessionStorage.setItem('lens_origin_expand', me); } catch (e) {} // re-open section on return
    runOriginCheck(LENS_SELF_LOC);
  }

  function injectPanel() {
    const profile = extractProfileData();
    try { resolvePendingSmart(profile && profile.username, profile && profile.bio); } catch (e) {}
    const target = document.querySelector('[data-testid="UserDescription"]')
      || document.querySelector('[data-testid="userActions"]');
    if (!target) return;
    const panel = createPanel(profile);
    target.parentNode.insertBefore(panel, target.nextSibling);
    wireSectionToggles(panel);
    wireChips(panel);

    // Note: the row under the profile name is reserved for Smart Followers only.
    // Trust score lives inside the panel, so we no longer inject a name-badge row here.

    // Track CA bio history to flag previously-shown-then-deleted contract addresses.
    trackCaHistory(profile.username, profile.bio);

    // Contribute visible wallet tweets to the shared network archive (after tweets render).
    setTimeout(() => reportProfile(profile), 2500);

    // Mentioned Wallets archive — show what's already archived, then refresh after our own
    // report has had time to land so this visit's bio/tweet wallets show up too.
    if (profile.username) {
      fetchWalletHistory(profile.username);
      setTimeout(() => fetchWalletHistory(profile.username), 4500);
      fetchLinkedAccounts(profile.username);
      setTimeout(() => fetchLinkedAccounts(profile.username), 5000);
    }

    // Origin Check — lazy: runs when the user opens the Origin section (no auto-jump on load).
    LENS_SELF_LOC = profile.location || '';
    const me = (profile.username || '').toLowerCase();
    try {
      const raw = me ? sessionStorage.getItem('lens_origin:' + me) : null;
      if (raw) {
        const r = JSON.parse(raw);
        if (r && (Date.now() - r.ts) < 1800000) { // cached < 30 min → show it, no hop
          const dEl = document.getElementById('lens-origin-data');
          if (dEl) renderOrigin(dEl, r.about, (r.self != null ? r.self : profile.location), '');
          // if we just came back from an expand-triggered check, re-open the section
          let wantExpand = null; try { wantExpand = sessionStorage.getItem('lens_origin_expand'); } catch (e) {}
          if (wantExpand === me) {
            const sec = document.getElementById('lens-origin-section');
            if (sec && sec.classList.contains('collapsed')) toggleSection(sec);
            try { sessionStorage.removeItem('lens_origin_expand'); } catch (e) {}
          }
        }
      }
      sessionStorage.removeItem('lens_origin_pending');
      sessionStorage.removeItem('lens_origin_self');
    } catch (e) {}

    // AI Verdict (Aevon) — auto-generate once on-chain data is in, cached per profile.
    if (SETTINGS.ai_verdict !== false && me) {
      let shown = false;
      try {
        const vr = sessionStorage.getItem('lens_verdict:' + me);
        if (vr) { const v = JSON.parse(vr); if (v && (Date.now() - v.ts) < 1800000) { renderVerdict(v); shown = true; } }
      } catch (e) {}
      if (!shown) scheduleVerdict(me);
    }

    // Cabal Wallet — wire the on-demand cluster scan.
    wireCabalBtn();

    // Token Health — dev's current % of supply (auto, once token detected).
    scheduleTokenHealth();

    // Funding Trail — trace deployer funder + sibling wallets (serial-dev linking).
    scheduleFunding();

    // Smart Follower — show cached scan result; if we just returned from the list page, open it.
    setTimeout(() => {
      renderSmartFollowers();
      try {
        const me = (getXUsername() || '').toLowerCase();
        const want = sessionStorage.getItem('lens_smart_expand');
        if (want && want === me) {
          sessionStorage.removeItem('lens_smart_expand');
          const sec = document.getElementById('lens-smart-section');
          if (sec && sec.classList.contains('collapsed')) toggleSection(sec);
          document.querySelectorAll('.lens-chip').forEach(c => c.classList.remove('active'));
          const chip = document.querySelector('.lens-chip[data-target="lens-smart-section"]');
          if (chip) chip.classList.add('active');
        }
      } catch (e) {}
    }, 1200);
    // Smart Followers — independent (LENS backend). No Frontrun dependency.
    try { syncIndependentSmart(profile.username); } catch (e) {}
    // Cross-match the profile's "followers you follow" against the saved Smart List (independent of Frontrun).
    [1500, 3500, 6000].forEach(d => setTimeout(() => { try { renderMyListMatches(); } catch (e) {} }, d));

    // Username history (memory.lol via backend) — shows if handle ever changed
    if (profile.username) fetchUsernameHistory(profile.username);

    loadCustomLabels(profile.username);

    if (SETTINGS.src_github) {
      if (profile.github) fetchGitHub(profile.github, profile.github_source, false);
      else if (profile.username) fetchGitHub(profile.username, 'handle', true);
    }

    if (profile.addresses.length > 0) {
      // Try all addresses — works for both CA tokens AND wallet addresses
      fetchBankrData(profile.addresses, profile.username);
    } else {
      // No address found yet — tweets may not have loaded. Re-scan after a delay
      // before falling back to username-only lookup.
      let rescanned = false;
      const rescan = () => {
        if (rescanned) return;
        const more = harvestAddresses(document.querySelector('[data-testid="UserDescription"]')?.textContent || '');
        if (more.length > 0) {
          rescanned = true;
          fetchBankrData(more, profile.username);
        }
      };
      setTimeout(rescan, 1800);
      setTimeout(() => {
        if (rescanned) return;
        const more = harvestAddresses(document.querySelector('[data-testid="UserDescription"]')?.textContent || '');
        if (more.length > 0) { rescanned = true; fetchBankrData(more, profile.username); return; }
        // Still nothing — fall back to backend by username
        if (profile.username) {
          fetchByUsername(profile.username);
        } else {
          setEmpty('lens-bankr-loading', 'lens-bankr-data', 'No address or username found');
          setEmpty('lens-sold-loading', 'lens-sold-data', '—');
          updateStatus('complete');
        }
      }, 3800);
    }
  }

  let cabalCtx = null;
  let verdictState = { user: null, done: false };
  function fetchBankrData(addresses, username, opts) {
    opts = opts || {};
    // Check all addresses in parallel via full pipeline
    const checks = addresses.slice(0, 5).map(addr =>
      new Promise(resolve => {
        safeSendMessage({ type: 'FETCH_BANKR_FULL', tokenAddress: addr, settings: SETTINGS }, r => resolve({ addr, r }));
      })
    );

    Promise.all(checks).then(results => {
      const bankrTokens = results.filter(x => x.r?.success && x.r?.data?.is_bankr_token);
      // Also catch non-Bankrbot tokens where deployer was resolved OR fee structure exists (e.g. SINGIT, old tokens)
      const resolvedTokens = results.filter(x => x.r?.success && !x.r?.data?.is_bankr_token && (x.r?.data?.deployer_wallet || x.r?.data?.fee_structure));

      const primary = bankrTokens[0] || resolvedTokens[0];
      if (primary?.r?.data?.token_address) cabalCtx = { token: primary.r.data.token_address, deployer: primary.r.data.deployer_wallet || null };

      if (bankrTokens.length > 0) {
        renderResults(bankrTokens);
        if (opts.kickVerdict && username && !verdictState.done && SETTINGS.ai_verdict !== false) setTimeout(() => runVerdict(username), 3800);
      } else if (resolvedTokens.length > 0) {
        // Show dev activity for non-Bankrbot tokens with known deployer
        renderResults(resolvedTokens);
        if (opts.kickVerdict && username && !verdictState.done && SETTINGS.ai_verdict !== false) setTimeout(() => runVerdict(username), 3800);
      } else if (username && !opts.noUserFallback) {
        // Fallback to backend by username
        fetchByUsername(username);
      } else {
        setEmpty('lens-bankr-loading', 'lens-bankr-data', 'No Bankrbot activity found');
        setEmpty('lens-sold-loading', 'lens-sold-data', 'No tokens to monitor');
        updateStatus('complete');
      }
    });
  }

  function fetchByUsername(username) {
    window.__lensProfileUsername = username;
    safeSendMessage({ type: 'FETCH_LENS_PROFILE', username }, r => {
      if (r?.success && r?.data?.found) {
        renderFromBackend(r.data);
        return;
      }
      // Backend lookup empty — the dev may have JUST launched a token that the
      // backend hasn't indexed yet. Match the handle against the live Bankrbot
      // launches feed (same source as the Live Feed) and run any CA through the
      // normal pipeline so the panel stays consistent with the Live Feed.
      safeSendMessage({ type: 'FETCH_LAUNCH_BY_USERNAME', username }, lr => {
        const addrs = (lr && lr.success && lr.data && lr.data.addresses) || [];
        if (addrs.length) {
          fetchBankrData(addrs, username, { noUserFallback: true, kickVerdict: true });
        } else {
          setEmpty('lens-bankr-loading', 'lens-bankr-data', 'No Bankrbot activity found');
          setEmpty('lens-sold-loading', 'lens-sold-data', 'No tokens to monitor');
          updateStatus('complete');
        }
      });
    });
  }

  const fmtUsd = n => { n=parseFloat(n||0); return n===0?'$0':n<1000?`$${n.toFixed(2)}`:n<1e6?`$${(n/1000).toFixed(1)}K`:`$${(n/1e6).toFixed(2)}M`; };
  const timeAgo = (ts) => {
    if (!ts) return '';
    const t = new Date(ts).getTime();
    if (!t || isNaN(t)) return '';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s/60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m/60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h/24); if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d/30); if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo/12)}y ago`;
  };
  const fmtT = (n, sym) => { if(!n||n===0) return null; const f=n<1000?n.toFixed(4):n<1e6?`${(n/1000).toFixed(1)}K`:`${(n/1e6).toFixed(1)}M`; return sym?`${f} ${sym}`:f; };

  // Build a beneficiaries breakdown bar from the fee share.
  // Bankr/Doppler structure: Doppler protocol ~5%, fee recipient = share%,
  // remainder (if share < 95) = other beneficiaries. share is a string like "95.00%".
  function beneficiaryBar(shareStr, recipientLabel) {
    if (!shareStr) return '';
    const recipient = Math.max(0, Math.min(100, parseFloat(shareStr) || 0));
    if (!recipient) return '';
    const doppler = 5;
    const other = Math.max(0, 100 - recipient - doppler);
    const seg = (w, color) => w > 0 ? `<div style="width:${w}%;background:${color};height:100%"></div>` : '';
    const rLabel = recipientLabel || 'Recipient';
    return `<div style="margin-top:6px">
      <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:#0c1420">
        ${seg(recipient, '#4a72ff')}${seg(other, '#8a5cf0')}${seg(doppler, '#3a4a5a')}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;font-size:8px;color:#8899a6">
        <span><span style="color:#4a72ff">●</span> ${rLabel} ${recipient.toFixed(0)}%</span>
        ${other > 0 ? `<span><span style="color:#8a5cf0">●</span> Other ${other.toFixed(0)}%</span>` : ''}
        <span><span style="color:#3a4a5a">●</span> Doppler ${doppler}%</span>
      </div>
    </div>`;
  }

  // Compute a heuristic trust score (0-100) from on-chain signals already
  // gathered. This is NOT a guarantee of safety — just a summary of visible
  // signals. Green = clean, Yellow = caution, Red = risky.
  function computeTrustScore(bankrTokens) {
    let score = 80; // start optimistic-neutral
    const reasons = [];

    let anyDevSold = false, anyFeeClaimed = false, maxDeployed = 0, anyPleaseBro = false;
    bankrTokens.forEach(({ r }) => {
      const d = r.data || {};
      if (d.dev_sold?.sold) anyDevSold = true;
      if (d.dev_claim?.claimed || (d.creator_fees?.claim_count || 0) > 0 || d.fee_has_claimed === true || (d.fee_structure?.fee_has_claimed === true)) anyFeeClaimed = true;
      if (d.deployer_is_recipient === false) anyPleaseBro = true;
      const dep = d.fee_structure?.deployer_stats?.deployed_count || 0;
      if (dep > maxDeployed) maxDeployed = dep;
    });

    if (anyDevSold) { score -= 45; reasons.push('Dev sold tokens'); }
    if (anyFeeClaimed) { score -= 15; reasons.push('Fees claimed repeatedly'); }
    if (maxDeployed >= 10) { score -= 15; reasons.push(`Serial launcher (${maxDeployed} tokens)`); }
    else if (maxDeployed >= 5) { score -= 7; reasons.push(`Frequent launcher (${maxDeployed} tokens)`); }
    if (anyPleaseBro) { score += 5; reasons.push('Fees shared with a partner'); }
    if (!anyDevSold && !anyFeeClaimed) { score += 10; reasons.push('No dev sells or fee claims yet'); }

    score = Math.max(0, Math.min(100, score));
    let tier, color;
    if (score >= 70) { tier = 'Clean'; color = '#2ecc71'; }
    else if (score >= 40) { tier = 'Caution'; color = '#f0a020'; }
    else { tier = 'Risky'; color = '#e0413a'; }
    return { score, tier, color, reasons };
  }

  function renderResults(bankrTokens) {
    const bankrLoading = document.getElementById('lens-bankr-loading');
    const bankrData = document.getElementById('lens-bankr-data');
    const soldLoading = document.getElementById('lens-sold-loading');
    const soldData = document.getElementById('lens-sold-data');

    if (bankrLoading && bankrData) {
      bankrLoading.style.display = 'none';
      bankrData.style.display = 'block';

      addLabel('bankr', 'Bankrbot Dev');

      // Summary totals
      let totalClaimed = 0;
      let totalClaimable = 0;
      bankrTokens.forEach(({ r }) => {
        const d = r.data;
        if (d.creator_fees) {
          totalClaimed += parseFloat(d.creator_fees.total_claimed || d.creator_fees.claimed_usd || 0);
          totalClaimable += parseFloat(d.creator_fees.total_claimable || d.creator_fees.claimable_usd || 0);
        }
        if (d.dev_sold?.sold) addLabel('danger', 'Dev Sold');
        if (d.dev_claim?.claimed) addLabel('claimed', 'Fee Claimed');
        if (d.deployer_is_recipient === false) addLabel('pleasebro', 'PleaseBro');
      });

      if (totalClaimed > 0) addLabel('claimed', 'Fee Claimed (Bankrbot)');

      // Trust score badge (heuristic, see computeTrustScore)
      const trust = computeTrustScore(bankrTokens);

      // Record this scan for the popup dashboard (best-effort, non-blocking)
      try {
        const uname = getXUsername();
        const hasPB = bankrTokens.some(({ r }) => r.data?.deployer_is_recipient === false);
        if (uname && ctxValid()) {
          safeStorageGet(['LENS_STATS', 'LENS_RECENT'], (st) => {
            const stats = Object.assign({ scanned: 0, pleasebro: 0, devs: 0, trustSum: 0, trustCount: 0 }, st.LENS_STATS || {});
            let recent = Array.isArray(st.LENS_RECENT) ? st.LENS_RECENT : [];
            // Only count a username once
            if (!recent.find(x => x.username === uname)) {
              stats.scanned += 1;
              stats.devs += 1;
              if (hasPB) stats.pleasebro += 1;
              stats.trustSum += trust.score;
              stats.trustCount += 1;
            }
            recent = recent.filter(x => x.username !== uname);
            recent.unshift({ username: uname, tokens: bankrTokens.length, pleasebro: hasPB, trust: trust.score, ts: Date.now() });
            recent = recent.slice(0, 12);
            try { chrome.storage.local.set({ LENS_STATS: stats, LENS_RECENT: recent }); } catch (e) {}
          });
        }
      } catch (e) {}

      // Update the compact badge row under the profile name
      (() => {
        const nb = [];
        if (SETTINGS.show_pleasebro && bankrTokens.some(({ r }) => r.data?.deployer_is_recipient === false)) nb.push({ label: 'PleaseBro', color: '#2ecc71' });
        nb.push({ label: `Trust ${trust.score}`, color: trust.color });
        setNameBadges(nb);
      })();

      let html = '';
      html += `<div class="lens-trust" title="Heuristic score from on-chain signals — not a guarantee of safety. ${trust.reasons.join(' · ')}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:8px;background:${trust.color}1a;border:1px solid ${trust.color}55;border-radius:8px">
        <span style="font-size:16px;font-weight:800;color:${trust.color};font-family:monospace">${trust.score}</span>
        <span style="font-size:9px;color:${trust.color};font-weight:700;letter-spacing:.5px">/100</span>
        <span style="font-size:11px;font-weight:700;color:${trust.color}">${trust.tier}</span>
        <span style="font-size:8px;color:#8899a6;margin-left:auto">TRUST · heuristic</span>
      </div>`;
      if (totalClaimed > 0 || totalClaimable > 0) {
        html += `<div class="lens-bankr-summary">
          <div class="lens-bankr-stat"><span class="lens-stat-val lens-bankr-green">${bankrTokens.length}</span><span class="lens-stat-lbl">Found</span></div>
          <div class="lens-bankr-stat"><span class="lens-stat-val lens-warn">${fmtUsd(totalClaimed)}</span><span class="lens-stat-lbl">Claimed</span></div>
          <div class="lens-bankr-stat"><span class="lens-stat-val lens-bankr-teal">${fmtUsd(totalClaimable)}</span><span class="lens-stat-lbl">Claimable</span></div>
        </div>`;
      }

      html += '<div class="lens-bankr-tokens">';
      bankrTokens.forEach(({ r }) => {
        const d = r.data;
        const cf = d.creator_fees;
        const uf = d.unclaimed_fees;

        const claimedUsd = cf?.claimed_usd || 0;
        const claimableUsd = cf?.claimable_usd || 0;
        const claimedWeth = cf?.claimed_weth ? fmtT(parseFloat(cf.claimed_weth), 'WETH') : null;
        const claimableWeth = cf?.claimable_weth ? fmtT(parseFloat(cf.claimable_weth), 'WETH') : null;
        const claimCount = cf?.claim_count || 0;

        // Fallback to unclaimedFees if creator_fees empty
        const unclaimedToken = uf ? fmtT(uf.token_amount, uf.token_symbol) : null;
        const unclaimedWeth = uf?.weth_amount > 0 ? fmtT(uf.weth_amount, 'WETH') : null;

        const depWalletShort = d.deployer_wallet ? `${d.deployer_wallet.slice(0,6)}...${d.deployer_wallet.slice(-4)}` : null;
        const depUsername = d.deployer_x_username;
        const copyWallet = d.deployer_wallet ? `onclick="navigator.clipboard.writeText('${d.deployer_wallet}').then(()=>{this.textContent='✓ Copied!';setTimeout(()=>{this.textContent='${depWalletShort}';},1200)})" style="cursor:pointer" title="Click to copy address"` : '';

        html += `<div class="lens-bankr-token ${(claimedUsd>0||claimableUsd>0||unclaimedToken)?'has-fees':''}">
          <div class="lens-bankr-token-header" style="display:flex;align-items:center;gap:6px">
            <a href="https://bankr.bot/launches/${d.token_address}" target="_blank" style="color:inherit;text-decoration:none" title="View on Bankrbot">
              <span class="lens-bankr-token-symbol">${d.token_symbol||'???'} ↗</span>
            </a>
            <span class="lens-bankr-token-name">${d.token_name||'Unknown'}</span>
            ${d.token_supply ? `<span style="font-size:9px;color:#3a4a5a;margin-left:auto;font-family:monospace">Supply: ${d.token_supply}</span>` : ''}
          </div>
          <div class="lens-rows" style="display:flex;flex-direction:column;gap:7px;margin-top:8px">
          ${(() => {
            const ds = d.fee_structure?.deployer_stats;
            const depX = depUsername || ds?.x_username;
            const depCount = ds?.deployed_count || 0;
            if (!depX && !depWalletShort) return '';
            const nameHtml = depX ? `<a href="https://x.com/${depX}" target="_blank" style="color:#4a72ff;text-decoration:none;font-weight:600">@${depX}</a>` : '';
            const walletHtml = depWalletShort ? `<span ${copyWallet} style="color:#c0d4e8;font-family:monospace">${depWalletShort}</span>` : '';
            const countHtml = depCount > 0 ? `<span style="font-size:10px;color:#f0a020;margin-left:6px">· ${depCount} launched</span>` : '';
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
              <span style="font-size:11px;color:#8899a6">Deployer</span>
              <span style="font-size:11px;text-align:right">${nameHtml}${nameHtml&&walletHtml?' ':''}${walletHtml}${countHtml}</span>
            </div>`;
          })()}
          ${d.fee_structure?.fee_recipient_wallet && (d.deployer_is_recipient===false || (d.deployer_is_recipient===null && (!d.deployer_wallet || d.fee_structure.fee_recipient_wallet.toLowerCase()!==d.deployer_wallet.toLowerCase()))) ? (() => {
            const fs = d.fee_structure.fee_recipient_stats;
            const frX = d.fee_structure.fee_recipient_x || fs?.x_username;
            const frName = frX ? `<a href="https://x.com/${frX}" target="_blank" style="color:#4a72ff;text-decoration:none;font-weight:600">@${frX}</a>` : `<span style="font-family:monospace;color:#c0d4e8">${d.fee_structure.fee_recipient_wallet.slice(0,6)}…${d.fee_structure.fee_recipient_wallet.slice(-4)}</span>`;
            const frDeployed = fs?.deployed_count || 0;
            const frFlag = frDeployed > 0 ? `<span style="font-size:10px;color:#f0a020;margin-left:6px">· also dev ${frDeployed}</span>` : '';
            const confirmed = d.deployer_is_recipient===false;
            const lblC = confirmed ? '#2ecc71' : '#8899a6';
            const lbl = confirmed ? 'Fee Recipient' : 'Fee Recipient';
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
              <span style="font-size:11px;color:${lblC}">${lbl}</span>
              <span style="font-size:11px;text-align:right">${frName}${frFlag}</span>
            </div>`;
          })() : ''}
            ${d.fee_structure?.share ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:11px;color:#8899a6">Fee Share</span><span style="font-size:11px;color:#4a72ff;font-weight:700;font-family:monospace">${d.fee_structure.share}</span></div>` : ''}
            ${d.fee_structure?.lifetime_weth && parseFloat(d.fee_structure.lifetime_weth)>0 ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:11px;color:#8899a6">Lifetime</span><span style="font-size:11px;color:#5DCAA5;font-family:monospace">${parseFloat(d.fee_structure.lifetime_weth).toFixed(4)} WETH</span></div>` : ''}
            ${claimedUsd > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:11px;color:#ff8c00;font-weight:700">Claimed</span><span style="font-size:11px;color:#f0a020;font-family:monospace;text-align:right">${fmtUsd(claimedUsd)}${claimedWeth?` · ${claimedWeth}`:''} · ${claimCount}x</span></div>` : ''}
            ${claimableUsd > 0 || claimableWeth ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:11px;color:#00d4ff">Claimable</span><span style="font-size:11px;color:#5DCAA5;font-family:monospace;text-align:right">${fmtUsd(claimableUsd)}${claimableWeth?` · ${claimableWeth}`:''}</span></div>` : ''}
            ${(() => {
              if (claimableUsd || claimableWeth) return '';
              const cw = parseFloat(d.fee_structure?.claimable_weth || 0);
              if (!(cw > 0)) return '';
              const lw = parseFloat(d.fee_structure?.lifetime_weth || 0);
              // Claimable can't exceed lifetime fees — if it does, backend value is mis-scaled/bogus, so skip it.
              if (lw > 0 && cw > lw * 1.05) return '';
              return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:11px;color:#00d4ff">Claimable</span><span style="font-size:11px;color:#5DCAA5;font-family:monospace">${cw.toFixed(4)} WETH</span></div>`;
            })()}
            ${unclaimedToken || unclaimedWeth ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:11px;color:#00d4ff">Unclaimed</span><span style="font-size:11px;color:#5DCAA5;font-family:monospace;text-align:right">${[unclaimedToken,unclaimedWeth].filter(Boolean).join(' · ')}</span></div>` : ''}
            ${!claimedUsd && !claimableUsd && !unclaimedToken && !unclaimedWeth && !d.fee_structure?.share ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:11px;color:#8899a6">Fees</span><span style="font-size:11px;color:#3a4a5a">Accruing in pool</span></div>` : ''}
          </div>
          ${d.fee_structure?.share ? beneficiaryBar(d.fee_structure.share, d.fee_structure.fee_recipient_x ? '@'+d.fee_structure.fee_recipient_x : 'Recipient') : ''}
        </div>`;
      });
      html += '</div>';
      bankrData.innerHTML = html;
    }

    // Dev Activity section
    if (soldLoading && soldData) {
      soldLoading.style.display = 'none';
      soldData.style.display = 'block';

      const sells = bankrTokens.filter(({ r }) => r.data?.dev_sold?.sold);
      const hasClaimed = bankrTokens.some(({ r }) => (r.data?.creator_fees?.claim_count || 0) > 0);
      // Scan ALL tokens (Bankrbot + resolved) for on-chain claim
      const hasOnChainClaim = bankrTokens.some(({ r }) => r.data?.dev_claim?.claimed);
      const onChainClaimTokens = bankrTokens.filter(({ r }) => r.data?.dev_claim?.claimed);

      let html = '';

      // Bankrbot fee claimed (from creator_fees API)
      if (hasClaimed && SETTINGS.show_claim) {
        const totalClaimedEth = bankrTokens.reduce((s, { r }) => {
          return s + parseFloat(r.data?.creator_fees?.claimed_weth || 0);
        }, 0);
        html += `<div class="lens-activity-alert lens-alert-claim">
          <span class="lens-alert-icon"></span>
          <div class="lens-alert-content">
            <div class="lens-alert-title">FEE CLAIMED (Bankrbot)</div>
            <div class="lens-alert-sub">${totalClaimedEth.toFixed(4)} WETH total claimed</div>
          </div>
        </div>`;
      }

      // On-chain ETH claim (Alchemy internal transfers to deployer)
      if (hasOnChainClaim && SETTINGS.show_claim) {
        onChainClaimTokens.forEach(({ r }) => {
          const dc = r.data?.dev_claim;
          if (!dc?.claimed) return;
          html += `<div class="lens-activity-alert lens-alert-claim">
            <span class="lens-alert-icon"></span>
            <div class="lens-alert-content">
              <div class="lens-alert-title">DEV CLAIMED ON-CHAIN</div>
              <div class="lens-alert-sub">${dc.total_eth} ETH · ${dc.claim_count}x claims · Last: ${dc.last_claim}</div>
            </div>
          </div>`;
        });
      }

      if (sells.length > 0 && SETTINGS.show_dev_sold) {
        html += `<div class="lens-activity-alert lens-alert-sold">
          <span class="lens-alert-icon"></span>
          <div class="lens-alert-content">
            <div class="lens-alert-title">DEV SOLD on ${sells.length} token${sells.length>1?'s':''}</div>
            ${sells.map(({ r }) => {
              const s = r.data.dev_sold;
              return `<div class="lens-alert-sub">${r.data.token_symbol}: ${s.total_sold} · ${s.sell_count}x sells to DEX · Last: ${s.last_sell}</div>`;
            }).join('')}
          </div>
        </div>`;
      }

      if (!hasClaimed && !hasOnChainClaim && !sells.length) {
        html = `<div class="lens-sold-clean"><span class="lens-sold-clean-icon">✓</span><span>No suspicious activity detected</span></div>`;
      }

      soldData.innerHTML = html;
    }

    updateStatus('complete');
  }

  // Trust score from backend profile data (0-100 + tier + color)
  function trustFromBackend(d) {
    let score = 80;
    const reasons = [];
    if (d.has_sold) { score -= 45; reasons.push('Dev sold tokens'); }
    if (d.has_claimed) { score -= 12; reasons.push('Fees claimed'); }
    if (d.token_count >= 10) { score -= 15; reasons.push(`Serial launcher (${d.token_count})`); }
    else if (d.token_count >= 5) { score -= 7; reasons.push(`Frequent launcher (${d.token_count})`); }
    const top1 = d.holder_stats?.max_top1_pct || 0;
    if (top1 >= 50) { score -= 20; reasons.push(`Whale holds ${top1}%`); }
    else if (top1 >= 25) { score -= 10; reasons.push(`Top holder ${top1}%`); }
    if (d.has_please_bro) { score += 5; reasons.push('Shares fees with partner'); }
    if (!d.has_sold && !d.has_claimed) { score += 10; reasons.push('No sells or claims yet'); }
    score = Math.max(0, Math.min(100, score));
    let tier, color;
    if (score >= 70) { tier = 'Clean'; color = '#2ecc71'; }
    else if (score >= 40) { tier = 'Caution'; color = '#f0a020'; }
    else { tier = 'Risky'; color = '#e0413a'; }
    return { score, tier, color, reasons };
  }

  function renderFromBackend(d) {
    const bankrLoading = document.getElementById('lens-bankr-loading');
    const bankrData = document.getElementById('lens-bankr-data');
    if (bankrLoading && bankrData) {
      bankrLoading.style.display = 'none';
      bankrData.style.display = 'block';
      if (d.token_count > 0) addLabel('bankr', 'Bankrbot Dev');
      if (d.has_please_bro) addLabel('pleasebro', 'PleaseBro');
      if (d.has_new_token) addLabel('new-launch', 'New Launch');
      if (d.has_claimed) addLabel('claimed', 'Fee Claimed');

      // ── Frontrun Badge: active dev with a fresh launch (<24h) — get in early ──
      if (d.has_new_token && d.token_count > 0) {
        addLabel('frontrun', 'Frontrun');
      }

      // ── AI Wallet Tags: auto-derived behavioural labels ──
      // Serial Launcher — many tokens
      if (d.token_count >= 5) addLabel('ai-serial', 'Serial Launcher');
      // Paper Hands — deployer has sold
      if (d.has_sold) addLabel('ai-paper', 'Paper Hands');
      // Diamond Hands — has tokens, no sell detected
      else if (d.token_count > 0 && !d.has_sold) addLabel('ai-diamond', 'Diamond Hands');
      // Fee Hunter — actively claims fees
      if (d.has_claimed) addLabel('ai-feehunter', 'Fee Hunter');
      // Whale Backed — a holder controls a large share of a token
      if (d.holder_stats?.max_top1_pct >= 25) addLabel('ai-whale', 'Whale Backed');
      // Fresh Dev — newest launch within 7 days and few tokens
      try {
        const newest = (d.tokens || [])
          .map(t => t.launched_at ? new Date(t.launched_at).getTime() : 0)
          .reduce((m, v) => Math.max(m, v), 0);
        if (newest && (Date.now() - newest) < 7 * 86400000 && d.token_count <= 2) {
          addLabel('ai-fresh', 'Fresh Dev');
        }
      } catch (e) {}

      let html = '';

      // ── Trust Score: headline judgment for this dev ──
      if (d.token_count > 0 || d.has_please_bro) {
        const ts = trustFromBackend(d);
        const pct = ts.score;
        html += `<div class="lens-trust" style="--ts-color:${ts.color}">
          <div class="lens-trust-ring" style="background:conic-gradient(${ts.color} ${pct*3.6}deg, #16202c 0deg)">
            <div class="lens-trust-inner"><span class="lens-trust-num" style="color:${ts.color}">${pct}</span></div>
          </div>
          <div class="lens-trust-body">
            <div class="lens-trust-tier" style="color:${ts.color}">${ts.tier}</div>
            <div class="lens-trust-reason">${ts.reasons[0] || 'Based on on-chain behaviour'}</div>
          </div>
        </div>`;
      }

      // Own tokens section
      if (d.token_count > 0) {
        html += `<div class="lens-bankr-summary">
          <div class="lens-bankr-stat"><span class="lens-stat-val lens-bankr-green">${d.token_count}</span><span class="lens-stat-lbl">Launched</span></div>
          <div class="lens-bankr-stat"><span class="lens-stat-val lens-warn">${d.claims?.total_eth_claimed||'0'} ETH</span><span class="lens-stat-lbl">Claimed</span></div>
          <div class="lens-bankr-stat"><span class="lens-stat-val lens-bankr-teal">${fmtUsd(d.unclaimed_usd_total)}</span><span class="lens-stat-lbl">Unclaimed</span></div>
        </div>`;

        // Dev Wallet card — click address to open BaseScan, copy button to copy
        const devWallet = (d.tokens || []).map(t => t.deployer_wallet).find(Boolean);
        if (devWallet) {
          const short = `${devWallet.slice(0,6)}…${devWallet.slice(-4)}`;
          html += `<div class="lens-devwallet">
            <span class="lens-devwallet-lbl">DEV WALLET</span>
            <a class="lens-devwallet-addr" href="https://basescan.org/address/${devWallet}" target="_blank" rel="noopener" title="View on BaseScan">${short}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style="margin-left:3px;vertical-align:-1px"><path d="M7 17L17 7M17 7H9M17 7v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </a>
            <button class="lens-devwallet-copy" data-lens-copy="${devWallet}" title="Copy address">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>`;
        }

        html += `<div class="lens-bankr-tokens">`;

        d.tokens?.forEach(t => {
          const ct = fmtT(parseFloat(t.unclaimed_token||0), t.token_symbol_fees);
          const cw = parseFloat(t.unclaimed_weth||0)>0 ? fmtT(parseFloat(t.unclaimed_weth),'WETH') : null;
          html += `<div class="lens-bankr-token ${(ct||cw)?'has-fees':''}">
            <div class="lens-bankr-token-header">
              <a href="https://bankr.bot/launches/${t.token_address}" target="_blank" style="color:inherit;text-decoration:none" title="View on Bankrbot">
                <span class="lens-bankr-token-symbol">${t.token_symbol||'???'} ↗</span>
              </a>
              <span class="lens-bankr-token-name">${t.token_name||'Unknown'}</span>
              ${t.is_new?'<span class="lens-new-badge">NEW</span>':''}
            </div>
            <div class="lens-bankr-fees-grid">
              ${ct||cw?`<div class="lens-fee-row"><span class="lens-fee-lbl">Unclaimed</span><span class="lens-fee-val lens-bankr-teal">${[ct,cw].filter(Boolean).join(' · ')}</span></div>`
              :`<div class="lens-fee-row"><span class="lens-fee-lbl">Fees</span><span class="lens-fee-val" style="color:#3a4a5a">Accruing</span></div>`}
              ${t.fee_share?`<div class="lens-fee-row"><span class="lens-fee-lbl">Fee Share</span><span class="lens-fee-val" style="color:#4a72ff">${t.fee_share}</span></div>`:''}
              ${t.launched_at?`<div class="lens-fee-row"><span class="lens-fee-lbl">Launched</span><span class="lens-fee-val" style="color:#6a8899">${timeAgo(t.launched_at)}</span></div>`:''}
              ${t.deployer_is_recipient===false?`<div class="lens-fee-row"><span class="lens-fee-lbl">Fee → </span><span class="lens-fee-val" style="color:#f0a020">${t.x_username_fee?'@'+t.x_username_fee:(t.fee_recipient_wallet?t.fee_recipient_wallet.slice(0,6)+'…'+t.fee_recipient_wallet.slice(-4):'?')}</span></div>`:''}
            </div>
            <div class="lens-token-links">
              <a href="https://dexscreener.com/base/${t.token_address}" target="_blank" rel="noopener" title="DexScreener">DexScreener</a>
              <a href="https://basescan.org/token/${t.token_address}" target="_blank" rel="noopener" title="BaseScan">BaseScan</a>
              <a href="https://bankr.bot/launches/${t.token_address}" target="_blank" rel="noopener" title="Bankrbot">Bankr</a>
              <button class="lens-token-copy" data-lens-copy="${t.token_address}" title="Copy CA">Copy CA</button>
            </div>
          </div>`;
        });
        html += '</div>';
      }

      // PleaBro section — tokens where user is fee recipient
      if (d.has_please_bro && d.please_bro_tokens?.length > 0) {
        html += `<div style="margin-top:8px;padding:6px 8px;background:rgba(100,200,100,0.06);border-radius:6px;border:1px solid rgba(100,200,100,0.15)">
          <div style="font-size:9px;color:#2ecc71;font-weight:700;letter-spacing:1px;margin-bottom:6px">PLEASEBRO — RECEIVING FEES FROM ${d.please_bro_count} TOKEN${d.please_bro_count>1?'S':''}</div>`;
        d.please_bro_tokens.forEach(t => {
          const ct = fmtT(parseFloat(t.unclaimed_token||0), t.token_symbol);
          const cw = parseFloat(t.unclaimed_weth||0)>0 ? fmtT(parseFloat(t.unclaimed_weth),'WETH') : null;
          const deployer = t.x_username ? `@${t.x_username}` : t.deployer_wallet ? `${t.deployer_wallet.slice(0,6)}...${t.deployer_wallet.slice(-4)}` : '?';
          html += `<div class="lens-bankr-token" style="margin-bottom:4px">
            <div class="lens-bankr-token-header">
              <a href="https://bankr.bot/launches/${t.token_address}" target="_blank" style="color:inherit;text-decoration:none" title="View on Bankrbot">
                <span class="lens-bankr-token-symbol">${t.token_symbol||'???'} ↗</span>
              </a>
              <span class="lens-bankr-token-name">${t.token_name||'Unknown'}</span>
              <span style="font-size:9px;color:#3a4a5a;margin-left:auto">by ${deployer}</span>
            </div>
            <div class="lens-bankr-fees-grid">
              ${t.fee_share?`<div class="lens-fee-row"><span class="lens-fee-lbl" style="color:#2ecc71">Share</span><span class="lens-fee-val" style="color:#4a72ff;font-weight:700">${t.fee_share}</span></div>`:''}
              ${ct||cw?`<div class="lens-fee-row"><span class="lens-fee-lbl" style="color:#2ecc71">Unclaimed</span><span class="lens-fee-val lens-bankr-teal">${[ct,cw].filter(Boolean).join(' · ')}</span></div>`
              :`<div class="lens-fee-row"><span class="lens-fee-lbl">Fees</span><span class="lens-fee-val" style="color:#3a4a5a">Accruing</span></div>`}
            </div>
          </div>`;
        });
        html += '</div>';
      }

      // Holders on X — holders of this dev's tokens that have a known X account
      if (d.has_holders_on_x && d.holders_on_x?.length > 0) {
        html += `<div style="margin-top:8px;padding:6px 8px;background:rgba(74,114,255,0.06);border-radius:6px;border:1px solid rgba(74,114,255,0.15)">
          <div style="font-size:9px;color:#4a72ff;font-weight:700;letter-spacing:1px;margin-bottom:6px">HOLDERS ON X — ${d.holders_on_x_count} KNOWN</div>`;
        d.holders_on_x.forEach(h => {
          const bal = parseFloat(h.balance || 0);
          const fmtBal = bal >= 1e6 ? `${(bal/1e6).toFixed(1)}M` : bal >= 1000 ? `${(bal/1000).toFixed(1)}K` : bal.toFixed(0);
          html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0">
            <a href="https://x.com/${h.x_username}" target="_blank" style="color:#4a72ff;text-decoration:none;font-size:11px;font-weight:600">@${h.x_username}</a>
            <span style="font-size:10px;color:#8899a6;font-family:monospace">${fmtBal} ${h.token_symbol||''}</span>
          </div>`;
        });
        html += '</div>';
      }

      // Holder Stats — concentration analytics per token
      if (d.holder_stats?.available && d.holder_stats.tokens?.length > 0) {
        const risk = d.holder_stats.concentration_risk || 'low';
        const riskColor = risk === 'high' ? '#e06a6a' : risk === 'medium' ? '#d8a05a' : '#2ecc71';
        const riskLabel = risk === 'high' ? 'HIGH CONCENTRATION' : risk === 'medium' ? 'MODERATE' : 'WELL DISTRIBUTED';
        html += `<div style="margin-top:8px;padding:8px 10px;background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid #16202c">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:9px;color:#7d96ab;font-weight:700;letter-spacing:1px">HOLDER STATS</span>
            <span style="font-size:8px;color:${riskColor};font-weight:700;letter-spacing:0.5px;padding:2px 6px;border-radius:4px;background:${riskColor}1a;border:1px solid ${riskColor}33">${riskLabel}</span>
          </div>`;
        d.holder_stats.tokens.forEach(t => {
          const bar1 = Math.min(100, t.top1_pct);
          const bar10 = Math.min(100, t.top10_pct);
          html += `<div style="margin-bottom:9px">
            <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:4px">
              <span style="color:#d8a05a;font-weight:700">${t.token_symbol||'???'}</span>
              <span style="color:#5a6b7a;font-family:monospace">${t.holder_count}${t.capped?'+':''} holders</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
              <span style="font-size:8px;color:#4a5b6a;min-width:42px">Top 1</span>
              <div style="flex:1;height:5px;background:#0d1520;border-radius:3px;overflow:hidden"><div style="width:${bar1}%;height:100%;background:${t.top1_pct>=25?'#e06a6a':'#4a72ff'}"></div></div>
              <span style="font-size:9px;color:#8899a6;font-family:monospace;min-width:34px;text-align:right">${t.top1_pct}%</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:8px;color:#4a5b6a;min-width:42px">Top 10</span>
              <div style="flex:1;height:5px;background:#0d1520;border-radius:3px;overflow:hidden"><div style="width:${bar10}%;height:100%;background:${t.top10_pct>=70?'#d8a05a':'#4a72ff'}"></div></div>
              <span style="font-size:9px;color:#8899a6;font-family:monospace;min-width:34px;text-align:right">${t.top10_pct}%</span>
            </div>
          </div>`;
        });
        html += `<div style="font-size:8px;color:#3a4a5a;font-family:monospace;text-align:center;margin-top:2px">Based on top-100 tracked holders per token</div></div>`;
      }

      // Share to X — generate a shareable summary card
      if (d.token_count > 0 || d.has_please_bro) {
        const handle = (window.__lensProfileUsername || '').replace(/^@/, '');
        // collect up to 3 token tickers (own tokens first, then pleasebro)
        const tickerArr = [
          ...(d.tokens || []).map(t => t.token_symbol),
          ...(d.please_bro_tokens || []).map(t => t.token_symbol),
        ].filter(Boolean);
        const tickers = [...new Set(tickerArr)].slice(0, 3).join(',');
        const devW = (d.tokens || []).map(t => t.deployer_wallet).find(Boolean) || '';
        html += `<div class="lens-action-row">
          <button class="lens-share-btn" data-lens-share="1"
            data-username="${handle}"
            data-tokens="${d.token_count||0}"
            data-pleasebro="${d.please_bro_count||0}"
            data-claimed="${d.claims?.total_eth_claimed||'0'}"
            data-tickers="${tickers}"
            data-risk="${d.holder_stats?.concentration_risk||''}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 1.2h3.7l-8 9.1 9.4 12.5h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.2h7.6l5.2 6.9 6.1-6.9zm-1.3 19.4h2L6.5 3.3H4.3l13.3 17.3z"/></svg>
            Share on X
          </button>
          <button class="lens-watch-btn" data-lens-watch="1"
            data-username="${handle}"
            data-wallet="${devW}"
            data-tokens="${d.token_count||0}"
            title="Add to watchlist">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 17.3l-5.4 3.2 1.4-6.1L3 9.9l6.2-.5L12 3.5l2.8 5.9 6.2.5-5 4.5 1.4 6.1z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
            <span class="lens-watch-txt">Watch</span>
          </button>
        </div>`;
      }

      if (!html) html = '<div class="lens-empty">No Bankrbot activity found</div>';
      bankrData.innerHTML = html;
    }

    const soldLoading = document.getElementById('lens-sold-loading');
    const soldData = document.getElementById('lens-sold-data');
    if (soldLoading && soldData) {
      soldLoading.style.display = 'none';
      soldData.style.display = 'block';
      let html = '';
      if (d.claims?.has_claimed) html += `<div class="lens-activity-alert lens-alert-claim"><span class="lens-alert-icon"></span><div class="lens-alert-content"><div class="lens-alert-title">FEE CLAIMED</div><div class="lens-alert-sub">${d.claims.total_eth_claimed} ETH</div></div></div>`;
      if (d.sells?.has_sold) {
        addLabel('danger', 'Dev Sold');
        html += `<div class="lens-activity-alert lens-alert-sold"><span class="lens-alert-icon"></span><div class="lens-alert-content"><div class="lens-alert-title">DEV SOLD</div>${d.sells.items?.map(s=>`<div class="lens-alert-sub">${s.token_symbol}: ${s.total_sold} · ${s.sell_count}x</div>`).join('')}</div></div>`;
      }
      if (!html) html = `<div class="lens-sold-clean"><span class="lens-sold-clean-icon">✓</span><span>No suspicious activity</span></div>`;
      soldData.innerHTML = html;
    }
    updateStatus('complete');
  }

  function addLabel(cls, text) {
    // Respect user label-visibility settings (Settings > Labels).
    if (cls === 'pleasebro' && !SETTINGS.show_pleasebro) return;
    if (cls === 'claimed' && !SETTINGS.show_claim) return;
    if (cls === 'danger' && /dev sold/i.test(text) && !SETTINGS.show_dev_sold) return;
    if ((cls === 'new-launch' || cls === 'new-token') && !SETTINGS.show_new_token) return;
    const row = document.getElementById('lens-labels');
    if (row && !document.querySelector(`.lens-label.${cls}`)) {
      const lbl = document.createElement('span');
      lbl.className = `lens-label ${cls}`;
      lbl.textContent = text;
      row.appendChild(lbl);
    }
  }

  function addCustomLabel(text, username) {
    const row = document.getElementById('lens-labels');
    if (!row) return;
    const cls = `custom-${text.replace(/\s+/g,'-').toLowerCase()}`;
    if (document.querySelector(`.lens-label.${cls}`)) return;
    const lbl = document.createElement('span');
    lbl.className = `lens-label custom`;
    lbl.textContent = text;
    lbl.title = 'Click to remove';
    lbl.style.cursor = 'pointer';
    lbl.onclick = () => {
      lbl.remove();
      const key = `CUSTOM_LABELS_${username}`;
      chrome.storage.local.get([key], r => {
        const labels = (r[key] || []).filter(l => l !== text);
        chrome.storage.local.set({ [key]: labels });
      });
    };
    row.appendChild(lbl);
  }

  // Fetch screen-name history (memory.lol via backend) and render if changed
  function fetchUsernameHistory(username) {
    safeSendMessage({ type: 'FETCH_USERNAME_HISTORY', username }, (resp) => {
      const el = document.getElementById('lens-uname-history');
      if (!el) return;
      const h = resp && resp.success ? resp.data : null;
      if (!h || !h.found) return; // no record → stay hidden

      const prev = (h.previous || []).filter(p => p.name);
      const current = h.current || username;

      if (!prev.length) {
        // Has record but no other names — known single handle
        el.style.display = 'block';
        el.innerHTML = `<div class="lens-uname">
          <div class="lens-uname-row">
            <span class="lens-uname-lbl">Username</span>
            <span class="lens-uname-val"><span class="lens-uname-ok">No handle changes</span></span>
          </div>
        </div>`;
        return;
      }

      // Build chain: @oldest → … → current
      const ordered = [...prev].reverse(); // memory.lol previous is recent-first
      const chain = [...ordered.map(p => '@' + p.name), 'current'];
      const chainHtml = chain.map((name, i) => {
        const isCurrent = name === 'current';
        const cls = isCurrent ? 'lens-uname-cur' : 'lens-uname-old';
        const sep = i < chain.length - 1 ? '<span class="lens-uname-arrow">→</span>' : '';
        return `<span class="${cls}">${name}</span>${sep}`;
      }).join('');

      el.style.display = 'block';
      el.innerHTML = `<div class="lens-uname">
        <div class="lens-uname-row">
          <span class="lens-uname-lbl">Username History</span>
          <span class="lens-uname-count">${prev.length} change${prev.length > 1 ? 's' : ''}</span>
        </div>
        <div class="lens-uname-chain">${chainHtml}</div>
        <div class="lens-uname-note">Archive snapshots · memory.lol</div>
      </div>`;
    });
  }

  function loadCustomLabels(username) {
    if (!username) return;
    const key = `CUSTOM_LABELS_${username}`;
    safeStorageGet([key], r => {
      (r[key] || []).forEach(l => addCustomLabel(l, username));
    });
    // Wire + Label button
    const btn = document.querySelector('.lens-add-label');
    if (btn) {
      btn.onclick = () => {
        const existing = document.getElementById('lens-label-input');
        if (existing) { existing.focus(); return; }
        const input = document.createElement('input');
        input.id = 'lens-label-input';
        input.placeholder = 'Label name...';
        input.style.cssText = 'background:#060c14;border:1px solid #4a72ff;color:#c0d4e8;padding:2px 6px;border-radius:4px;font-size:10px;font-family:monospace;outline:none;width:90px';
        btn.parentNode.insertBefore(input, btn.nextSibling);
        input.focus();
        const save = () => {
          const val = input.value.trim();
          input.remove();
          if (!val) return;
          addCustomLabel(val, username);
          const key = `CUSTOM_LABELS_${username}`;
          safeStorageGet([key], r => {
            const labels = [...new Set([...(r[key] || []), val])];
            if (ctxValid()) { try { chrome.storage.local.set({ [key]: labels }); } catch (e) {} }
          });
        };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') input.remove(); });
        input.addEventListener('blur', () => setTimeout(() => input.isConnected && input.remove(), 150));
      };
    }
  }

  function setEmpty(lid, did, msg) {
    const l = document.getElementById(lid);
    const d = document.getElementById(did);
    if (l && d) { l.style.display='none'; d.style.display='block'; d.innerHTML=`<div class="lens-empty">${msg}</div>`; }
  }

  function createPanel(profile) {
    const panel = document.createElement('div');
    panel.id = 'lens-panel';
    if (SETTINGS.compact_mode) panel.classList.add('lens-compact');
    panel.innerHTML = `
      <div class="lens-topbar">
        <span class="lens-brand">LENS</span>
        <span class="lens-status" id="lens-status"><span class="lens-status-dot"></span>SCANNING</span>
      </div>
      <div class="lens-labels-row" id="lens-labels">
        <button class="lens-add-label">+ Label</button>
        <span class="lens-label kol">KOL</span>
      </div>
      <div id="lens-ca-history" style="display:none"></div>
      <div class="lens-data-row">
        <div class="lens-pill-group"><span class="lens-data-label">@</span><span class="lens-pill">${profile.username||'?'}</span></div>
        <div class="lens-pill-group"><span class="lens-data-label">Addresses</span><span class="lens-pill">${profile.addresses.length} found</span></div>
      </div>
      <div id="lens-uname-history" style="display:none;margin:0 0 8px"></div>
      <div class="lens-section" id="lens-verdict-section">
        <div class="lens-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="lens-section-title">AI Verdict <span class="lens-ai-badge">AI</span></span>
          <span class="lens-section-arrow"></span>
        </div>
        <div class="lens-section-body">
          <div id="lens-verdict-data">
            <div class="lens-loading" id="lens-verdict-init"><div class="lens-spinner"></div>Waiting for on-chain data…</div>
          </div>
        </div>
      </div>
      <div class="lens-section" id="lens-bankr-section">
        <div class="lens-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="lens-section-title">Bankrbot Tokens <span class="lens-bankr-badge">BANKR.BOT</span></span>
          <span class="lens-section-arrow"></span>
        </div>
        <div class="lens-section-body">
          <div class="lens-loading" id="lens-bankr-loading"><div class="lens-spinner"></div>Auto-detecting via CA...</div>
          <div id="lens-bankr-data" style="display:none;"></div>
        </div>
      </div>
      <div class="lens-section" id="lens-devact-section">
        <div class="lens-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="lens-section-title">Dev Activity <span class="lens-sold-badge">MONITOR</span></span>
          <span class="lens-section-arrow"></span>
        </div>
        <div class="lens-section-body">
          <div class="lens-loading" id="lens-sold-loading"><div class="lens-spinner"></div>Checking activity...</div>
          <div id="lens-sold-data" style="display:none;"></div>
        </div>
      </div>
      <div class="lens-chips" id="lens-chips">
        <button class="lens-chip" data-target="lens-health-section">Supply</button>
        <button class="lens-chip" data-target="lens-origin-section">Origin</button>
        <button class="lens-chip" data-target="lens-funding-section">Funding</button>
        <button class="lens-chip" data-target="lens-linked-section">Linked</button>
        <button class="lens-chip" data-target="lens-cabal-section">Bundled</button>
        <button class="lens-chip" data-target="lens-mentioned-section">Wallets</button>
        <button class="lens-chip" data-target="lens-smart-section">Followers</button>
        ${(profile.github || profile.username) ? '<button class="lens-chip" data-target="lens-github-section">GitHub</button>' : ''}
      </div>
      <div class="lens-section collapsed lens-chipped" id="lens-health-section">
        <div class="lens-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="lens-section-title">Token Health <span class="lens-health-badge">ON-CHAIN</span></span>
          <span class="lens-section-arrow"></span>
        </div>
        <div class="lens-section-body">
          <div id="lens-health-data">
            <div class="lens-origin-hint">How much of the token supply the dev still holds. High = dump risk.</div>
          </div>
        </div>
      </div>
      <div class="lens-section collapsed lens-chipped" id="lens-origin-section">
        <div class="lens-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="lens-section-title">Origin Check <span class="lens-origin-badge">VPN / GEO</span></span>
          <span class="lens-section-arrow"></span>
        </div>
        <div class="lens-section-body">
          <div id="lens-origin-data">
            <div class="lens-origin-hint">Checks X's "Account based in" country vs the profile's stated location. Runs when you open this section.</div>
          </div>
        </div>
      </div>
      <div class="lens-section collapsed lens-chipped" id="lens-mentioned-section">
        <div class="lens-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="lens-section-title">Mentioned Wallets <span class="lens-arch-badge">ARCHIVE</span></span>
          <span class="lens-section-arrow"></span>
        </div>
        <div class="lens-section-body">
          <div class="lens-loading" id="lens-wallets-loading"><div class="lens-spinner"></div>Loading archive...</div>
          <div id="lens-wallets-data" style="display:none;"></div>
        </div>
      </div>
      <div class="lens-section collapsed lens-chipped" id="lens-linked-section">
        <div class="lens-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="lens-section-title">Linked Accounts <span class="lens-net-badge">NETWORK</span></span>
          <span class="lens-section-arrow"></span>
        </div>
        <div class="lens-section-body">
          <div id="lens-linked-data">
            <div class="lens-origin-hint">Other X profiles in the archive that share a wallet with this account.</div>
          </div>
        </div>
      </div>
      <div class="lens-section collapsed lens-chipped" id="lens-smart-section">
        <div class="lens-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="lens-section-title">Smart Follower <span class="lens-soon-badge" id="lens-smart-badge">FOLLOWERS</span></span>
          <span class="lens-section-arrow"></span>
        </div>
        <div class="lens-section-body">
          <div id="lens-smart-data">
            <div class="lens-origin-hint">Notable accounts (from your smart list) that follow this profile. Tap to scan.</div>
          </div>
        </div>
      </div>
      <div class="lens-section collapsed lens-chipped" id="lens-cabal-section">
        <div class="lens-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="lens-section-title">Bundled Wallets <span class="lens-arch-badge">CLUSTER</span></span>
          <span class="lens-section-arrow"></span>
        </div>
        <div class="lens-section-body">
          <div id="lens-cabal-data">
            <button class="lens-origin-btn" id="lens-cabal-btn">🕸 Scan bundled wallets</button>
            <div class="lens-origin-hint">Traces who funded the early buyers, then groups wallets sharing a funder into bundles. Heavy scan — runs on click.</div>
          </div>
        </div>
      </div>
      <div class="lens-section collapsed lens-chipped" id="lens-funding-section">
        <div class="lens-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="lens-section-title">Funding Trail <span class="lens-net-badge">SERIAL DEV</span></span>
          <span class="lens-section-arrow"></span>
        </div>
        <div class="lens-section-body">
          <div id="lens-funding-data">
            <div class="lens-origin-hint">Who funded this deployer, and which other wallets that same funder seeded.</div>
          </div>
        </div>
      </div>
      ${(profile.github || profile.username) ? `
      <div class="lens-section collapsed lens-chipped" id="lens-github-section">
        <div class="lens-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="lens-section-title">GitHub Intel</span>
          <span class="lens-section-arrow"></span>
        </div>
        <div class="lens-section-body">
          <div class="lens-loading" id="lens-github-loading"><div class="lens-spinner"></div>Fetching GitHub...</div>
          <div id="lens-github-data" style="display:none;"></div>
        </div>
      </div>` : ''}
      <div class="lens-footer">Powered by <span class="lens-footer-brand">LENS</span> · v2.7.11</div>
    `;
    return panel;
  }

  // Mentioned Wallets — crowd-sourced archive of wallets/CAs seen on this profile.
  // Reads the shared archive (bio + tweet mentions) and flags deleted wallet tweets.
  function fetchWalletHistory(username) {
    const l = document.getElementById('lens-wallets-loading');
    const d = document.getElementById('lens-wallets-data');
    if (!l || !d) return;
    const shorten = a => (a && a.length > 12) ? a.slice(0, 6) + '…' + a.slice(-4) : a;
    const esc = s => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    fetch('https://lens-liard.vercel.app/api/wallet-history?username=' + encodeURIComponent(String(username).toLowerCase()))
      .then(r => r.json())
      .then(res => {
        l.style.display = 'none'; d.style.display = 'block';
        const wallets = (res && res.mentioned_wallets) || [];
        if (!wallets.length) {
          d.innerHTML = '<div class="lens-empty">No wallets archived yet. Browsing profiles builds the shared archive.</div>';
          return;
        }
        d.innerHTML = wallets.slice(0, 12).map(w => {
          const tags = [];
          if (w.in_bio) tags.push('<span class="lens-wtag bio">BIO</span>');
          if (w.tweet_count > 0) tags.push(`<span class="lens-wtag tw">${w.tweet_count} TWEET${w.tweet_count > 1 ? 'S' : ''}</span>`);
          if (w.deleted_count > 0) tags.push(`<span class="lens-wtag del">⚠ ${w.deleted_count} DELETED</span>`);
          const tweets = (w.tweets || []).slice(0, 3).map(t => {
            const tag = t.deleted ? '<span class="lens-wtag del">DELETED</span> ' : '';
            const txt = esc((t.text || '').slice(0, 120)) || '<i>(no text)</i>';
            return `<div class="lens-wtweet${t.deleted ? ' del' : ''}">${tag}${txt}</div>`;
          }).join('');
          return `<div class="lens-wallet">
            <div class="lens-wallet-head">
              <span class="lens-wallet-addr" title="${esc(w.wallet)}" data-addr="${esc(w.wallet)}">${w.chain === 'sol' ? '◎' : '⬡'} ${shorten(w.wallet)}</span>
              <span class="lens-wallet-tags">${tags.join('')}</span>
            </div>
            ${tweets ? `<div class="lens-wallet-tweets">${tweets}</div>` : ''}
          </div>`;
        }).join('');
        // click address to copy
        d.querySelectorAll('.lens-wallet-addr').forEach(el => {
          el.style.cursor = 'pointer';
          el.onclick = () => {
            const a = el.getAttribute('data-addr');
            try { navigator.clipboard.writeText(a); const o = el.textContent; el.textContent = '✓ copied'; setTimeout(() => { el.textContent = o; }, 900); } catch (e) {}
          };
        });
      })
      .catch(() => { l.style.display = 'none'; d.style.display = 'block'; d.innerHTML = '<div class="lens-empty">Archive unavailable</div>'; });
  }

  // ── Linked Accounts (sockpuppet / network) ──
  // Other X profiles in the shared archive that mention the same wallet(s).
  function fetchLinkedAccounts(username) {
    const d = document.getElementById('lens-linked-data');
    if (!d) return;
    const shorten = a => (a && a.length > 12) ? a.slice(0, 6) + '…' + a.slice(-4) : a;
    const esc = s => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    fetch('https://lens-liard.vercel.app/api/linked-accounts?username=' + encodeURIComponent(String(username).toLowerCase()))
      .then(r => r.json())
      .then(res => {
        const linked = (res && res.linked) || [];
        const shared = linked.filter(x => x.count > 0);
        if (!res || !res.success || !shared.length) {
          d.innerHTML = '<div class="lens-empty">No linked accounts found in the archive yet.</div>';
          return;
        }
        const clusters = shared.filter(x => x.tag === 'cluster');
        const head = clusters.length
          ? `<div class="lens-oflags"><span class="lens-oflag warn">🔗 ${res.total_accounts} LINKED ACCOUNT${res.total_accounts > 1 ? 'S' : ''}</span></div>`
          : `<div class="lens-oflags"><span class="lens-oflag ok">↔ wallet seen on other profiles</span></div>`;
        d.innerHTML = head + shared.slice(0, 8).map(x => {
          const chips = x.accounts.slice(0, 8).map(u =>
            `<a class="lens-linked-acct" href="https://x.com/${encodeURIComponent(u)}" target="_blank" rel="noopener">@${esc(u)}</a>`
          ).join('');
          const more = x.count > x.accounts.length ? `<span class="lens-linked-more">+${x.count - x.accounts.length}</span>` : '';
          const badge = x.tag === 'crowd'
            ? '<span class="lens-wtag tw">CROWD</span>'
            : '<span class="lens-wtag del">CLUSTER</span>';
          return `<div class="lens-wallet">
            <div class="lens-wallet-head">
              <span class="lens-wallet-addr" title="${esc(x.wallet)}" data-addr="${esc(x.wallet)}">⬡ ${shorten(x.wallet)}</span>
              <span class="lens-wallet-tags">${badge} <span class="lens-wtag">${x.count} acct${x.count > 1 ? 's' : ''}</span></span>
            </div>
            <div class="lens-linked-accts">${chips}${more}</div>
          </div>`;
        }).join('') +
          '<div class="lens-origin-hint">A small cluster sharing a wallet hints at alts/coordination. A large crowd usually means a popular token everyone mentions.</div>';
        d.querySelectorAll('.lens-wallet-addr').forEach(el => {
          el.style.cursor = 'pointer';
          el.onclick = () => { const a = el.getAttribute('data-addr'); try { navigator.clipboard.writeText(a); const o = el.textContent; el.textContent = '✓ copied'; setTimeout(() => { el.textContent = o; }, 900); } catch (e) {} };
        });
      })
      .catch(() => { d.innerHTML = '<div class="lens-empty">Linked accounts unavailable</div>'; });
  }

  // ── Origin Check ──
  // Reads X's "About this account" panel (based-in country, created-in, VPN accuracy
  // warning, username changes) and flags location spoofing / sock-puppet signals.
  const COUNTRY_ALIASES = {
    'united states': 'us', 'usa': 'us', 'u.s.': 'us', 'u.s.a': 'us', 'america': 'us', 'american': 'us', 'us': 'us',
    'united kingdom': 'uk', 'uk': 'uk', 'great britain': 'uk', 'britain': 'uk', 'england': 'uk', 'british': 'uk',
    'canada': 'ca', 'canadian': 'ca',
    'india': 'in', 'indian': 'in',
    'pakistan': 'pk', 'bangladesh': 'bd', 'nigeria': 'ng', 'indonesia': 'id', 'philippines': 'ph',
    'russia': 'ru', 'china': 'cn', 'turkey': 'tr', 'turkiye': 'tr', 'germany': 'de', 'france': 'fr',
    'uae': 'ae', 'united arab emirates': 'ae', 'israel': 'il', 'egypt': 'eg', 'vietnam': 'vn',
    'australia': 'au', 'brazil': 'br', 'japan': 'jp', 'south korea': 'kr', 'korea': 'kr',
    'ukraine': 'ua', 'netherlands': 'nl', 'singapore': 'sg', 'thailand': 'th', 'malaysia': 'my',
  };
  function countryCode(text) {
    if (!text) return null;
    const low = text.toLowerCase();
    // longest alias first for multi-word matches
    const keys = Object.keys(COUNTRY_ALIASES).sort((a, b) => b.length - a.length);
    for (const k of keys) { if (new RegExp('\\b' + k.replace(/\./g, '\\.') + '\\b').test(low)) return COUNTRY_ALIASES[k]; }
    return null;
  }
  // X's current "About this account" exposes: Date joined / Account based in /
  // Verified / Connected via. We stop each value at the next known label so the
  // country doesn't bleed into "Verified Since …".
  const STOP = '(?:Date joined|Account based in|Account is based|Based in|Verified|Connected via|Connected to|Created|Account was created|Username|This account|Region|$)';
  function parseAbout(txt) {
    const out = { raw: txt };
    // Account based in <country>
    let m = txt.match(new RegExp('based in[:\\s]*([A-Za-z][A-Za-z .,\'&\\/-]{1,38}?)(?=\\s*' + STOP + ')', 'i'));
    out.basedIn = m ? m[1].trim().replace(/\s{2,}/g, ' ') : null;
    if (out.basedIn) out.basedIn = out.basedIn.replace(/\s*(Verified|Connected|Since|Learn more|Help|Date joined|This account).*$/i, '').trim() || null;
    // Date joined <Month YYYY | YYYY>
    m = txt.match(/(?:Date joined|Joined)[:\s]*([A-Za-z]+ \d{4}|\d{4})/i);
    out.joined = m ? m[1].trim() : null;
    // Verified [Since] <Month YYYY | YYYY>
    m = txt.match(/Verified\s*(?:Since\s*)?([A-Za-z]+ \d{4}|\d{4})/i);
    out.verifiedSince = m ? m[1].trim() : null;
    // Connected via <Web | iPhone app | Android app | …>
    m = txt.match(new RegExp('connected (?:via|to)[:\\s]*([A-Za-z][A-Za-z .&-]{1,24}?)(?=\\s*' + STOP + ')', 'i'));
    out.connected = m ? m[1].trim() : null;
    // Legacy fields (older X layouts) — harmless if absent
    m = txt.match(new RegExp('created in[:\\s]*([A-Za-z][A-Za-z .,\'&\\/-]{1,38}?)(?=\\s*' + STOP + ')', 'i'));
    out.createdIn = m ? m[1].trim().replace(/\s{2,}/g, ' ') : null;
    m = txt.match(/(\d+)\s*username change/i);
    out.usernameChanges = m ? parseInt(m[1], 10) : null;
    // X only flags this in text on some accounts; don't overclaim VPN otherwise
    out.vpn = /may not be accurate|using a vpn|vpn or proxy|account location is/i.test(txt);
    return out;
  }
  async function runOriginCheck(self) {
    const dataEl = document.getElementById('lens-origin-data');
    if (dataEl) dataEl.innerHTML = '<div class="lens-loading"><div class="lens-spinner"></div>Opening X account info…</div>';
    const user = (getXUsername() || '').toLowerCase();
    try {
      sessionStorage.setItem('lens_origin_pending', user);
      sessionStorage.setItem('lens_origin_self', self || '');
    } catch (e) {}
    // X renders "About this account" as a full page now, so clicking the join date
    // navigates there. We capture on that page (maybeCaptureAbout) then history.back().
    const join = document.querySelector('[data-testid="UserJoinDate"]');
    const clickTarget = join ? (join.querySelector('a') || join.querySelector('span') || join) : null;
    if (!clickTarget) {
      try { sessionStorage.removeItem('lens_origin_pending'); } catch (e) {}
      if (dataEl) renderOrigin(dataEl, null, self, 'Join-date element not found on this profile.');
      return;
    }
    clickTarget.click();
    // Safety: if navigation didn't happen within ~2.5s, bail gracefully.
    setTimeout(() => {
      let pend = null; try { pend = sessionStorage.getItem('lens_origin_pending'); } catch (e) {}
      const stillHere = document.getElementById('lens-origin-data');
      if (pend && stillHere) {
        try { sessionStorage.removeItem('lens_origin_pending'); } catch (e) {}
        renderOrigin(stillHere, null, self, 'Could not open the About page. X may have changed it, or this account hides it.');
      }
    }, 2800);
  }

  // Runs on the "About this account" page: scrape the rows, stash the parsed result,
  // then go back to the profile where injectPanel will render it.
  async function maybeCaptureAbout() {
    let pending = null, self = '';
    try { pending = sessionStorage.getItem('lens_origin_pending'); self = sessionStorage.getItem('lens_origin_self') || ''; } catch (e) {}
    if (!pending) return;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let txt = '';
    for (let i = 0; i < 30 && !txt; i++) {
      const primary = document.querySelector('[data-testid="primaryColumn"]') || document.body;
      const t = primary ? (primary.textContent || '') : '';
      if (/account based in|date joined|connected via/i.test(t) && /about this account/i.test(t)) { txt = t; break; }
      await sleep(150);
    }
    if (!txt) return; // not on the About page (yet)
    const about = parseAbout(txt);
    try {
      sessionStorage.setItem('lens_origin:' + pending, JSON.stringify({ user: pending, self, about, ts: Date.now() }));
      sessionStorage.removeItem('lens_origin_pending');
      sessionStorage.removeItem('lens_origin_self');
    } catch (e) {}
    setTimeout(() => { try { history.back(); } catch (e) {} }, 150);
  }

  // ── Smart Follower (auto) ── reads X's "followers you follow" for this profile,
  // intersects with the SMART_ACCOUNTS watchlist. Mirrors the origin navigate-scrape-back trick.
  function maybeRunSmartOnExpand() {
    const el = document.getElementById('lens-smart-data');
    if (!el) return;
    try { syncIndependentSmart((getXUsername() || '').toLowerCase()); } catch (e) {}
  }
  function runSmartFollower() {
    const el = document.getElementById('lens-smart-data');
    const user = (getXUsername() || '').toLowerCase();
    if (!user) return;
    if (el) el.innerHTML = '<div class="lens-loading"><div class="lens-spinner"></div>Reading followers you know…</div>';
    try { sessionStorage.setItem('lens_smart_pending', user); } catch (e) {}
    // The "Followed by … you follow" social proof links to /<user>/followers_you_follow.
    const link = document.querySelector('a[href$="/followers_you_follow"]');
    if (!link) {
      // No mutual-follow module → nobody you follow follows them → no smart followers.
      try {
        sessionStorage.setItem('lens_smart:' + user, JSON.stringify({ user, handles: [], ts: Date.now() }));
        sessionStorage.removeItem('lens_smart_pending');
      } catch (e) {}
      renderSmartFollowers();
      return;
    }
    link.click();
    setTimeout(() => {
      let pend = null; try { pend = sessionStorage.getItem('lens_smart_pending'); } catch (e) {}
      const here = document.getElementById('lens-smart-data');
      if (pend && here) {
        try { sessionStorage.removeItem('lens_smart_pending'); } catch (e) {}
        here.innerHTML = '<div class="lens-empty">Couldn\'t open “followers you follow”. X may have changed it.</div>';
      }
    }, 3200);
  }
  // Runs on the /<user>/followers_you_follow page: scrape handles, stash, go back.
  async function maybeCaptureFollowers() {
    let pending = null; try { pending = sessionStorage.getItem('lens_smart_pending'); } catch (e) {}
    if (!pending) return;
    if (!/\/followers_you_follow\/?$/.test(location.pathname)) return;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const handles = new Set();
    for (let i = 0; i < 12; i++) {
      document.querySelectorAll('[data-testid="UserCell"]').forEach(cell => {
        cell.querySelectorAll('a[href^="/"]').forEach(a => {
          const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})$/);
          if (m) handles.add(m[1].toLowerCase());
        });
      });
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(170);
    }
    const list = [...handles];
    try {
      sessionStorage.setItem('lens_smart:' + pending, JSON.stringify({ user: pending, handles: list, ts: Date.now() }));
      sessionStorage.setItem('lens_smart_expand', pending);
      sessionStorage.removeItem('lens_smart_pending');
    } catch (e) {}
    setTimeout(() => { try { history.back(); } catch (e) {} }, 150);
  }
  function renderSmartFollowers() {
    const el = document.getElementById('lens-smart-data');
    const me = (getXUsername() || '').toLowerCase();
    let cached = null; try { cached = JSON.parse(sessionStorage.getItem('lens_smart:' + me) || 'null'); } catch (e) {}
    if (!cached) return; // not scanned yet → keep the hint
    const matched = (cached.handles || []).filter(h => SMART_ACCOUNTS.has(h));
    const badge = document.getElementById('lens-smart-badge');
    renderSmartNameRow(matched); // under the profile name
    if (!el) return;
    if (!matched.length) {
      el.innerHTML = '<div class="lens-empty">No accounts from your smart list follow this profile.</div>';
      if (badge) badge.textContent = '0';
      return;
    }
    if (badge) { badge.textContent = matched.length + ' SMART'; badge.classList.remove('lens-soon-badge'); badge.classList.add('lens-net-badge'); }
    el.innerHTML = '<div class="lens-smart-grid">' + matched.map(h => smartItemHTML(h, false)).join('') + '</div>';
    wireSmartAvatars(el);
  }
  function smartItemHTML(h, small) {
    const avStyle = small ? ' style="width:18px;height:18px;font-size:8px"' : '';
    const cls = small ? 'lens-smart-nb' : 'lens-smart-item';
    return `<a class="${cls}" data-h="${h}" href="https://x.com/${h}" target="_blank" rel="noopener" title="@${h}"><span class="lens-smart-av"${avStyle}><img class="lens-smart-img" src="https://unavatar.io/x/${h}?fallback=false" referrerpolicy="no-referrer"></span><span class="lens-smart-name">@${h}</span></a>`;
  }
  function wireSmartAvatars(scope) {
    scope.querySelectorAll('[data-h] img').forEach(img => {
      const h = img.closest('[data-h]').getAttribute('data-h');
      img.onerror = () => { const sp = img.parentElement; if (sp) sp.textContent = (h || '?').slice(0, 2).toUpperCase(); };
    });
  }
  function placeSmartNameRow() {
    let row = document.getElementById('lens-smart-namerow');
    if (row) return row;
    row = document.createElement('div');
    row.id = 'lens-smart-namerow';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin:4px 0 2px';
    const anchor = document.getElementById('lens-name-badges');
    const nameEl = document.querySelector('[data-testid="UserName"]');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(row, anchor.nextSibling);
    else if (nameEl && nameEl.parentNode) nameEl.parentNode.insertBefore(row, nameEl.nextSibling);
    else return null;
    return row;
  }
  function renderSmartNameRow(matched) {
    const row = placeSmartNameRow();
    if (!row) return;
    if (!matched || !matched.length) { row.innerHTML = ''; return; }
    row.innerHTML = '<span class="lens-smart-nb-label">SMART</span>' + matched.map(h => smartItemHTML(h, true)).join('');
    wireSmartAvatars(row);
  }
  // Read X's "Followed by A, B, and N others you follow" social-proof line → handles shown inline.
  function findFollowedByHandles() {
    const out = []; const seen = new Set();
    let container = null;
    const els = document.querySelectorAll('div, span');
    for (const el of els) {
      if (el.closest('#lens-panel') || el.closest('#lens-smart-namerow') || el.closest('#lens-mylist-row')) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/Followed by .+ you follow/i.test(t) && t.length < 260) { container = el; break; }
    }
    if (!container) return out;
    container.querySelectorAll('a[href^="/"]').forEach(a => {
      const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (!m) return;
      const h = m[1].toLowerCase();
      if (RESERVED_HANDLES.has(h) || seen.has(h)) return; seen.add(h);
      const img = a.querySelector('img');
      out.push({ handle: h, avatar: img ? img.src : null });
    });
    return out;
  }
  function placeMyListRow() {
    let row = document.getElementById('lens-mylist-row');
    if (row) return row;
    row = document.createElement('div');
    row.id = 'lens-mylist-row';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin:4px 0 2px';
    const anchor = document.getElementById('lens-smart-namerow') || document.getElementById('lens-name-badges');
    const nameEl = document.querySelector('[data-testid="UserName"]');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(row, anchor.nextSibling);
    else if (nameEl && nameEl.parentNode) nameEl.parentNode.insertBefore(row, nameEl.nextSibling);
    else return null;
    return row;
  }
  // Cross-match the profile's "followers you follow" against the user's saved Smart List.
  function renderMyListMatches() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const shown = findFollowedByHandles();
    if (!shown.length) return;
    chrome.storage.local.get(['lens_smart_harvested', 'lens_smart_meta'], (r) => {
      const saved = new Set(((r && r.lens_smart_harvested) || []).map(x => String(x).toLowerCase()));
      SMART_ACCOUNTS.forEach(x => saved.add(String(x).toLowerCase()));
      const meta = (r && r.lens_smart_meta) || {};
      const matches = shown.filter(it => saved.has(it.handle));
      const row = placeMyListRow();
      if (!row) return;
      if (!matches.length) { row.innerHTML = ''; return; }
      row.innerHTML = '<span class="lens-smart-nb-label" style="color:#f5a623">YOUR LIST</span>' + matches.map(it => {
        const m = meta[it.handle] || {};
        const obj = { handle: it.handle, avatar: it.avatar || m.avatar || null };
        return `<a class="lens-smart-nb" data-h="${it.handle}" href="https://x.com/${it.handle}" target="_blank" rel="noopener" title="@${it.handle}">${smartAvImg(obj, true)}<span class="lens-smart-name">@${it.handle}</span></a>`;
      }).join('');
      wireSmartAvatars(row);
    });
  }
  // Copy smart-follower handles from Frontrun's rendered pills (both extensions share the page DOM).
  const RESERVED_HANDLES = new Set(['home','explore','notifications','messages','i','search','settings','compose','bookmarks','jobs','communities','frontrunpro','intent','hashtag','login','signup','tos','privacy']);
  // Read Frontrun's rendered "N Smart Followers" pills → [{handle,label,avatar}].
  // Collect elements across light DOM + open shadow roots (Frontrun may use shadow DOM).
  function deepEls(root, sel) {
    const out = [];
    const visit = (r) => {
      let list; try { list = r.querySelectorAll(sel); } catch (e) { return; }
      for (const el of list) { out.push(el); if (el.shadowRoot) visit(el.shadowRoot); }
    };
    try { visit(root); } catch (e) {}
    return out;
  }
  // Always store a diagnostic of Frontrun's smart-follower area (even if not parsed) for tuning.
  function captureFrontrunDebug() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return;
      const els = deepEls(document, 'span,div,h2,h3,h5,h6,p,button,a');
      const skip = (el) => el.closest && (el.closest('#lens-panel') || el.closest('#lens-smart-namerow') || el.closest('#lens-name-badges') || el.closest('#lens-smart-data'));
      let hit = null;
      for (const el of els) {
        if (skip(el)) continue;
        const t = (el.textContent || '').replace(/\s+/g, ' ');
        if (/smart\s*followers?/i.test(t) && t.length < 140) { hit = el; break; }
      }
      let payload;
      if (hit) {
        let box = hit;
        for (let i = 0; i < 7 && box.parentElement; i++) { box = box.parentElement; if (box.querySelectorAll('span.truncate').length >= 3 || box.querySelectorAll('a[href^="/"]').length >= 6 || box.querySelectorAll('img').length >= 3) break; }
        payload = {
          found: true,
          headerText: (hit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          inShadow: !!(hit.getRootNode && hit.getRootNode() !== document && hit.getRootNode().host),
          truncateCount: box.querySelectorAll('span.truncate').length,
          imgCount: box.querySelectorAll('img').length,
          anchorCount: box.querySelectorAll('a[href^="/"]').length,
          html: (box.outerHTML || '').slice(0, 8000)
        };
      } else {
        // Rich miss diagnostics — figure out WHY nothing matched.
        const fr = els.find(el => /frontrun/i.test(((el.getAttribute && (el.getAttribute('href') || el.getAttribute('class') || '')) || '') + ' ' + (el.textContent || '')));
        let withShadow = 0;
        try { document.querySelectorAll('*').forEach(e => { if (e.shadowRoot) withShadow++; }); } catch (e) {}
        payload = {
          found: false,
          frontrunSeen: !!fr,
          frHtml: fr ? ((fr.closest('div') && fr.closest('div').outerHTML) || fr.outerHTML || '').slice(0, 3000) : null,
          followerMentions: els.filter(el => !skip(el) && /follower/i.test(el.textContent || '') && (el.textContent || '').length < 90).slice(0, 8).map(el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70)),
          openShadowHosts: withShadow,
          iframes: document.querySelectorAll('iframe').length,
          truncateSpansInDoc: deepEls(document, 'span.truncate').length
        };
      }
      chrome.storage.local.set({ lens_fr_debug: JSON.stringify(payload, null, 1) });
      // Per-pill probe: for each pill, show where the username can (or cannot) be found.
      try {
        const fb = findFrontrunBox();
        if (fb) {
          const pills = [];
          fb.querySelectorAll('span.truncate').forEach((span, idx) => {
            if (idx > 8) return;
            const wrap = span.closest('.inline-block') || (span.parentElement && span.parentElement.closest('div')) || span.parentElement;
            const img = wrap ? wrap.querySelector('img') : null;
            const a = (wrap && wrap.querySelector('a[href^="/"]')) || (span.closest && span.closest('a[href^="/"]'));
            const rk = [];
            try { Object.keys(span).forEach(k => { if (/^__react/.test(k)) rk.push(k.split('$')[0]); }); } catch (e) {}
            pills.push({
              idx,
              label: (span.textContent || '').trim().slice(0, 40),
              imgSrc: img ? (img.getAttribute('src') || img.src || '').slice(0, 120) : null,
              anchorHref: a ? a.getAttribute('href') : null,
              reactKeys: rk,
              resolved: usernameFromPill(span, wrap),
              wrapHtml: wrap ? (wrap.outerHTML || '').slice(0, 600) : null
            });
          });
          chrome.storage.local.set({ lens_fr_pills: JSON.stringify(pills, null, 1) });
        }
      } catch (e) { try { chrome.storage.local.set({ lens_fr_pills: 'ERR ' + (e && e.message) }); } catch (_) {} }
    } catch (e) { try { chrome.storage.local.set({ lens_fr_debug: 'ERR ' + (e && e.message) }); } catch (_) {} }
  }
  function findFrontrunBox() {
    let header = null;
    for (const el of deepEls(document, 'h6, h5, span, div, p, button')) {
      if (el.closest && (el.closest('#lens-panel') || el.closest('#lens-smart-namerow') || el.closest('#lens-name-badges') || el.closest('#lens-smart-data'))) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/(^|\s)smart\s*followers?(\s|$)/i.test(t) && t.length < 60) { header = el; break; }
    }
    if (!header) return null;
    let box = header;
    for (let i = 0; i < 6 && box.parentElement; i++) {
      box = box.parentElement;
      if (box.querySelectorAll('span.truncate').length >= 3 || box.querySelectorAll('img').length >= 3) break;
    }
    return box;
  }
  // Proxy a click to Frontrun's own pill so label-only entries still navigate.
  function fireClick(elm) {
    if (!elm) return;
    ['pointerover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      try { elm.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    });
  }
  function clickFrontrunPill(idx) {
    const box = findFrontrunBox();
    if (!box) return;
    const span = box.querySelectorAll('span.truncate')[idx];
    if (!span) return;
    const wrap = span.closest('.inline-block') || span.parentElement;
    const inner = wrap && wrap.firstElementChild;
    const targets = [
      wrap && wrap.querySelector('img'),
      span.closest('button'),
      inner,
      wrap
    ].filter(Boolean);
    for (const t of targets) fireClick(t);
  }
  // Derive a Frontrun-style role label from a profile bio, e.g. "CEO@Tesla", "Co-Founder@Echo".
  function labelFromBio(bio) {
    if (!bio) return '';
    const b = bio.replace(/\s+/g, ' ').trim();
    const roleRe = /(co[\s-]?founders?|founders?|ceo|cto|coo|cmo|cfo|president|general partner|managing partner|partner|\bgp\b|head of [a-z& ]{2,22}|investor|building|board member|chairman|chair|director|advisor|vp of [a-z& ]{2,22}|engineer|researcher|developer|dev)/i;
    const rm = b.match(roleRe);
    if (!rm) return '';
    let role = rm[0].trim();
    const after = b.slice(rm.index + rm[0].length);
    let comp = '';
    const at = after.match(/\s*@([A-Za-z0-9_]{2,20})/);
    const ofat = after.match(/\s*(?:of|at|@|,)\s+([A-Z][A-Za-z0-9.\- ]{1,20})/);
    if (at) comp = at[1].trim();
    else if (ofat) comp = ofat[1].trim().split(/\s{2,}|[|·•]/)[0].trim();
    role = role.replace(/co[\s-]?founder/i, 'Co-Founder').replace(/\b\w/g, c => c.toUpperCase());
    role = role.replace(/\bCeo\b/, 'CEO').replace(/\bCto\b/, 'CTO').replace(/\bCoo\b/, 'COO').replace(/\bCmo\b/, 'CMO').replace(/\bCfo\b/, 'CFO').replace(/\bGp\b/, 'GP').replace(/\bVp\b/, 'VP');
    if (comp && comp.length > 22) comp = comp.slice(0, 22);
    return comp ? (role + '@' + comp) : role;
  }
  // After clicking a smart-follower pill, Frontrun opens that person's profile.
  // When we land on it, the real @username is in the URL — record it here.
  function resolvePendingSmart(username, bio) {
    if (!username || typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.local.get(['lens_smart_pending', 'lens_smart_harvested', 'lens_smart_meta'], (r) => {
      const pend = r && r.lens_smart_pending;
      if (!pend || !pend.ts || (Date.now() - pend.ts) > 25000) return;
      const h = String(username).toLowerCase();
      if (!/^[a-z0-9_]{1,15}$/.test(h) || RESERVED_HANDLES.has(h)) { chrome.storage.local.remove('lens_smart_pending'); return; }
      const cur = new Set((r && r.lens_smart_harvested) || []);
      const meta = (r && r.lens_smart_meta) || {};
      const isNew = !cur.has(h);
      if (isNew) { cur.add(h); SMART_ACCOUNTS.add(h); }
      // Prefer Frontrun's label if we had one; else derive our own from the bio (independent of Frontrun).
      const label = pend.label || labelFromBio(bio) || ('@' + h);
      meta[h] = { label, avatar: pend.avatar || (meta[h] && meta[h].avatar) || null };
      chrome.storage.local.set({ lens_smart_harvested: [...cur], lens_smart_meta: meta });
      chrome.storage.local.remove('lens_smart_pending');
      try {
        const t = document.createElement('div');
        t.textContent = (isNew ? '✓ Recorded @' : '• Already have @') + h;
        t.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:2147483647;background:#0f1620;border:1px solid #2a3a4d;color:#cdd9ff;padding:8px 12px;border-radius:10px;font:600 12px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.45)';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2200);
      } catch (e) {}
    });
  }
  // ── Resolve the REAL @username for a Frontrun pill WITHOUT navigating ──
  // Frontrun's pill only renders avatar + label (e.g. "Co-Founder@Echo"), no @handle.
  // The username usually still lives in: (1) a nearby anchor href, (2) the avatar URL,
  // or (3) the React props/fiber of the pill component. We mine all three.
  function validHandle(h) {
    h = String(h || '').replace(/^@/, '').toLowerCase().trim();
    return (/^[a-z0-9_]{1,15}$/.test(h) && !RESERVED_HANDLES.has(h)) ? h : null;
  }
  function handleFromUrl(u) {
    if (!u) return null;
    try {
      let m = String(u).match(/unavatar\.io\/(?:x|twitter)\/([A-Za-z0-9_]{1,15})/i); if (m) return validHandle(m[1]);
      m = String(u).match(/(?:^https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})(?:[\/?#]|$)/i); if (m) return validHandle(m[1]);
      m = String(u).match(/^\/([A-Za-z0-9_]{1,15})(?:[\/?#]|$)/); if (m) return validHandle(m[1]);
    } catch (e) {}
    return null;
  }
  function reactKeyVal(el, prefix) {
    if (!el) return null;
    let k; try { k = Object.keys(el).find(x => x.indexOf(prefix) === 0); } catch (e) { return null; }
    return k ? el[k] : null;
  }
  function digHandle(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    for (const key of ['username', 'screenName', 'screen_name', 'handle', 'userName', 'screenname']) {
      if (typeof obj[key] === 'string') { const h = validHandle(obj[key]); if (h) return h; }
    }
    for (const key of ['to', 'href', 'url', 'pathname', 'profileUrl']) {
      if (typeof obj[key] === 'string') { const h = handleFromUrl(obj[key]); if (h) return h; }
    }
    for (const key in obj) {
      if (['_owner', 'stateNode', 'return', 'child', 'sibling', 'alternate', 'memoizedState', 'updateQueue'].includes(key)) continue;
      const v = obj[key];
      if (v && typeof v === 'object') { const h = digHandle(v, depth + 1); if (h) return h; }
    }
    return null;
  }
  function handleFromReact(el) {
    let node = el, hops = 0;
    while (node && hops < 6) {
      const props = reactKeyVal(node, '__reactProps$');
      if (props) { const h = digHandle(props, 0); if (h) return h; }
      let f = reactKeyVal(node, '__reactFiber$') || reactKeyVal(node, '__reactInternalInstance$'), fh = 0;
      while (f && fh < 8) {
        const mp = f.memoizedProps || f.pendingProps;
        if (mp) { const h = digHandle(mp, 0); if (h) return h; }
        f = f.return; fh++;
      }
      node = node.parentElement; hops++;
    }
    return null;
  }
  // Try every no-navigation source; returns a clean handle or null.
  function usernameFromPill(span, wrap) {
    const scope = wrap || (span && span.parentElement) || span;
    if (!scope) return null;
    // 1) anchor href INSIDE the tight pill wrapper only (avoid grabbing unrelated links)
    let a = (scope.querySelector && scope.querySelector('a[href^="/"]')) || (span.closest && span.closest('a[href^="/"]'));
    if (a) { const h = handleFromUrl(a.getAttribute('href')); if (h) return h; }
    // 2) avatar URL
    const img = scope.querySelector && scope.querySelector('img');
    if (img) { const h = handleFromUrl(img.getAttribute('src') || img.src); if (h) return h; }
    // 3) React props/fiber (best-effort; brittle across Frontrun updates)
    return handleFromReact(span);
  }
  function readFrontrunSmart() {
    const box = findFrontrunBox();
    if (!box) return [];
    const self = (getXUsername() || '').toLowerCase();
    const out = []; const seen = new Set();
    box.querySelectorAll('span.truncate').forEach((span, idx) => {
      const label = (span.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label) return;
      const wrap = span.closest('.inline-block') || (span.parentElement && span.parentElement.closest('div'));
      const img = wrap ? wrap.querySelector('img') : null;
      const avatar = img ? img.src : null;
      // Resolve the real @username: label-is-handle first, then mine href/avatar/React.
      let handle = /^[a-z0-9_]{1,15}$/i.test(label) ? validHandle(label) : null;
      if (!handle) handle = usernameFromPill(span, wrap);
      if (handle && handle === self) return;
      const key = handle || ('lbl:' + label.toLowerCase() + ':' + idx);
      if (seen.has(key)) return; seen.add(key);
      out.push({ handle, label, avatar, idx });
    });
    return out;
  }
  function smartAvImg(it, small) {
    const st = small ? ' style="width:18px;height:18px;font-size:8px"' : '';
    const src = it.avatar || ('https://unavatar.io/x/' + it.handle + '?fallback=false');
    return `<span class="lens-smart-av"${st}><img src="${src}" referrerpolicy="no-referrer"></span>`;
  }
  // Render smart-follower pills into the panel section + under the profile name.
  function renderSmartItems(items) {
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const badge = document.getElementById('lens-smart-badge');
    if (badge) {
      if (items.length) { badge.textContent = items.length + ' SMART'; badge.classList.remove('lens-soon-badge'); badge.classList.add('lens-net-badge'); }
      else { badge.textContent = 'FOLLOWERS'; badge.classList.add('lens-soon-badge'); badge.classList.remove('lens-net-badge'); }
    }
    const itemHTML = (it, small) => {
      const cls = small ? 'lens-smart-nb' : 'lens-smart-item';
      const av = smartAvImg(it, small);
      return `<a class="${cls}" data-h="${it.handle}" href="https://x.com/${it.handle}" target="_blank" rel="noopener" title="${esc(it.label || ('@' + it.handle))}">${av}<span class="lens-smart-name">@${it.handle}</span></a>`;
    };
    const el = document.getElementById('lens-smart-data');
    if (el) {
      el.innerHTML = items.length
        ? '<div class="lens-smart-grid">' + items.map(it => itemHTML(it, false)).join('') + '</div>'
        : '<div class="lens-empty">No smart followers found.</div>';
      wireSmartAvatars(el);
    }
    if (items.length) {
      const row = placeSmartNameRow();
      if (row) { row.innerHTML = '<span class="lens-smart-nb-label">SMART</span>' + items.slice(0, 14).map(it => itemHTML(it, true)).join(''); wireSmartAvatars(row); }
    } else {
      const existing = document.getElementById('lens-smart-namerow'); if (existing) existing.remove();
    }
  }
  // Fetch this profile's smart followers from the LENS backend (independent of Frontrun).
  async function syncIndependentSmart(username) {
    username = String(username || '').toLowerCase().replace(/^@/, '').trim();
    if (!username || !/^[a-z0-9_]{1,15}$/.test(username)) return;
    const key = 'lens_sf:' + username;
    let followers = null;
    try { const c = sessionStorage.getItem(key); if (c) followers = JSON.parse(c); } catch (e) {}
    if (!followers) {
      try {
        const r = await fetch('https://lens-liard.vercel.app/api/smart-followers?handle=' + encodeURIComponent(username));
        const j = await r.json();
        followers = (j && j.followers) || [];
        try { sessionStorage.setItem(key, JSON.stringify(followers)); } catch (e) {}
      } catch (e) { followers = []; }
    }
    if ((getXUsername() || '').toLowerCase() !== username) return; // navigated away
    const items = followers.map((f, idx) => ({ handle: f.handle, label: f.label || ('@' + f.handle), avatar: f.avatar || null, idx }));
    renderSmartItems(items);
  }
  function syncFrontrunSmart() {
    const items = readFrontrunSmart();
    if (!items.length) return false;
    // harvest handles + their labels/avatars into the persistent watchlist
    try {
      if (chrome && chrome.storage) {
        chrome.storage.local.get(['lens_smart_harvested', 'lens_smart_meta'], (r) => {
          const cur = new Set((r && r.lens_smart_harvested) || []);
          const meta = (r && r.lens_smart_meta) || {};
          let changed = false;
          items.forEach(it => {
            if (!it.handle) return;
            if (!cur.has(it.handle)) { cur.add(it.handle); SMART_ACCOUNTS.add(it.handle); changed = true; }
            const label = it.label || '';
            const isRole = label && label.toLowerCase() !== it.handle;
            const ex = meta[it.handle];
            if (!ex || (isRole && (!ex.label || ex.label.toLowerCase() === it.handle)) || (it.avatar && !ex.avatar)) {
              meta[it.handle] = { label: label || (ex && ex.label) || ('@' + it.handle), avatar: it.avatar || (ex && ex.avatar) || null };
              changed = true;
            }
          });
          if (changed) chrome.storage.local.set({ lens_smart_harvested: [...cur], lens_smart_meta: meta });
        });
      }
    } catch (e) {}
    // render mirror into the panel section + under the profile name
    const badge = document.getElementById('lens-smart-badge');
    if (badge) { badge.textContent = items.length + ' SMART'; badge.classList.remove('lens-soon-badge'); badge.classList.add('lens-net-badge'); }
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const itemHTML = (it, small) => {
      const cls = small ? 'lens-smart-nb' : 'lens-smart-item';
      const av = smartAvImg(it, small);
      if (it.handle) {
        return `<a class="${cls}" data-h="${it.handle}" href="https://x.com/${it.handle}" target="_blank" rel="noopener" title="${esc(it.label || ('@' + it.handle))}">${av}<span class="lens-smart-name">@${it.handle}</span></a>`;
      }
      // label-only (Frontrun didn't expose a username) → click proxies to Frontrun's pill
      return `<span class="${cls} lens-smart-lbl" data-idx="${it.idx}" title="${esc(it.label)}" style="cursor:pointer">${av}<span class="lens-smart-name">${esc(it.label)}</span></span>`;
    };
    const wireProxy = (scope) => { if (scope) scope.querySelectorAll('.lens-smart-lbl[data-idx]').forEach(elx => { elx.onclick = () => {
      const idx = +elx.getAttribute('data-idx');
      const im = elx.querySelector('img');
      try { if (chrome && chrome.storage) chrome.storage.local.set({ lens_smart_pending: { label: elx.getAttribute('title') || '', avatar: im ? im.src : null, ts: Date.now() } }); } catch (e) {}
      clickFrontrunPill(idx);
    }; }); };
    const el = document.getElementById('lens-smart-data');
    if (el) {
      el.innerHTML = '<div class="lens-smart-grid">' + items.map(it => itemHTML(it, false)).join('') + '</div>';
      wireSmartAvatars(el); wireProxy(el);
    }
    const row = placeSmartNameRow();
    if (row) {
      row.innerHTML = '<span class="lens-smart-nb-label">SMART</span>' + items.slice(0, 14).map(it => itemHTML(it, true)).join('');
      wireSmartAvatars(row); wireProxy(row);
    }
    return true;
  }

  function renderOrigin(el, about, self, note) {
    const rewire = () => { const b = document.getElementById('lens-origin-btn'); if (b) b.onclick = () => runOriginCheck(self); };
    if (!about) {
      el.innerHTML = `<div class="lens-empty">${note || 'No origin data.'}</div><button class="lens-origin-btn" id="lens-origin-btn">↻ Retry</button>`;
      return rewire();
    }
    const flags = [];
    if (about.vpn) flags.push('<span class="lens-oflag warn">⚠ POSSIBLE VPN</span>');
    const selfCC = countryCode(self), baseCC = countryCode(about.basedIn);
    if (selfCC && baseCC && selfCC !== baseCC) flags.push('<span class="lens-oflag bad">🚩 LOCATION MISMATCH</span>');
    const createdCC = countryCode(about.createdIn);
    if (baseCC && createdCC && baseCC !== createdCC) flags.push('<span class="lens-oflag warn">🏗 CREATED ≠ BASED</span>');
    if (about.usernameChanges && about.usernameChanges >= 2) flags.push(`<span class="lens-oflag warn">🔄 ${about.usernameChanges}× USERNAME</span>`);
    const row = (label, val) => val ? `<div class="lens-orow"><span class="lens-olabel">${label}</span><span class="lens-oval">${String(val).replace(/[<>]/g, '')}</span></div>` : '';
    // honest no-flag line: distinguish "checked, clean" vs "nothing to compare"
    let okLine;
    if (flags.length) okLine = `<div class="lens-oflags">${flags.join('')}</div>`;
    else if (baseCC && selfCC && selfCC === baseCC) okLine = '<div class="lens-oflags"><span class="lens-oflag ok">✓ location matches</span></div>';
    else if (baseCC && !selfCC) okLine = '<div class="lens-oflags"><span class="lens-oflag ok">✓ based in ' + (about.basedIn) + '</span></div>';
    else okLine = '<div class="lens-oflags"><span class="lens-oflag ok">✓ no obvious flags</span></div>';
    el.innerHTML = `
      ${okLine}
      ${row('Based in', about.basedIn || 'not shown')}
      ${row('Stated location', self)}
      ${row('Joined', about.joined)}
      ${row('Verified since', about.verifiedSince)}
      ${row('Connected via', about.connected)}
      ${row('Created in', about.createdIn)}
      ${row('Username changes', about.usernameChanges != null ? String(about.usernameChanges) : null)}
      ${(!self && about.basedIn) ? '<div class="lens-origin-hint">No location set on this profile, so nothing to compare against — based-in country shown for reference.</div>' : ''}`;
  }

  // ── AI Verdict (Aevon) ──
  function collectSignals() {
    const panel = document.getElementById('lens-panel');
    if (!panel) return { panel: '', trust: null };
    let full = panel.textContent || '';
    const ai = document.getElementById('lens-verdict-section');
    if (ai && ai.textContent) full = full.split(ai.textContent).join(' ');
    full = full.replace(/\s+/g, ' ').trim().slice(0, 1800);
    let trust = null;
    const m = full.match(/(\d{1,3})\s*\/\s*100\s*([A-Za-z]+)/);
    if (m) trust = { score: parseInt(m[1], 10), label: m[2] };
    return { panel: full, trust };
  }
  function scheduleVerdict(user) {
    verdictState = { user, done: false };
    let tries = 0;
    const attempt = () => {
      const el = document.getElementById('lens-verdict-data');
      if (!el) return;
      const sig = collectSignals();
      const hasToken = (typeof cabalCtx !== 'undefined' && cabalCtx && cabalCtx.token);
      if (sig.trust || hasToken) {
        // data started loading — wait for dev activity / other sections to finish rendering
        setTimeout(() => { if (document.getElementById('lens-verdict-data')) runVerdict(user); }, 3800);
        return;
      }
      tries++;
      if (tries >= 6) {
        el.innerHTML = '<div class="lens-empty">No Bankrbot/Base token detected — nothing to assess.</div>';
        return;
      }
      setTimeout(attempt, 2200);
    };
    setTimeout(attempt, 4000);
  }
  function runVerdict(user) {
    if (verdictState.done) return;
    verdictState.done = true;
    const sig = collectSignals(); // re-collect a full, fresh snapshot of the panel
    const el = document.getElementById('lens-verdict-data');
    if (el) el.innerHTML = '<div class="lens-loading"><div class="lens-spinner"></div>Analyzing signals…</div>';
    fetch('https://lens-liard.vercel.app/api/verdict', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, panel: sig.panel, trust: sig.trust }),
    })
      .then(r => r.json())
      .then(d => {
        const e2 = document.getElementById('lens-verdict-data');
        if (!d || !d.success) {
          if (e2) e2.innerHTML = '<div class="lens-empty">Verdict unavailable' + (d && d.error ? ' — ' + String(d.error).replace(/[<>]/g, '') : '') + '</div>';
          return;
        }
        const v = { level: d.level, verdict: d.verdict, ts: Date.now() };
        try { sessionStorage.setItem('lens_verdict:' + user, JSON.stringify(v)); } catch (e) {}
        renderVerdict(v);
      })
      .catch(() => { const e2 = document.getElementById('lens-verdict-data'); if (e2) e2.innerHTML = '<div class="lens-empty">Verdict failed to load</div>'; });
  }
  function renderVerdict(v) {
    const el = document.getElementById('lens-verdict-data');
    if (!el) return;
    const esc = s => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const lvl = (v.level || 'MEDIUM').toUpperCase();
    const cls = lvl === 'HIGH' ? 'bad' : (lvl === 'LOW' ? 'ok' : 'warn');
    el.innerHTML = `<div class="lens-verdict">
      <span class="lens-verdict-level ${cls}">${esc(lvl)} RISK</span>
      <div class="lens-verdict-text">${esc(v.verdict)}</div>
      <div class="lens-origin-hint">AI risk read of LENS signals</div>
    </div>`;
  }

  // ── Token Health (dev holdings) ──
  function scheduleTokenHealth() {
    let tries = 0;
    const attempt = () => {
      const el = document.getElementById('lens-health-data');
      if (!el) return;
      const ctx = (typeof cabalCtx !== 'undefined') ? cabalCtx : null;
      if (ctx && ctx.token) { runTokenHealth(ctx.token, ctx.deployer); return; }
      tries++;
      if (tries >= 6) { el.innerHTML = '<div class="lens-empty">No Bankrbot/Base token detected.</div>'; return; }
      setTimeout(attempt, 2200);
    };
    setTimeout(attempt, 4000);
  }
  function runTokenHealth(token, deployer) {
    const el = document.getElementById('lens-health-data');
    if (el) el.innerHTML = '<div class="lens-loading"><div class="lens-spinner"></div>Reading on-chain supply…</div>';
    safeSendMessage({ type: 'FETCH_TOKEN_HEALTH', tokenAddress: token, deployerWallet: deployer }, (r) => {
      renderTokenHealth(r && r.success ? r.data : null);
    });
  }
  function renderTokenHealth(d) {
    const el = document.getElementById('lens-health-data');
    if (!el) return;
    if (!d || !d.success) { el.innerHTML = '<div class="lens-empty">Couldn\'t read token supply on-chain.</div>'; return; }
    const pct = d.dev_pct;
    let flag;
    if (pct == null) flag = '<span class="lens-oflag ok">supply read · dev balance n/a</span>';
    else if (pct >= 20) flag = `<span class="lens-oflag bad">🚩 DEV HOLDS ${pct}% — HIGH DUMP RISK</span>`;
    else if (pct >= 5) flag = `<span class="lens-oflag warn">⚠ DEV HOLDS ${pct}%</span>`;
    else flag = `<span class="lens-oflag ok">✓ dev holds ${pct}% (low)</span>`;
    const row = (label, val) => val != null ? `<div class="lens-orow"><span class="lens-olabel">${label}</span><span class="lens-oval">${String(val)}</span></div>` : '';
    el.innerHTML = `<div class="lens-oflags">${flag}</div>
      ${row('Dev holdings', pct != null ? pct + '% of supply' : null)}
      ${d.symbol ? row('Token', '$' + String(d.symbol).replace(/[<>]/g, '')) : ''}
      <div class="lens-origin-hint">Dev's current balance ÷ total supply. Liquidity / full holder spread need an indexer (later).</div>`;
  }

  // ── Funding Trail (serial-dev linking) ──
  function scheduleFunding() {
    let tries = 0;
    const attempt = () => {
      const el = document.getElementById('lens-funding-data');
      if (!el) return;
      const ctx = (typeof cabalCtx !== 'undefined') ? cabalCtx : null;
      if (ctx && ctx.deployer) { runFunding(ctx.deployer); return; }
      tries++;
      if (tries >= 6) { el.innerHTML = '<div class="lens-empty">No deployer wallet detected for this profile.</div>'; return; }
      setTimeout(attempt, 2200);
    };
    setTimeout(attempt, 4500);
  }
  function runFunding(deployer) {
    const el = document.getElementById('lens-funding-data');
    if (el) el.innerHTML = '<div class="lens-loading"><div class="lens-spinner"></div>Tracing funding source…</div>';
    safeSendMessage({ type: 'FETCH_DEV_FUNDING', deployerWallet: deployer }, (r) => {
      const d = r && r.success ? r.data : null;
      if (!d || !d.success) { if (el) el.innerHTML = '<div class="lens-empty">Couldn\'t trace funding.</div>'; return; }
      // cross-reference siblings with the archive to surface known X accounts
      const probe = [deployer, ...(d.siblings || [])].slice(0, 60).join(',');
      fetch('https://lens-liard.vercel.app/api/wallets-accounts?wallets=' + encodeURIComponent(probe))
        .then(x => x.json())
        .then(a => renderFunding(d, (a && a.accounts) || {}))
        .catch(() => renderFunding(d, {}));
    });
  }
  function renderFunding(d, accounts) {
    const el = document.getElementById('lens-funding-data');
    if (!el) return;
    const esc = s => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const shorten = a => (a && a.length > 12) ? a.slice(0, 6) + '…' + a.slice(-4) : a;
    if (!d.funder) { el.innerHTML = '<div class="lens-empty">No funding source found on-chain.</div>'; return; }
    const fan = d.fanout || 0;
    let flag;
    if (fan >= 30) flag = `<span class="lens-oflag ok">funder seeds many wallets (likely exchange/bridge) · low signal</span>`;
    else if (fan >= 2) flag = `<span class="lens-oflag warn">🧬 SHARED FUNDER · ${fan} sibling wallet${fan > 1 ? 's' : ''}</span>`;
    else flag = `<span class="lens-oflag ok">no shared-funder siblings</span>`;
    const link = a => `https://basescan.org/address/${a}`;
    const rows = [];
    rows.push(`<div class="lens-orow"><span class="lens-olabel">Funded by</span><span class="lens-oval"><a class="lens-linked-acct" href="${link(d.funder)}" target="_blank" rel="noopener">${shorten(d.funder)}</a></span></div>`);
    // siblings (only meaningful when it's a small personal-funder cluster)
    if (fan >= 2 && fan < 30) {
      const sibs = (d.siblings || []).slice(0, 10).map(w => {
        const known = accounts[w.toLowerCase()];
        const tag = (known && known.length) ? ` <span class="lens-funding-known">→ @${esc(known[0])}</span>` : '';
        return `<div class="lens-funding-sib"><a class="lens-linked-acct" href="${link(w)}" target="_blank" rel="noopener">${shorten(w)}</a>${tag}</div>`;
      }).join('');
      rows.push(`<div style="margin-top:6px">${sibs}</div>`);
      if (fan > 10) rows.push(`<div class="lens-linked-more">+${fan - 10} more</div>`);
    }
    el.innerHTML = `<div class="lens-oflags">${flag}</div>${rows.join('')}
      <div class="lens-origin-hint">A small cluster from one funder hints at a multi-wallet operator. "→ @handle" = that wallet is linked to a known account in the archive.</div>`;
  }

  // ── Cabal Wallet scan (on-demand, heavy) ──
  function wireCabalBtn() { const b = document.getElementById('lens-cabal-btn'); if (b) b.onclick = scanCabal; }
  function scanCabal() {
    const dataEl = document.getElementById('lens-cabal-data');
    if (!dataEl) return;
    if (!cabalCtx || !cabalCtx.token) {
      dataEl.innerHTML = '<div class="lens-empty">No token detected for this profile yet. Open a profile with a Bankrbot/Base token first.</div><button class="lens-origin-btn" id="lens-cabal-btn" style="margin-top:8px">↻ Retry</button>';
      return wireCabalBtn();
    }
    dataEl.innerHTML = '<div class="lens-loading"><div class="lens-spinner"></div>Tracing early-buyer funders… (may take a few seconds)</div>';
    safeSendMessage({ type: 'FETCH_CABAL', tokenAddress: cabalCtx.token, deployerWallet: cabalCtx.deployer }, r => {
      renderCabal(dataEl, r && r.success ? r.data : null, r && r.error);
    });
  }
  function renderCabal(el, data, err) {
    const short = a => (a && a.length > 12) ? a.slice(0, 6) + '…' + a.slice(-4) : a;
    const esc = s => String(s || '').replace(/[<>&]/g, '');
    const rebtn = '<button class="lens-origin-btn" id="lens-cabal-btn" style="margin-top:8px">↻ Re-scan</button>';
    if (!data) { el.innerHTML = `<div class="lens-empty">${err ? 'Scan failed: ' + esc(err) : 'Scan unavailable'}</div>${rebtn}`; return wireCabalBtn(); }
    if (!data.clusters || !data.clusters.length) {
      el.innerHTML = `<div class="lens-empty">${esc(data.note || 'No bundled wallets found.')}</div><div class="lens-origin-hint">Checked ${data.scanned || 0} early buyers.</div>${rebtn}`;
      return wireCabalBtn();
    }
    const summary = `<div class="lens-cabal-sum">⚠ ${data.clusters.length} cluster${data.clusters.length > 1 ? 's' : ''} · ~${data.total_pct || 0}% of supply · ${data.scanned} early buyers scanned</div>`;
    const cards = data.clusters.map(c => {
      const tag = c.funder_is_dev ? '<span class="lens-wtag del">DEV-FUNDED</span>' : '<span class="lens-wtag tw">CLUSTER</span>';
      const pct = (c.supply_pct != null) ? `<span class="lens-cabal-pct">${c.supply_pct}%</span>` : '';
      const wallets = c.wallets.map(w => `<span class="lens-cabal-w" data-addr="${esc(w)}" title="${esc(w)}">${short(w)}</span>`).join('');
      return `<div class="lens-cabal-card">
        <div class="lens-cabal-head">${tag}<span class="lens-cabal-n">${c.count} wallets</span>${pct}</div>
        <div class="lens-cabal-funder">funder: <span class="lens-cabal-w" data-addr="${esc(c.funder)}" title="${esc(c.funder)}">${short(c.funder)}</span></div>
        <div class="lens-cabal-wallets">${wallets}</div>
      </div>`;
    }).join('');
    const note = '<div class="lens-origin-hint">Shared funders can occasionally be exchanges — DEV-FUNDED is the high-confidence signal.</div>';
    el.innerHTML = summary + cards + note + rebtn;
    el.querySelectorAll('.lens-cabal-w').forEach(s => {
      s.style.cursor = 'pointer';
      s.onclick = () => { try { navigator.clipboard.writeText(s.getAttribute('data-addr')); const o = s.textContent; s.textContent = '✓'; setTimeout(() => { s.textContent = o; }, 800); } catch (e) {} };
    });
    wireCabalBtn();
  }

  function fetchGitHub(username, source, inferred) {
    safeSendMessage({ type: 'FETCH_GITHUB', username }, (res) => {
      const section = document.getElementById('lens-github-section');
      const l = document.getElementById('lens-github-loading');
      const d = document.getElementById('lens-github-data');
      if (!l || !d) return;
      const hideSection = () => { if (section) section.style.display = 'none'; };

      if (!res || !res.success) {
        if (inferred) { hideSection(); return; } // a guessed handle that doesn't resolve isn't worth showing
        l.style.display = 'none'; d.style.display = 'block';
        d.innerHTML = '<div class="lens-empty">GitHub unavailable</div>';
        return;
      }

      const g = res.data;
      // Handle-match guesses pointing to an empty account are likely coincidental — skip.
      if (inferred && (g.public_repos || 0) === 0 && !(g.stars > 0)) { hideSection(); return; }

      l.style.display = 'none'; d.style.display = 'block';
      const srcLabel = { link: 'profile link', website: 'website', bio: 'bio', tweet: 'tweet', handle: 'handle match' };
      const srcTag = source ? `<span class="lens-gh-src" title="How LENS found this GitHub">${srcLabel[source] || source}</span>` : '';
      d.innerHTML = `<div class="lens-gh">
        <div class="lens-gh-row">
          <span class="lens-gh-lbl">GitHub</span>
          <span style="display:flex;align-items:center;gap:6px">
            <a class="lens-gh-handle" href="https://github.com/${g.login}" target="_blank" rel="noopener">@${g.login}</a>
            ${srcTag}
          </span>
        </div>
        <div class="lens-gh-row">
          <span class="lens-gh-lbl">Activity</span>
          <span class="lens-gh-val">${g.public_repos} repos${g.stars?` · ${g.stars}`:''}${g.last_commit?` · ${g.last_commit}`:''}</span>
        </div>
        ${g.languages && g.languages.length ? `<div class="lens-gh-row">
          <span class="lens-gh-lbl">Stack</span>
          <span class="lens-gh-langs">${g.languages.slice(0,4).map(l=>`<span class="lens-lang-tag">${l}</span>`).join('')}</span>
        </div>` : ''}
      </div>`;
    });
  }

  function updateStatus(s) {
    const el = document.getElementById('lens-status');
    if (el && s==='complete') el.innerHTML = '<span class="lens-status-dot lens-dot-green"></span>COMPLETE';
  }

  // ── Watchlist: pin a dev to storage ──
  document.addEventListener('click', (e) => {
    const wb = e.target.closest('[data-lens-watch]');
    if (!wb) return;
    e.preventDefault();
    const username = wb.getAttribute('data-username') || '';
    const wallet = wb.getAttribute('data-wallet') || '';
    const tokens = parseInt(wb.getAttribute('data-tokens') || '0', 10);
    if (!username && !wallet) return;
    try {
      chrome.storage.local.get(['LENS_WATCHLIST'], (r) => {
        let wl = Array.isArray(r && r.LENS_WATCHLIST) ? r.LENS_WATCHLIST : [];
        const key = (username || wallet).toLowerCase();
        const exists = wl.find(x => (x.username || x.wallet || '').toLowerCase() === key);
        const txt = wb.querySelector('.lens-watch-txt');
        if (exists) {
          wl = wl.filter(x => (x.username || x.wallet || '').toLowerCase() !== key);
          wb.classList.remove('watched');
          if (txt) txt.textContent = 'Watch';
        } else {
          wl.unshift({ username, wallet, tokens, added: Date.now() });
          wl = wl.slice(0, 50);
          wb.classList.add('watched');
          if (txt) txt.textContent = 'Watching';
        }
        chrome.storage.local.set({ LENS_WATCHLIST: wl });
      });
    } catch (err) {}
  });

  // ── Copy address to clipboard (dev wallet, etc.) ──
  document.addEventListener('click', (e) => {
    const cp = e.target.closest('[data-lens-copy]');
    if (!cp) return;
    e.preventDefault();
    const addr = cp.getAttribute('data-lens-copy');
    if (!addr) return;
    navigator.clipboard.writeText(addr).then(() => {
      const orig = cp.innerHTML;
      cp.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#2ecc71" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      setTimeout(() => { cp.innerHTML = orig; }, 1200);
    }).catch(() => {});
  });

  // ── Share to X: build a summary tweet from the scanned profile ──
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lens-share]');
    if (!btn) return;
    e.preventDefault();
    const u = btn.getAttribute('data-username') || '';
    const tokens = parseInt(btn.getAttribute('data-tokens') || '0', 10);
    const pleasebro = parseInt(btn.getAttribute('data-pleasebro') || '0', 10);
    const claimed = btn.getAttribute('data-claimed') || '0';
    const risk = btn.getAttribute('data-risk') || '';
    const tickersRaw = btn.getAttribute('data-tickers') || '';
    const tickers = tickersRaw
      ? tickersRaw.split(',').filter(Boolean).map(t => '$' + t.replace(/^\$/, '')).join(' ')
      : '';

    const lines = [];
    lines.push(`LENS scan${u ? ` on @${u}` : ''}`);
    if (tokens > 0) lines.push(`${tokens} Bankrbot token${tokens > 1 ? 's' : ''} launched`);
    if (pleasebro > 0) lines.push(`PleaseBro on ${pleasebro} token${pleasebro > 1 ? 's' : ''}`);
    if (parseFloat(claimed) > 0) lines.push(`${claimed} ETH in fees claimed`);
    if (risk === 'high') lines.push(`Warning: high holder concentration`);
    else if (risk === 'low') lines.push(`Well-distributed holders`);
    if (tickers) lines.push(tickers);
    lines.push('');
    lines.push('See everything on-chain at https://lnsx.io');

    const text = encodeURIComponent(lines.join('\n'));
    const url = `https://twitter.com/intent/tweet?text=${text}`;
    window.open(url, '_blank', 'noopener');
  });
})();

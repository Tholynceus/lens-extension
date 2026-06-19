// LENS popup navigation + interactions.
// Must be an external file — manifest v3 CSP blocks inline <script>.

// Default state for all functional settings toggles (data-key on each .sw).
const LENS_SETTINGS_DEFAULTS = {
  show_pleasebro: true,
  show_dev_sold: true,
  show_claim: true,
  show_new_token: true,
  auto_inject: true,
  detect_ca_bio: true,
  compact_mode: false, launch_alerts: true, crowd_report: true,
  src_bankr: true,
  src_alchemy: true,
  src_github: true,
};

function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => { if (p.id.startsWith('page-')) p.classList.remove('active'); });
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  const pg = document.getElementById('page-' + name); if (pg) pg.classList.add('active');
  const nv = document.getElementById('nav-' + name); if (nv) nv.classList.add('active');
  const titles = { dashboard: 'LENS', settings: 'Settings', profile: 'Roadmap' };
  const t = document.getElementById('page-title'); if (t) t.textContent = titles[name] || 'LENS';
  if (name !== 'settings') closeSub();
}
function openSub(id) {
  const m = document.getElementById('s-menu'); if (m) m.style.display = 'none';
  document.querySelectorAll('.s-sub').forEach(s => s.classList.remove('open'));
  const sub = document.getElementById('sub-' + id); if (sub) sub.classList.add('open');
}
function closeSub() {
  document.querySelectorAll('.s-sub').forEach(s => s.classList.remove('open'));
  const m = document.getElementById('s-menu'); if (m) m.style.display = 'block';
}
function connectX() {
  const d = document.getElementById('x-disconnected'); if (d) d.style.display = 'none';
  const c = document.getElementById('x-connected');
  if (c) { c.style.display = 'flex'; c.style.flexDirection = 'column'; }
  try { chrome.storage.local.set({ X_CONNECTED: true }); } catch (e) {}
}
function disconnectX() {
  const c = document.getElementById('x-connected'); if (c) c.style.display = 'none';
  const d = document.getElementById('x-disconnected'); if (d) d.style.display = 'flex';
  try { chrome.storage.local.set({ X_CONNECTED: false }); } catch (e) {}
}

// CSP-safe event delegation (handles all data-act clicks)
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.getAttribute('data-act');
  const arg = el.getAttribute('data-arg');
  if (act === 'page') switchPage(arg);
  else if (act === 'opensub') openSub(arg);
  else if (act === 'closesub') closeSub();
  else if (act === 'connectx') connectX();
  else if (act === 'disconnectx') disconnectX();
  else if (act === 'toggle') {
    el.classList.toggle('on');
    const key = el.getAttribute('data-key');
    if (key) {
      try {
        chrome.storage.local.get(['LENS_SETTINGS'], r => {
          const s = Object.assign({}, LENS_SETTINGS_DEFAULTS, (r && r.LENS_SETTINGS) || {});
          s[key] = el.classList.contains('on');
          chrome.storage.local.set({ LENS_SETTINGS: s });
        });
      } catch (e) {}
    }
  }
  else if (act === 'refresh-stats') renderDashStats();
  else if (act === 'refresh-trending') renderTrending();
  else if (act === 'clear-watchlist') { try { chrome.storage.local.set({ LENS_WATCHLIST: [] }, renderWatchlist); } catch (e) {} }
  else if (act === 'clear-recent') { try { chrome.storage.local.set({ LENS_RECENT: [] }, renderDashStats); } catch (e) {} }
  else if (act === 'open-x') { const u = arg; if (u) { try { chrome.tabs.create({ url: 'https://x.com/' + u }); } catch (err) { window.open('https://x.com/' + u, '_blank'); } } }
});

// Render dashboard intelligence stats from storage (data tracked by content.js)
function renderDashStats() {
  try {
    chrome.storage.local.get(['LENS_STATS', 'LENS_RECENT'], (r) => {
      const stats = Object.assign({ scanned: 0, pleasebro: 0, devs: 0, trustSum: 0, trustCount: 0 }, (r && r.LENS_STATS) || {});
      const recent = (r && Array.isArray(r.LENS_RECENT)) ? r.LENS_RECENT : [];
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('stat-scanned', stats.scanned || 0);
      set('stat-pleasebro', stats.pleasebro || 0);
      set('stat-devs', stats.devs || 0);
      const avg = stats.trustCount ? Math.round(stats.trustSum / stats.trustCount) : null;
      set('stat-avgtrust', avg != null ? avg : '—');
      const sub = document.getElementById('stat-sub');
      if (sub) sub.textContent = stats.scanned ? `${stats.scanned} profiles analyzed on this device` : 'No scans yet — open an X profile';

      const list = document.getElementById('lens-recent-list');
      if (list) {
        if (!recent.length) {
          list.innerHTML = '<div class="lens-recent-empty">Profiles you scan on X will appear here.</div>';
        } else {
          list.innerHTML = recent.slice(0, 8).map(it => {
            const t = it.trust;
            const tc = t == null ? 'var(--faint)' : (t >= 70 ? '#0a8a4a' : t >= 40 ? '#d98a00' : '#e02e2e');
            const initial = (it.username || '?').slice(0, 1).toUpperCase();
            return `<div class="lens-recent-item" data-act="open-x" data-arg="${it.username}">
              <div class="lens-recent-av">${initial}</div>
              <div class="lens-recent-info">
                <div class="lens-recent-name">@${it.username}</div>
                <div class="lens-recent-meta">${it.tokens || 0} tokens${it.pleasebro ? ' · 🤝 PleaseBro' : ''}</div>
              </div>
              <div class="lens-recent-trust" style="color:${tc}">${t == null ? '—' : t}</div>
            </div>`;
          }).join('');
        }
      }
    });
  } catch (e) {}
}

renderDashStats();

// ── Trending Devs + Live Launches: fetch from backend ──
function renderTrending() {
  const list = document.getElementById('lens-trending-list');
  const live = document.getElementById('lens-live-list');
  const apiBase = 'https://lnsx.io';
  if (list) list.innerHTML = '<div class="lens-recent-empty">Loading trending devs…</div>';
  if (live) live.innerHTML = '<div class="lens-recent-empty">Loading latest launches…</div>';

  const devRow = (d) => {
    const name = d.x_username ? '@' + d.x_username : (d.deployer_wallet ? d.deployer_wallet.slice(0, 6) + '…' + d.deployer_wallet.slice(-4) : '?');
    const initial = (d.x_username || d.deployer_wallet || '?').slice(0, 1).toUpperCase();
    const meta = `${d.token_count} token${d.token_count > 1 ? 's' : ''}${d.has_new ? ' · NEW' : ''}`;
    const clickAttr = d.x_username ? `data-act="open-x" data-arg="${d.x_username}"` : '';
    const latest = d.latest_token ? `$${d.latest_token}` : '';
    return `<div class="lens-recent-item" ${clickAttr} style="cursor:${d.x_username ? 'pointer' : 'default'}">
      <div class="lens-recent-av">${initial}</div>
      <div class="lens-recent-info">
        <div class="lens-recent-name">${name}</div>
        <div class="lens-recent-meta">${meta}</div>
      </div>
      <div class="lens-recent-trust" style="color:var(--blue);font-size:10px">${latest}</div>
    </div>`;
  };

  fetch(`${apiBase}/api/trending?limit=40`)
    .then(r => r.json())
    .then(res => {
      if (!res || !res.success || !Array.isArray(res.devs) || !res.devs.length) {
        if (list) list.innerHTML = '<div class="lens-recent-empty">No trending devs right now.</div>';
        if (live) live.innerHTML = '<div class="lens-recent-empty">No recent launches.</div>';
        return;
      }
      if (list) list.innerHTML = res.devs.slice(0, 12).map(devRow).join('');
      // Live launches = devs flagged NEW (fresh <24h), else show most recent
      const liveDevs = res.devs.filter(d => d.has_new);
      const liveSet = liveDevs.length ? liveDevs : res.devs.slice(0, 6);
      if (live) live.innerHTML = liveSet.slice(0, 8).map(devRow).join('');
    })
    .catch(() => {
      if (list) list.innerHTML = '<div class="lens-recent-empty">Could not load trending.</div>';
      if (live) live.innerHTML = '<div class="lens-recent-empty">Could not load launches.</div>';
    });
}
renderTrending();

// ── Watchlist: render pinned devs from storage ──
function renderWatchlist() {
  const el = document.getElementById('lens-watchlist');
  if (!el) return;
  try {
    chrome.storage.local.get(['LENS_WATCHLIST'], (r) => {
      const wl = Array.isArray(r && r.LENS_WATCHLIST) ? r.LENS_WATCHLIST : [];
      if (!wl.length) {
        el.innerHTML = '<div class="lens-recent-empty">Pin devs from their X profile to track them here.</div>';
        return;
      }
      el.innerHTML = wl.map(w => {
        const name = w.username ? '@' + w.username : (w.wallet ? w.wallet.slice(0, 6) + '…' + w.wallet.slice(-4) : '?');
        const initial = (w.username || w.wallet || '?').slice(0, 1).toUpperCase();
        const meta = `${w.tokens || 0} token${(w.tokens || 0) > 1 ? 's' : ''} tracked`;
        const clickAttr = w.username ? `data-act="open-x" data-arg="${w.username}"` : '';
        return `<div class="lens-recent-item" ${clickAttr} style="cursor:${w.username ? 'pointer' : 'default'}">
          <div class="lens-recent-av" style="color:#ffb428;background:rgba(255,180,40,0.1)">${initial}</div>
          <div class="lens-recent-info">
            <div class="lens-recent-name">${name}</div>
            <div class="lens-recent-meta">${meta}</div>
          </div>
          <span style="font-size:12px;color:#ffb428">★</span>
        </div>`;
      }).join('');
    });
  } catch (e) {}
}
renderWatchlist();

try {
  chrome.storage.local.get(['X_CONNECTED'], r => { if (r && r.X_CONNECTED) connectX(); });
} catch (e) {}

// Apply saved toggle states to the settings UI on open.
function loadSettings() {
  try {
    chrome.storage.local.get(['LENS_SETTINGS'], r => {
      const s = Object.assign({}, LENS_SETTINGS_DEFAULTS, (r && r.LENS_SETTINGS) || {});
      document.querySelectorAll('[data-key]').forEach(el => {
        const key = el.getAttribute('data-key');
        if (key in s) el.classList.toggle('on', !!s[key]);
      });
    });
  } catch (e) {}
}
loadSettings();

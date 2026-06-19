const DEFAULTS = {
  LENS_API_URL: 'https://lnsx.io',
};

chrome.storage.local.get(['GITHUB_TOKEN', 'ALCHEMY_KEY', 'LENS_API_URL'], (result) => {
  const toSave = {};
  if (!result.LENS_API_URL) toSave.LENS_API_URL = DEFAULTS.LENS_API_URL;
  if (Object.keys(toSave).length > 0) chrome.storage.local.set(toSave);

  const lensUrl = result.LENS_API_URL || DEFAULTS.LENS_API_URL;

  const ghEl = document.getElementById('github-key');
  if (result.GITHUB_TOKEN) { if (ghEl) ghEl.value = result.GITHUB_TOKEN; setStatus('gh-status', 'dot-gh', true); }
  else setStatus('gh-status', 'dot-gh', false);

  // Alchemy now runs through the backend proxy. The field is optional —
  // only used as a personal fallback key if the user enters one.
  const alEl = document.getElementById('alchemy-key');
  if (alEl) alEl.value = result.ALCHEMY_KEY || '';
  setStatus('al-status', 'dot-al', true);

  const apiEl = document.getElementById('lens-api-url');
  if (apiEl) apiEl.value = lensUrl;
  setStatus('api-status', 'dot-api', !!lensUrl);
});

const saveBtn = document.getElementById('save-btn');
if (saveBtn) saveBtn.addEventListener('click', () => {
  const github = document.getElementById('github-key').value.trim();
  const alchemy = document.getElementById('alchemy-key').value.trim();
  const lensApi = document.getElementById('lens-api-url').value.trim();
  const toSave = {};
  if (github) toSave.GITHUB_TOKEN = github;
  if (alchemy) toSave.ALCHEMY_KEY = alchemy;
  if (lensApi) toSave.LENS_API_URL = lensApi;
  chrome.storage.local.set(toSave, () => {
    const s = document.getElementById('save-status');
    s.style.display = 'block';
    setTimeout(() => s.style.display = 'none', 2000);
    if (github) setStatus('gh-status', 'dot-gh', true);
    if (alchemy) setStatus('al-status', 'dot-al', true);
    if (lensApi) setStatus('api-status', 'dot-api', true);
  });
});

function setStatus(valId, dotId, ok) {
  const val = document.getElementById(valId);
  const dot = document.getElementById(dotId);
  if (val) { val.textContent = ok ? 'Connected' : 'Not set'; val.className = 'sr-val dsr-val ' + (ok ? 'ok' : 'no'); }
  if (dot) { dot.className = 'sr-dot dsr-dot ' + (ok ? 'ok' : 'no'); }
}

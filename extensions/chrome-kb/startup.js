/* Runs before parsing the UI. MV3 requires this tiny first-paint script to be external. */
(() => {
  const root = document.documentElement;
  try {
    const scheme = localStorage.getItem('kb-first-paint-scheme');
    if (scheme === 'light' || scheme === 'dark') {
      root.dataset.colorScheme = scheme;
      document.querySelector('meta[name="color-scheme"]').content = scheme;
    }
  } catch { /* Blocked cache storage must never block the page. */ }
  try {
    const preview = JSON.parse(localStorage.getItem('kb-first-paint-background') || 'null');
    if (preview?.assetVersion === 2 && typeof preview.image === 'string' && preview.image.length < 32768 && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(preview.image)) {
      root.style.setProperty('--startup-wallpaper', `url("${preview.image}")`);
      root.style.setProperty('--startup-position', ['center','top','bottom'].includes(preview.position) ? preview.position : 'center');
    }
  } catch { /* Invalid or unavailable previews simply use the saved scheme. */ }
  root.dataset.startup = 'pending';
  let finished = false;
  const timer = setTimeout(finish, 4000);
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    delete root.dataset.startup;
    performance.mark('kb:first-view-ready');
  }
  window.kbStartup = {finish};
})();

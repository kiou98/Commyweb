// Run before page scripts. The invitation is kept in the extension's isolated world,
// then removed from the address bar before the website can read it.
(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has('commyweb_config') && !params.has('commyweb_focus')) return;
  window.__commywebInitialHash = location.hash;
  history.replaceState(history.state, '', location.pathname + location.search);
})();

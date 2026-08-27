// Production-only UI guard. Demo media is not shipped in this deployment, so
// do not expose a control that can only fail. The observer is intentionally
// narrow and removes itself after the first matching control is found.
(() => {
  const hideUnavailableDemo = () => {
    for (const button of document.querySelectorAll('button')) {
      if (button.textContent.trim() === 'Load demo assets') {
        button.hidden = true;
        button.setAttribute('aria-hidden', 'true');
        return true;
      }
    }
    return false;
  };

  if (hideUnavailableDemo()) return;
  const observer = new MutationObserver(() => {
    if (hideUnavailableDemo()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

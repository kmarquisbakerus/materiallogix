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
  observer.observe(document.documentElement, { childList:true, subtree:true });
})();

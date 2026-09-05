(() => {
  const root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  const header = document.querySelector('[data-header]');
  const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 12);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
})();

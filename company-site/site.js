(() => {
  document.documentElement.classList.remove('no-js');
  document.documentElement.classList.add('js');

  const header = document.querySelector('[data-header]');
  const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 20);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  document.querySelectorAll('.reveal').forEach((item) => {
    item.classList.add('is-visible');
    item.style.opacity = '1';
    item.style.transform = 'none';
    item.style.transition = 'none';
  });
})();

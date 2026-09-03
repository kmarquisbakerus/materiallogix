(() => {
  document.documentElement.classList.remove('no-js');
  document.documentElement.classList.add('js');

  const header = document.querySelector('[data-header]');
  const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 24);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  const revealItems = [...document.querySelectorAll('.reveal')];
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -7% 0px' });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  const consoleRoot = document.querySelector('[data-console]');
  const rows = [...document.querySelectorAll('.console-row')];
  const word = document.querySelector('[data-console-word]');
  const category = document.querySelector('[data-console-category]');
  const index = document.querySelector('.console-index');
  let active = 0;
  let timer;

  const selectRow = (next) => {
    active = (next + rows.length) % rows.length;
    rows.forEach((row, rowIndex) => row.classList.toggle('is-active', rowIndex === active));
    const row = rows[active];
    if (!row || !word || !category || !index) return;
    word.style.opacity = '0';
    word.style.transform = 'translateY(10px)';
    window.setTimeout(() => {
      word.textContent = row.dataset.name || '';
      category.textContent = row.dataset.category || '';
      index.textContent = row.dataset.index || '';
      word.style.opacity = '1';
      word.style.transform = 'translateY(0)';
    }, 130);
  };

  const startRotation = () => {
    window.clearInterval(timer);
    timer = window.setInterval(() => selectRow(active + 1), 3400);
  };

  rows.forEach((row, rowIndex) => {
    row.addEventListener('mouseenter', () => selectRow(rowIndex));
    row.addEventListener('focus', () => selectRow(rowIndex));
  });
  consoleRoot?.addEventListener('mouseenter', () => window.clearInterval(timer));
  consoleRoot?.addEventListener('mouseleave', startRotation);
  startRotation();
})();

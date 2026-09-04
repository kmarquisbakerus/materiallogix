(() => {
  const root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  const header = document.querySelector('[data-header]');
  const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 20);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  const items = [...document.querySelectorAll('.reveal')];
  const show = (item) => item.classList.add('is-visible');
  const showAll = () => items.forEach(show);

  const stillMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (stillMotion || typeof IntersectionObserver !== 'function') {
    showAll();
    return;
  }

  // Any visible pixel counts. Requiring a fraction of the element left tall
  // blocks unrevealed when an in-page anchor scrolled past them, which on a
  // phone landed a reader on a Governance section whose status disclosure was
  // blank.
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      show(entry.target);
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -4% 0px', threshold: 0 });

  items.forEach((item) => observer.observe(item));

  // An anchor jump moves the page faster than intersection callbacks settle,
  // so reveal the destination outright rather than animating it in late.
  const showHashTarget = () => {
    if (!location.hash) return;
    let target = null;
    try {
      target = document.querySelector(location.hash);
    } catch {
      return; // a hash that is not a valid selector is not ours to resolve
    }
    if (!target) return;
    if (target.classList.contains('reveal')) show(target);
    target.querySelectorAll('.reveal').forEach(show);
  };
  showHashTarget();
  window.addEventListener('hashchange', showHashTarget);

  // Last resort. Nothing on this page may stay invisible because a browser did
  // not deliver an intersection callback; the content matters more than the
  // animation does.
  window.setTimeout(showAll, 4000);
})();

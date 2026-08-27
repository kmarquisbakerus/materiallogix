// Shared MaterialLogix Studio product navigation.
// The selector is deliberately separate from the project selector: one chooses
// the Studio service, the other chooses the user's current project.

const select = document.querySelector('#studioServiceSelect');
if (select) {
  const here = location.pathname.toLowerCase();
  select.value = here.endsWith('/voice.html') || here.endsWith('/voice') ? 'voice' : 'review';

  select.addEventListener('change', () => {
    const query = location.search || '';
    const hash = location.hash || '';
    const target = select.value === 'voice' ? `voice.html${query}${hash}` : `index.html${query}${hash}`;
    location.href = target;
  });
}

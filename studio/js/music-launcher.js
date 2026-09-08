// Music loads only when asked for; the existing workspace and layout stay intact.
for (const button of document.querySelectorAll('[data-open-music]')) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const { openMusicStudio } = await import('./music-studio.js');
      button.closest('details')?.removeAttribute('open'); openMusicStudio();
    } catch {
      button.textContent = 'Music could not open — retry';
    } finally { button.disabled = false; }
  });
}

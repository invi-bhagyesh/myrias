// Set the chosen palette and saved light/dark mode before the first paint.
(() => {
  document.documentElement.dataset.palette = 'teal';
  let theme;
  try { theme = localStorage.getItem('myrias-theme'); } catch { /* Storage may be unavailable. */ }
  document.documentElement.dataset.theme = ['light', 'dark'].includes(theme) ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();

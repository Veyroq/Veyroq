document.addEventListener('DOMContentLoaded', () => {
  if (!window.location.hostname.endsWith('veyroq.xyz')) return;
  document.querySelectorAll('a[href="/"]').forEach(link => {
    link.setAttribute('href', 'https://veyroq.xyz');
  });
  document.querySelectorAll('a[href="/console"]').forEach(link => {
    link.setAttribute('href', 'https://app.veyroq.xyz');
  });
  document.querySelectorAll('a[href="/docs"]').forEach(link => {
    link.setAttribute('href', 'https://docs.veyroq.xyz');
  });
  document.querySelectorAll('a[href^="/legal/"]').forEach(link => {
    link.setAttribute('href', `https://docs.veyroq.xyz${link.getAttribute('href')}`);
  });
});

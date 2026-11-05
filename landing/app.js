// Veyroq Landing Page — Micro-Interactions & Navigation Engine
// Unslop & Ponytail Compliant: Minimal, performant, zero bloat

document.addEventListener('DOMContentLoaded', () => {
  // ─── 1. Navbar Scroll Effect ──────────────────────────────────────────
  const navbar = document.getElementById('main-nav');
  let lastScroll = 0;

  window.addEventListener('scroll', () => {
    const currentScroll = window.scrollY;
    if (currentScroll > 40) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }

    if (currentScroll > lastScroll && currentScroll > 140) {
      navbar.style.transform = 'translateY(-100%)';
    } else {
      navbar.style.transform = 'translateY(0)';
    }
    lastScroll = currentScroll;
  }, { passive: true });

  // ─── 2. Smooth Scroll for Anchor Links ────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const offset = 80;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  // ─── 3. Auditor Stamp Micro-Interaction ───────────────────────────────
  const stamp = document.querySelector('.auditor-stamp');
  if (stamp) {
    stamp.addEventListener('mouseenter', () => {
      stamp.style.transform = 'rotate(-1deg) scale(1.04)';
      stamp.style.transition = 'transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)';
    });
    stamp.addEventListener('mouseleave', () => {
      stamp.style.transform = 'rotate(-3deg) scale(1)';
    });
  }

  // ─── 4. Production Subdomain Routing (app.veyroq.xyz & docs.veyroq.xyz) ───
  if (window.location.hostname.endsWith('veyroq.xyz')) {
    document.querySelectorAll('a[href="/console"]').forEach(link => {
      link.setAttribute('href', 'https://app.veyroq.xyz');
    });
    document.querySelectorAll('a[href="/docs"]').forEach(link => {
      link.setAttribute('href', 'https://docs.veyroq.xyz');
    });
  }
});

// Veyroq Documentation Interactive Architecture
// Modeled directly on Tower Exchange (docs.tower.exchange) and Arc Docs (docs.arc.io)
// Features: Client-side Page Router, Previous/Next Pagination, Dynamic "ON THIS PAGE" TOC, ⌘K Command Palette

document.addEventListener('DOMContentLoaded', () => {

  // ─── 1. Page Registry & Order ──────────────────────────────────────────
  const DOC_PAGES = [
    { id: 'overview', title: 'Protocol Overview', category: 'Overview' },
    { id: 'architecture', title: 'Architecture & Enclaves', category: 'Overview' },
    { id: 'zero-custody', title: 'Zero-Custody Guarantee', category: 'Overview' },
    { id: 'quickstart', title: 'CFO Quickstart', category: 'Getting Started' },
    { id: 'view-keys', title: 'Scoped View Keys', category: 'Getting Started' },
    { id: 'merkle-proofs', title: 'Merkle Proofs & Tree', category: 'Cryptography' },
    { id: 'onchain-verification', title: 'On-Chain Verification', category: 'Cryptography' },
    { id: 'contract-spec', title: 'VeyroqRegistry.sol Spec', category: 'Smart Contracts' },
    { id: 'foundry-tests', title: 'Foundry Test Suite', category: 'Smart Contracts' },
    { id: 'gaap-export', title: 'GAAP / IFRS Worksheets', category: 'Tax & Compliance' },
    { id: 'quickbooks', title: 'QuickBooks & Xero Exports', category: 'Tax & Compliance' }
  ];

  let currentPageId = 'overview';

  // ─── 2. Switch Page Function ───────────────────────────────────────────
  function switchPage(pageId, pushState = true, targetHeadingId = null) {
    const pageIndex = DOC_PAGES.findIndex(p => p.id === pageId);
    if (pageIndex === -1) {
      pageId = 'overview';
    }

    currentPageId = pageId;
    const pageMeta = DOC_PAGES.find(p => p.id === pageId);

    // 1. Hide all pages, show target page
    document.querySelectorAll('.doc-page').forEach(page => {
      page.classList.remove('active');
    });
    const activePageEl = document.getElementById(`page-${pageId}`);
    if (activePageEl) {
      activePageEl.classList.add('active');
    }

    // 2. Update Sidebar active menu item
    document.querySelectorAll('.menu-item').forEach(item => {
      item.classList.remove('active');
      if (item.getAttribute('data-page') === pageId) {
        item.classList.add('active');
      }
    });

    // 3. Update Breadcrumb
    const crumbCat = document.getElementById('crumb-category');
    const crumbTitle = document.getElementById('crumb-title');
    if (crumbCat && pageMeta) crumbCat.textContent = pageMeta.category;
    if (crumbTitle && pageMeta) crumbTitle.textContent = pageMeta.title;

    // 4. Update Document Title & Self-Referencing Canonical
    document.title = `${pageMeta.title} — Veyroq Documentation`;
    const canonicalEl = document.getElementById('docs-canonical');
    if (canonicalEl) {
      canonicalEl.href = pageId === 'overview'
        ? 'https://docs.veyroq.xyz/'
        : `https://docs.veyroq.xyz/docs/${pageId}`;
    }

    // 5. Update Previous / Next Pagination Cards (Tower Exchange Style)
    const prevBtn = document.getElementById('pagination-prev');
    const nextBtn = document.getElementById('pagination-next');
    const prevTitle = document.getElementById('prev-page-title');
    const nextTitle = document.getElementById('next-page-title');

    const currentIndex = DOC_PAGES.findIndex(p => p.id === pageId);

    if (currentIndex > 0) {
      const prevPage = DOC_PAGES[currentIndex - 1];
      if (prevBtn && prevTitle) {
        prevBtn.style.visibility = 'visible';
        prevBtn.style.pointerEvents = 'auto';
        prevTitle.textContent = prevPage.title;
        prevBtn.onclick = (e) => {
          e.preventDefault();
          switchPage(prevPage.id);
        };
      }
    } else if (prevBtn) {
      prevBtn.style.visibility = 'hidden';
      prevBtn.style.pointerEvents = 'none';
    }

    if (currentIndex < DOC_PAGES.length - 1) {
      const nextPage = DOC_PAGES[currentIndex + 1];
      if (nextBtn && nextTitle) {
        nextBtn.style.visibility = 'visible';
        nextBtn.style.pointerEvents = 'auto';
        nextTitle.textContent = nextPage.title;
        nextBtn.onclick = (e) => {
          e.preventDefault();
          switchPage(nextPage.id);
        };
      }
    } else if (nextBtn) {
      nextBtn.style.visibility = 'hidden';
      nextBtn.style.pointerEvents = 'none';
    }

    // 6. Build Dynamic "ON THIS PAGE" TOC for the active document
    buildTableOfContents(activePageEl);

    // 7. Update URL with pushState
    if (pushState) {
      const onDocsHost = window.location.hostname.startsWith('docs.');
      const newUrl = pageId === 'overview' ? (onDocsHost ? '/' : '/docs') : `/docs/${pageId}`;
      window.history.pushState({ pageId }, '', newUrl);
    }

    // 8. Scroll to specific heading or top
    if (targetHeadingId) {
      const targetEl = document.getElementById(targetHeadingId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Close mobile sidebar if open
    const sidebar = document.getElementById('docs-sidebar');
    if (sidebar) sidebar.classList.remove('mobile-open');
  }

  // ─── 3. Dynamic "ON THIS PAGE" Table of Contents ────────────────────────
  function buildTableOfContents(pageEl) {
    const tocNav = document.getElementById('toc-nav');
    if (!tocNav || !pageEl) return;

    tocNav.innerHTML = '';
    const headings = pageEl.querySelectorAll('h2, h3');

    if (headings.length === 0) {
      tocNav.innerHTML = `<span class="toc-empty">Overview</span>`;
      return;
    }

    headings.forEach((h, idx) => {
      // Ensure heading has an ID
      if (!h.id) {
        h.id = 'heading-' + idx;
      }

      const a = document.createElement('a');
      a.href = `#${h.id}`;
      a.className = `toc-link ${h.tagName.toLowerCase() === 'h3' ? 'toc-sub' : ''}`;
      a.textContent = h.textContent.replace(/^[0-9.]+\s*/, ''); // Clean numbering prefix if any

      a.addEventListener('click', (e) => {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });

        document.querySelectorAll('.toc-link').forEach(l => l.classList.remove('active'));
        a.classList.add('active');
      });

      tocNav.appendChild(a);
    });

    setupTocScrollSpy(headings);
  }

  function setupTocScrollSpy(headings) {
    if (!headings || headings.length === 0) return;

    const onScroll = () => {
      let currentHeadingId = '';
      const scrollPos = window.scrollY + 100;

      headings.forEach(h => {
        if (scrollPos >= h.offsetTop) {
          currentHeadingId = h.id;
        }
      });

      if (currentHeadingId) {
        document.querySelectorAll('.toc-link').forEach(link => {
          link.classList.remove('active');
          if (link.getAttribute('href') === `#${currentHeadingId}`) {
            link.classList.add('active');
          }
        });
      }
    };

    window.removeEventListener('scroll', window._currentTocScrollHandler);
    window._currentTocScrollHandler = onScroll;
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ─── 4. Initial URL Path Resolution ────────────────────────────────────
  function resolveInitialRoute() {
    const path = window.location.pathname.replace(/\/+$/, ''); // Strip trailing slash
    const parts = path.split('/').filter(Boolean);

    let targetPage = 'overview';

    if (parts.length >= 2 && parts[0] === 'docs') {
      const sub = parts[1];
      if (DOC_PAGES.some(p => p.id === sub)) {
        targetPage = sub;
      }
    } else if (window.location.hash) {
      const hashId = window.location.hash.replace('#', '');
      if (DOC_PAGES.some(p => p.id === hashId)) {
        targetPage = hashId;
      }
    }

    switchPage(targetPage, false);
  }

  // Handle browser Back / Forward buttons
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.pageId) {
      switchPage(e.state.pageId, false);
    } else {
      resolveInitialRoute();
    }
  });

  // Attach click handlers to all sidebar menu items
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const pageId = item.getAttribute('data-page');
      if (pageId) switchPage(pageId);
    });
  });

  resolveInitialRoute();

  // ─── 5. Code Block Copy Buttons ────────────────────────────────────────
  document.querySelectorAll('pre').forEach((pre) => {
    if (!pre.parentElement.classList.contains('code-wrapper')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'code-wrapper';
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-copy-code';
      copyBtn.setAttribute('title', 'Copy code to clipboard');
      copyBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>Copy</span>
      `;

      copyBtn.addEventListener('click', async () => {
        const codeText = pre.querySelector('code') ? pre.querySelector('code').innerText : pre.innerText;
        try {
          await navigator.clipboard.writeText(codeText);
          copyBtn.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span style="color:#10b981;">Copied!</span>
          `;
          setTimeout(() => {
            copyBtn.innerHTML = `
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            `;
          }, 2000);
        } catch (err) {
          console.error("Clipboard copy failed: ", err);
        }
      });

      wrapper.appendChild(copyBtn);
    }
  });

  // ─── 6. Command Palette / Search Modal (⌘K / Ctrl+K) ───────────────────
  const searchModal = document.getElementById('search-modal');
  const searchTriggerBtn = document.getElementById('search-trigger-btn');
  const searchCloseBtn = document.getElementById('search-close-btn');
  const searchInput = document.getElementById('command-search-input');
  const searchResultsList = document.getElementById('search-results-list');

  // Build Comprehensive Search Index across all pages and headings
  const SEARCH_INDEX = [];
  DOC_PAGES.forEach(page => {
    const pageEl = document.getElementById(`page-${page.id}`);
    if (!pageEl) return;

    // Add main page entry
    SEARCH_INDEX.push({
      pageId: page.id,
      headingId: null,
      title: page.title,
      category: page.category,
      text: pageEl.textContent.slice(0, 300).replace(/\s+/g, ' ')
    });

    // Add all section headings
    pageEl.querySelectorAll('h2, h3').forEach(h => {
      const nextP = h.nextElementSibling;
      const snippet = nextP ? nextP.textContent.slice(0, 160) : '';
      SEARCH_INDEX.push({
        pageId: page.id,
        headingId: h.id,
        title: h.textContent,
        category: `${page.category} › ${page.title}`,
        text: snippet
      });
    });
  });

  function openSearchModal() {
    if (!searchModal) return;
    searchModal.classList.add('open');
    searchModal.setAttribute('aria-hidden', 'false');
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
      renderSearchResults('');
    }
    document.body.style.overflow = 'hidden';
  }

  function closeSearchModal() {
    if (!searchModal) return;
    searchModal.classList.remove('open');
    searchModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (searchTriggerBtn) searchTriggerBtn.addEventListener('click', openSearchModal);
  if (searchCloseBtn) searchCloseBtn.addEventListener('click', closeSearchModal);

  // Close when clicking modal backdrop
  if (searchModal) {
    searchModal.addEventListener('click', (e) => {
      if (e.target === searchModal) closeSearchModal();
    });
  }

  // Keyboard shortcut listener (Cmd+K or Ctrl+K or Esc)
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (searchModal && searchModal.classList.contains('open')) {
        closeSearchModal();
      } else {
        openSearchModal();
      }
    } else if (e.key === 'Escape' && searchModal && searchModal.classList.contains('open')) {
      closeSearchModal();
    }
  });

  // Render live search results
  function renderSearchResults(query) {
    if (!searchResultsList) return;
    const cleanQuery = query.toLowerCase().trim();

    let matches = [];
    if (!cleanQuery) {
      // Show top recommended quick links when empty
      matches = SEARCH_INDEX.slice(0, 6);
    } else {
      matches = SEARCH_INDEX.filter(item => {
        return item.title.toLowerCase().includes(cleanQuery) ||
               item.text.toLowerCase().includes(cleanQuery) ||
               item.category.toLowerCase().includes(cleanQuery);
      }).slice(0, 10);
    }

    if (matches.length === 0) {
      searchResultsList.innerHTML = `
        <div class="search-no-results">
          <p>No documentation found for "<strong>${escapeHtml(query)}</strong>"</p>
          <span>Try searching for "view keys", "merkle", "quickstart", or "GAAP"</span>
        </div>
      `;
      return;
    }

    searchResultsList.innerHTML = matches.map((item, index) => `
      <div class="search-result-item ${index === 0 ? 'selected' : ''}" data-page="${item.pageId}" data-heading="${item.headingId || ''}">
        <div class="result-header">
          <span class="result-category">${item.category}</span>
          <span class="result-action">Jump to ↵</span>
        </div>
        <div class="result-title">${highlightMatch(item.title, cleanQuery)}</div>
        ${item.text ? `<div class="result-snippet">${highlightMatch(item.text, cleanQuery)}</div>` : ''}
      </div>
    `).join('');

    // Bind click events on search results
    searchResultsList.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const pageId = el.getAttribute('data-page');
        const headingId = el.getAttribute('data-heading');
        closeSearchModal();
        switchPage(pageId, true, headingId || null);
      });
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderSearchResults(e.target.value);
    });

    // Arrow keys to navigate results inside command palette
    searchInput.addEventListener('keydown', (e) => {
      const items = Array.from(searchResultsList.querySelectorAll('.search-result-item'));
      if (items.length === 0) return;

      let selectedIndex = items.findIndex(el => el.classList.contains('selected'));

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[selectedIndex]?.classList.remove('selected');
        selectedIndex = (selectedIndex + 1) % items.length;
        items[selectedIndex]?.classList.add('selected');
        items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[selectedIndex]?.classList.remove('selected');
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        items[selectedIndex]?.classList.add('selected');
        items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = items[selectedIndex] || items[0];
        if (selected) {
          const pageId = selected.getAttribute('data-page');
          const headingId = selected.getAttribute('data-heading');
          closeSearchModal();
          switchPage(pageId, true, headingId || null);
        }
      }
    });
  }

  // ─── 7. Mobile Sidebar Toggle ──────────────────────────────────────────
  const mobileToggle = document.getElementById('mobile-sidebar-toggle');
  const sidebar = document.getElementById('docs-sidebar');
  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });
  }

  // Utility helpers
  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escapeHtml(text).replace(regex, '<mark>$1</mark>');
  }

  // ─── 8. Production Subdomain Routing (app.veyroq.xyz / veyroq.xyz) ────
  if (window.location.hostname.endsWith('veyroq.xyz')) {
    document.querySelectorAll('a[href="/console"]').forEach(link => {
      link.setAttribute('href', 'https://app.veyroq.xyz');
    });
    document.querySelectorAll('a[href="/"]').forEach(link => {
      link.setAttribute('href', 'https://veyroq.xyz');
    });
    document.querySelectorAll('a[href="/docs"]').forEach(link => {
      link.setAttribute('href', 'https://docs.veyroq.xyz');
    });
    document.querySelectorAll('a[href^="/legal/"]').forEach(link => {
      link.setAttribute('href', `https://docs.veyroq.xyz${link.getAttribute('href')}`);
    });
  }

});

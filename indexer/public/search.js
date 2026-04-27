'use strict';

var API_BASE = '/api';
var PAGE_SIZE = 50;

// Pagination state
var currentOffset = 0;
var currentMode = 'recent'; // 'recent' or 'search'
var currentQuery = '';
var currentChain = '';
var lastResultCount = 0;

var EXPLORERS = {
  ethereum: 'https://etherscan.io',
  polygon: 'https://polygonscan.com',
  arbitrum: 'https://arbiscan.io'
};

// === Load stats ===
async function loadStats() {
  try {
    var res = await fetch(API_BASE + '/stats');
    var data = await res.json();
    document.getElementById('stats').innerHTML =
      '<strong>' + data.total_documents + '</strong> documents indexed';
  } catch (e) { /* silent */ }
}

// === Search ===
async function doSearch(offset) {
  // Only read from input on a fresh search (offset 0 or undefined)
  if (!offset) {
    currentQuery = document.getElementById('search-input').value.trim();
    currentChain = document.getElementById('chain-filter').value;
  }
  currentMode = 'search';
  currentOffset = offset || 0;

  var url = API_BASE + '/search?limit=' + PAGE_SIZE + '&offset=' + currentOffset;
  if (currentQuery) url += '&q=' + encodeURIComponent(currentQuery);
  if (currentChain) url += '&chain=' + encodeURIComponent(currentChain);

  document.getElementById('content').innerHTML = '<div class="empty">Searching…</div>';

  try {
    var res = await fetch(url);
    var data = await res.json();
    lastResultCount = data.results ? data.results.length : 0;
    renderDocList(data.results);
  } catch (e) {
    document.getElementById('content').innerHTML = '<div class="empty">Search failed. Please try again.</div>';
  }
}

// === Load recent ===
async function loadRecent(offset) {
  currentMode = 'recent';
  currentOffset = offset || 0;
  currentQuery = '';
  currentChain = '';

  try {
    var res = await fetch(API_BASE + '/recent?limit=' + PAGE_SIZE + '&offset=' + currentOffset);
    var data = await res.json();
    lastResultCount = data.results ? data.results.length : 0;
    renderDocList(data.results);
  } catch (e) {
    document.getElementById('content').innerHTML = '<div class="empty">Could not load documents.</div>';
  }
}

// === Render document list ===
function renderDocList(docs) {
  if (!docs || docs.length === 0) {
    if (currentOffset > 0) {
      document.getElementById('content').innerHTML = '<div class="empty">No more documents.</div>' +
        '<div class="pagination"><button data-action="prev-page">← Previous</button></div>';
    } else {
      document.getElementById('content').innerHTML = '<div class="empty">No documents found.</div>';
    }
    return;
  }

  var html = '<div class="doc-list">' + docs.map(function(doc) {
    var date = new Date(doc.first_seen).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
    var tags = (doc.tags || []).map(function(t) { return '<span class="doc-tag">' + esc(t) + '</span>'; }).join('');
    var chainLabel = doc.chain.charAt(0).toUpperCase() + doc.chain.slice(1);
    var completeness = doc.is_complete ? '' : ' · <span style="color:var(--danger)">incomplete</span>';

    return '<div class="doc-card" data-chain="' + esc(doc.chain) + '" data-docid="' + esc(doc.doc_id) + '">' +
      '<div class="doc-title">' + esc(doc.title) + '</div>' +
      '<div class="doc-meta">' +
        '<span>' + chainLabel + '</span>' +
        '<span>' + date + '</span>' +
        '<span>' + doc.total_chunks + ' chunk(s)' + completeness + '</span>' +
      '</div>' +
      (tags ? '<div class="doc-tags">' + tags + '</div>' : '') +
      '<div class="doc-preview">' + esc(doc.preview || '') + '</div>' +
    '</div>';
  }).join('') + '</div>';

  // Pagination controls — only show if there are multiple pages
  var pageNum = Math.floor(currentOffset / PAGE_SIZE) + 1;
  var hasPrev = currentOffset > 0;
  var hasNext = lastResultCount >= PAGE_SIZE;
  var paginationHtml = '';

  if (hasPrev || hasNext) {
    paginationHtml = '<div class="pagination">' +
      '<button data-action="prev-page"' + (hasPrev ? '' : ' disabled') + '>← Previous</button>' +
      '<span>Page ' + pageNum + '</span>' +
      '<button data-action="next-page"' + (hasNext ? '' : ' disabled') + '>Next →</button>' +
      '</div>';
  }

  document.getElementById('content').innerHTML = html + paginationHtml;
}

// === Pagination navigation ===
function goPage(direction) {
  var newOffset = currentOffset + (direction * PAGE_SIZE);
  if (newOffset < 0) newOffset = 0;
  if (currentMode === 'search') {
    doSearch(newOffset);
  } else {
    loadRecent(newOffset);
  }
  window.scrollTo(0, 0);
}

// === Back to list (preserves current page) ===
function goBackToList() {
  if (currentMode === 'search') {
    doSearch(currentOffset);
  } else {
    loadRecent(currentOffset);
  }
}

// === View single document ===
async function viewDoc(chain, docId) {
  document.getElementById('content').innerHTML = '<div class="empty">Loading document…</div>';

  try {
    var res = await fetch(API_BASE + '/document/' + chain + '/' + docId);
    var doc = await res.json();

    if (doc.error) {
      document.getElementById('content').innerHTML = '<div class="empty">' + esc(doc.error) + '</div>';
      return;
    }

    var explorer = EXPLORERS[chain] || '';
    var date = new Date(doc.first_seen).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    var tags = (doc.tags || []).map(function(t) { return '<span class="doc-tag">' + esc(t) + '</span>'; }).join('');
    var txLinks = (doc.transactions || []).map(function(tx) {
      return '<a href="' + tx.explorer_url + '" target="_blank" rel="noopener noreferrer">' +
      tx.tx_hash.substring(0, 14) + '…' + tx.tx_hash.substring(58) + ' ↗</a> (' + tx.chunk + ')';
    }).join('<br>');

    var contentHtml = '';
    if (doc.notice) {
      contentHtml = '<div class="notice">' + esc(doc.notice) + '</div>';
    } else if (doc.content && typeof marked !== 'undefined') {
      // Sanitize: escape HTML tags in content BEFORE markdown rendering
      // This prevents XSS from user-uploaded <script> tags while
      // preserving Markdown formatting (headers, bold, lists, code, etc.)
      var sanitized = doc.content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      contentHtml = '<div class="doc-content">' + sanitizeImages(marked.parse(sanitized)) + '</div>';
    } else if (doc.content) {
      contentHtml = '<div class="doc-content"><pre>' + esc(doc.content) + '</pre></div>';
    }

    // Store data for download
    var dlTags = (doc.tags || []).map(function(t) { return esc(t); });
    var dlTxLinks = (doc.transactions || []).map(function(tx) {
      return '<a href="' + tx.explorer_url + '">' + tx.tx_hash + '</a>';
    });
    window._dlData = {
      title: doc.title, tags: dlTags, chain: chain.charAt(0).toUpperCase() + chain.slice(1),
      date: date, docId: doc.doc_id, uploader: doc.uploader, txLinks: dlTxLinks, contentHtml: contentHtml
    };

    var html = '<button class="back-btn" data-action="back">← Back to list</button>' +
      '<button class="dl-btn" data-action="download">↓ Download</button>' +
      '<div class="doc-view">' +
        '<h2>' + esc(doc.title) + '</h2>' +
        (tags ? '<div class="doc-tags" style="margin-bottom:12px">' + tags + '</div>' : '') +
        '<div class="doc-view-meta">' +
          '<span>Chain: ' + chain.charAt(0).toUpperCase() + chain.slice(1) + '</span>' +
          '<span>Date: ' + date + '</span>' +
          '<span>DOC-ID: <code>' + esc(doc.doc_id) + '</code></span>' +
          '<span>Uploader: <code>' + esc(doc.uploader) + '</code></span>' +
          '<span>Chunks: ' + doc.found_chunks + '/' + doc.total_chunks +
            (doc.is_complete ? '' : ' <span style="color:var(--danger)">(incomplete)</span>') + '</span>' +
          '<span>Transactions:<br>' + txLinks + '</span>' +
        '</div>' +
        contentHtml +
      '</div>';

    document.getElementById('content').innerHTML = html;
  } catch (e) {
    document.getElementById('content').innerHTML = '<div class="empty">Failed to load document.</div>';
  }
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Sanitize image src attributes in rendered HTML.
// Only data:image/jpeg and data:image/png Base64 URIs are allowed.
// Blocks: external URLs (http/https), data:text/html, javascript:, and all other schemes.
// Uses prefix check only — O(1) per image regardless of Base64 size.
function sanitizeImages(html) {
  return html.replace(/<img\s+([^>]*)>/gi, function(fullMatch, attrs) {
    var srcMatch = attrs.match(/src="([^"]*)"/i);
    if (!srcMatch) return fullMatch;
    var src = srcMatch[1];
    if (/^data:image\/(jpeg|png);base64,/.test(src)) {
      return fullMatch; // Safe: allowed data URI
    }
    // Block everything else — replace src with empty string
    return fullMatch.replace(/src="[^"]*"/, 'src=""');
  });
}

// Download document as self-contained HTML file
function downloadDocument() {
  var d = window._dlData;
  if (!d) return;
  var tagsHtml = d.tags.length > 0
    ? '<div class="tags">' + d.tags.map(function(t) { return '<span class="tag">' + t + '</span>'; }).join('') + '</div>'
    : '';
  var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
    '<title>' + esc(d.title) + ' — The Permanent Library</title>\n<style>\n' +
    'body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:20px;background-color:#f8f6f1;color:#2c2416;line-height:1.8}' +
    'h1{font-size:26px;border-bottom:2px solid #d4a04a;padding-bottom:8px;margin-bottom:16px}' +
    '.meta{font-family:system-ui,sans-serif;font-size:12px;color:#666;margin-bottom:24px;padding:12px 16px;background:#f5f5f0;border-radius:6px}' +
    '.meta div{margin:4px 0}.meta code{font-size:11px;color:#444;word-break:break-all}.meta a{color:#8b6914}' +
    '.tags{margin:8px 0 16px}.tag{display:inline-block;padding:2px 8px;background:#e8e4d8;border-radius:4px;font-size:11px;color:#8b6914;margin:2px 4px 2px 0;font-family:system-ui,sans-serif}' +
    '.doc-content img{max-width:100%;height:auto;border-radius:4px;margin:12px 0;display:block;border:1px solid #ddd}' +
    '.doc-content h1{font-size:24px;margin:20px 0 10px}.doc-content h2{font-size:20px;margin:16px 0 8px}' +
    '.doc-content h3{font-size:17px;margin:14px 0 6px}.doc-content p{margin:8px 0}.doc-content a{color:#8b6914}' +
    '.doc-content strong{color:#111}.doc-content code{background:#f0ede4;padding:2px 5px;border-radius:3px;font-family:Consolas,monospace;font-size:13px}' +
    '.doc-content pre{background:#f0ede4;padding:16px;border-radius:6px;overflow-x:auto;margin:12px 0}' +
    '.doc-content pre code{background:none;padding:0}' +
    '.doc-content blockquote{border-left:3px solid #d4a04a;padding-left:16px;color:#666;margin:12px 0}' +
    '.doc-content ul,.doc-content ol{padding-left:24px;margin:8px 0}' +
    '.doc-content table{width:100%;border-collapse:collapse;margin:12px 0}' +
    '.doc-content th,.doc-content td{border:1px solid #ddd;padding:8px 12px;text-align:left;font-size:13px}' +
    '.doc-content th{background:#f5f5f0}' +
    'footer{margin-top:40px;padding-top:16px;border-top:1px solid #ddd;font-size:11px;color:#999;font-family:system-ui,sans-serif}' +
    '\n</style>\n</head>\n<body>\n' +
    '<h1>' + esc(d.title) + '</h1>\n' +
    tagsHtml +
    '<div class="meta">' +
      '<div>Chain: ' + d.chain + '</div>' +
      '<div>Date: ' + d.date + '</div>' +
      '<div>DOC-ID: <code>' + esc(d.docId) + '</code></div>' +
      '<div>Uploader: <code>' + esc(d.uploader) + '</code></div>' +
      '<div>Transactions: ' + d.txLinks.join(' | ') + '</div>' +
    '</div>\n' +
    d.contentHtml + '\n' +
    '<footer>Downloaded from The Permanent Library — Permanent on-chain knowledge storage<br>' +
    'Burn address: 0x734F6C30fcd31819c46E49B98C69D89978446fa6</footer>\n' +
    '</body>\n</html>';
  var blob = new Blob([html], { type: 'text/html' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = d.title.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') + '.html';
  a.click();
  URL.revokeObjectURL(url);
}

// === Event listeners (no inline handlers) ===

// Search button
document.getElementById('search-btn').addEventListener('click', function() {
  doSearch();
});

// Enter key triggers search
document.getElementById('search-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doSearch();
});

// Event delegation for dynamically generated content
// Handles: doc-card clicks, pagination, back button, download button
document.getElementById('content').addEventListener('click', function(e) {
  // Check for image lightbox first
  if (e.target.tagName === 'IMG' && e.target.closest('.doc-content')) {
    var lb = document.getElementById('lightbox');
    document.getElementById('lightbox-img').src = e.target.src;
    lb.classList.add('active');
    return;
  }

  // Find the closest actionable element
  var actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    var action = actionEl.dataset.action;
    if (action === 'back') goBackToList();
    else if (action === 'download') downloadDocument();
    else if (action === 'prev-page') goPage(-1);
    else if (action === 'next-page') goPage(1);
    return;
  }

  // Doc card click
  var card = e.target.closest('.doc-card');
  if (card) {
    viewDoc(card.dataset.chain, card.dataset.docid);
  }
});

// Lightbox close — click on overlay
document.getElementById('lightbox').addEventListener('click', function() {
  closeLightbox();
});

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
  document.getElementById('lightbox-img').src = '';
}

// Escape key closes lightbox
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeLightbox();
});

// Initial load
loadStats();
loadRecent();

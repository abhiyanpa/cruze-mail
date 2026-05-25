/**
 * CRUZE MAIL — UI rendering and DOM helpers.
 */

/**
 * Format a unix timestamp to relative time string.
 */
function formatTimeAgo(unixSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - Number(unixSeconds);
  if (diff < 10) return 'Just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Generate a color from a string (for sender avatars).
 */
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

/**
 * Get initials from an email address.
 */
function getInitials(email) {
  const name = email.split('@')[0].replace(/[^a-zA-Z]/g, ' ').trim();
  const parts = name.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase() || '??';
}

/**
 * Render the email list in the inbox.
 */
function renderEmailList(emails, onEmailClick) {
  const container = document.getElementById('email-list');
  const emptyState = document.getElementById('empty-state');
  const emailCount = document.getElementById('email-count');

  if (emailCount) emailCount.textContent = emails.length;

  if (!emails || emails.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  container.innerHTML = emails
    .map(
      (email, idx) => `
    <div class="email-row" data-index="${idx}" tabindex="0">
      <div class="email-avatar" style="background: ${stringToColor(email.sender)}">
        ${getInitials(email.sender)}
      </div>
      <div class="email-info">
        <div class="email-sender">${escapeHtml(email.sender)}</div>
        <div class="email-subject">${escapeHtml(email.subject || '(No Subject)')}</div>
        <div class="email-preview">${escapeHtml(email.preview || '')}</div>
      </div>
      <div class="email-meta">
        <span class="email-time">${formatTimeAgo(email.receivedAt)}</span>
        ${idx === 0 && isNewEmail(email) ? '<span class="email-badge">NEW</span>' : ''}
      </div>
    </div>
  `
    )
    .join('');

  // Attach click handlers
  container.querySelectorAll('.email-row').forEach((row) => {
    row.addEventListener('click', () => {
      const index = parseInt(row.dataset.index);
      onEmailClick(emails[index]);
    });
  });
}

function isNewEmail(email) {
  const now = Math.floor(Date.now() / 1000);
  return now - Number(email.receivedAt) < 30;
}

/**
 * Show the email viewer with full email content.
 */
function showEmailViewer(email) {
  const viewer = document.getElementById('email-viewer');
  const overlay = document.getElementById('viewer-overlay');

  document.getElementById('viewer-sender').textContent = email.sender;
  document.getElementById('viewer-subject').textContent = email.subject || '(No Subject)';
  document.getElementById('viewer-time').textContent = formatTimeAgo(email.receivedAt);

  const bodyContainer = document.getElementById('viewer-body');

  if (email.htmlBody && email.htmlBody.trim()) {
    // Render HTML in sandboxed iframe
    bodyContainer.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-same-origin';
    iframe.classList.add('email-iframe');
    bodyContainer.appendChild(iframe);

    setTimeout(() => {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open();
      doc.write(`
        <html>
          <head>
            <style>
              body { font-family: 'Inter', sans-serif; color: #e2e8f0; background: transparent;
                     margin: 0; padding: 16px; font-size: 14px; line-height: 1.6; }
              a { color: #818cf8; }
              img { max-width: 100%; height: auto; }
            </style>
          </head>
          <body>${email.htmlBody}</body>
        </html>
      `);
      doc.close();
      // Auto-resize iframe
      setTimeout(() => {
        iframe.style.height = doc.body.scrollHeight + 'px';
      }, 100);
    }, 0);
  } else {
    bodyContainer.innerHTML = `<pre class="email-text">${escapeHtml(email.textBody || 'No content')}</pre>`;
  }

  viewer.classList.add('active');
  overlay.classList.add('active');
}

/**
 * Hide the email viewer.
 */
function hideEmailViewer() {
  document.getElementById('email-viewer').classList.remove('active');
  document.getElementById('viewer-overlay').classList.remove('active');
}

/**
 * Show a toast notification.
 */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span class="toast-message">${message}</span>
  `;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Update the countdown timer display.
 */
function updateTimer(expiresAt) {
  const timerEl = document.getElementById('expire-timer');
  if (!timerEl) return;

  const now = Math.floor(Date.now() / 1000);
  const remaining = Number(expiresAt) - now;

  if (remaining > 31536000) {
    timerEl.textContent = 'Permanent';
    return;
  }

  if (remaining <= 0) {
    timerEl.textContent = 'Expired';
    return;
  }

  const hours = Math.floor(remaining / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;
  timerEl.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Show loading skeleton.
 */
function showSkeleton() {
  const container = document.getElementById('email-list');
  container.innerHTML = Array(3)
    .fill(0)
    .map(
      () => `
    <div class="skeleton-row">
      <div class="skeleton-avatar shimmer"></div>
      <div class="skeleton-info">
        <div class="skeleton-line short shimmer"></div>
        <div class="skeleton-line medium shimmer"></div>
        <div class="skeleton-line long shimmer"></div>
      </div>
    </div>
  `
    )
    .join('');
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Set up the loading state for the generate button.
 */
function setGenerateLoading(loading) {
  const btn = document.getElementById('generate-btn');
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Generating...';
  } else {
    btn.disabled = false;
    btn.innerHTML = 'Generate New Email';
  }
}

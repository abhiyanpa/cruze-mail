/**
 * CRUZE MAIL — Main application logic.
 */

// ── Configuration ──
const WORKER_API = 'https://cruze-mail-worker.deduxx315.workers.dev';

// ── State ──
let currentToken = null;
let currentEmail = null;
let currentInboxId = null;
let currentExpiresAt = null;
let unsubscribe = null;
let timerInterval = null;
let currentUser = null;
let savedInboxes = [];

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  setupEventListeners();
  randomizeDomain();
  restoreSession();
});

function randomizeDomain() {
  const select = document.getElementById('domain-select');
  if (select && select.options.length > 0) {
    const randomIndex = Math.floor(Math.random() * select.options.length);
    select.selectedIndex = randomIndex;
  }
}

function setupEventListeners() {
  document.getElementById('generate-btn').addEventListener('click', generateNewInbox);
  document.getElementById('copy-btn').addEventListener('click', copyEmail);
  document.getElementById('viewer-close').addEventListener('click', hideEmailViewer);
  document.getElementById('viewer-overlay').addEventListener('click', hideEmailViewer);
  document.getElementById('refresh-btn').addEventListener('click', () => {
    if (currentInboxId) {
      showToast('Refreshing...', 'info');
    }
  });
  document.getElementById('renew-btn').addEventListener('click', renewInbox);
  
  document.getElementById('auth-btn').addEventListener('click', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('dashboard-btn').addEventListener('click', () => {
    if (currentUser) showDashboard();
  });
  document.getElementById('save-btn').addEventListener('click', saveInbox);

  // Keyboard support
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideEmailViewer();
  });
}

/**
 * Restore a previous session from localStorage.
 */
async function restoreSession() {
  const saved = localStorage.getItem('cruzemail_session');
  if (!saved) {
    showWelcome();
    return;
  }

  try {
    const session = JSON.parse(saved);
    const now = Math.floor(Date.now() / 1000);

    // Check if expired
    if (session.expiresAt && Number(session.expiresAt) <= now) {
      localStorage.removeItem('cruzemail_session');
      showWelcome();
      showToast('Previous inbox expired. Generate a new one!', 'info');
      return;
    }

    currentToken = session.token;
    currentEmail = session.email;
    currentInboxId = session.inboxId;
    currentExpiresAt = session.expiresAt;

    showInbox();
    startListening();
    startTimer();
  } catch {
    localStorage.removeItem('cruzemail_session');
    showWelcome();
  }
}

/**
 * Generate a new temporary inbox.
 */
async function generateNewInbox() {
  setGenerateLoading(true);

  try {
    // Stop any existing listener
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    // Call the Worker API to create an inbox
    const domain = document.getElementById('domain-select').value;
    const resp = await fetch(`${WORKER_API}/api/inbox`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain })
    });
    if (!resp.ok) {
      let errText = 'Failed to create inbox';
      try {
        const errorJson = await resp.json();
        if (errorJson.error) errText = errorJson.error;
      } catch (e) {}
      throw new Error(errText);
    }

    const data = await resp.json();
    currentToken = data.token;
    currentEmail = data.email;
    currentExpiresAt = data.expiresAt;

    // Get the inboxId by decrypting the token server-side
    const infoResp = await fetch(`${WORKER_API}/api/inbox/${encodeURIComponent(data.token)}`);
    if (!infoResp.ok) throw new Error('Failed to get inbox info');

    const info = await infoResp.json();
    currentInboxId = info.inboxId;

    // Save session
    localStorage.setItem(
      'cruzemail_session',
      JSON.stringify({
        token: currentToken,
        email: currentEmail,
        inboxId: currentInboxId,
        expiresAt: currentExpiresAt,
      })
    );

    showInbox();
    startListening();
    startTimer();
    showToast('New inbox created!');
  } catch (err) {
    console.error('Generate inbox error:', err);
    showToast('Failed to create inbox. Try again.', 'error');
  } finally {
    setGenerateLoading(false);
  }
}

/**
 * Renew the current inbox for an extra 24 hours.
 */
async function renewInbox() {
  if (!currentToken) return;
  const btn = document.getElementById('renew-btn');
  btn.disabled = true;
  btn.textContent = 'Renewing...';

  try {
    const resp = await fetch(`${WORKER_API}/api/inbox/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentToken })
    });
    
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Failed to renew');
    }

    const data = await resp.json();
    currentToken = data.token;
    currentExpiresAt = data.expiresAt;

    // Save session
    localStorage.setItem(
      'cruzemail_session',
      JSON.stringify({
        token: currentToken,
        email: currentEmail,
        inboxId: currentInboxId,
        expiresAt: currentExpiresAt,
      })
    );

    updateTimer(currentExpiresAt);
    showToast('Inbox renewed successfully!');
  } catch (err) {
    console.error('Renew error:', err);
    showToast(err.message, 'error');
  } finally {
    btn.textContent = 'Renew (+24h)';
    checkRenewEligibility();
  }
}

/**
 * Start real-time Firestore listener for emails.
 */
function startListening() {
  if (!currentInboxId) return;

  showSkeleton();

  unsubscribe = subscribeToInbox(
    currentInboxId,
    (emails) => {
      renderEmailList(emails, onEmailClick);
    },
    (err) => {
      console.error('Listener error:', err);
      showToast('Connection lost. Refresh the page.', 'error');
    }
  );
}

/**
 * Handle clicking on an email in the list.
 */
async function onEmailClick(email) {
  try {
    // Fetch full email content from Worker API
    const resp = await fetch(
      `${WORKER_API}/api/email/${encodeURIComponent(currentToken)}/${email.id}`
    );
    if (!resp.ok) throw new Error('Failed to fetch email');

    const fullEmail = await resp.json();
    showEmailViewer(fullEmail);
  } catch (err) {
    console.error('Email fetch error:', err);
    showToast('Failed to load email', 'error');
  }
}

/**
 * Copy the email address to clipboard.
 */
async function copyEmail() {
  if (!currentEmail) return;

  try {
    await navigator.clipboard.writeText(currentEmail);
    const btn = document.getElementById('copy-btn');
    btn.classList.add('copied');
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>';
    showToast('Copied to clipboard!');
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
    }, 2000);
  } catch {
    showToast('Failed to copy', 'error');
  }
}

/**
 * Start the expiry countdown timer.
 */
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  updateTimer(currentExpiresAt);
  checkRenewEligibility();
  timerInterval = setInterval(() => {
    updateTimer(currentExpiresAt);
    checkRenewEligibility();
    const now = Math.floor(Date.now() / 1000);
    if (Number(currentExpiresAt) <= now) {
      clearInterval(timerInterval);
      showToast('Inbox expired! Generate a new one.', 'info');
    }
  }, 1000);
}

/**
 * Enable or disable the renew button based on TTL.
 */
function checkRenewEligibility() {
  const renewBtn = document.getElementById('renew-btn');
  if (!renewBtn || !currentExpiresAt) return;
  const now = Math.floor(Date.now() / 1000);
  // Only allow if remaining time is < 24h
  if (currentExpiresAt - now >= 86400) {
    renewBtn.disabled = true;
  } else {
    renewBtn.disabled = false;
  }
}

/**
 * Show the welcome/generate state.
 */
function showWelcome() {
  document.getElementById('welcome-section').style.display = 'flex';
  document.getElementById('inbox-section').style.display = 'none';
  document.getElementById('dashboard-section').style.display = 'none';
}

window.goToGenerate = function() {
  showWelcome();
};

/**
 * Show the inbox state with the generated email.
 */
function showInbox() {
  document.getElementById('welcome-section').style.display = 'none';
  document.getElementById('dashboard-section').style.display = 'none';
  document.getElementById('inbox-section').style.display = 'block';
  document.getElementById('email-address').textContent = currentEmail;

  document.getElementById('save-btn').style.display = 'inline-flex';
  if (currentUser) {
    checkIfSaved();
  } else {
    document.getElementById('save-btn').textContent = '⭐ Save';
    document.getElementById('save-btn').disabled = false;
  }

  // Trigger animation
  const emailDisplay = document.querySelector('.email-display');
  emailDisplay.classList.remove('fade-in');
  void emailDisplay.offsetWidth;
  emailDisplay.classList.add('fade-in');
}

/**
 * Return to the welcome screen and clear current session.
 */
window.returnToHome = function() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  currentToken = null;
  currentEmail = null;
  currentInboxId = null;
  currentExpiresAt = null;
  
  localStorage.removeItem('cruzemail_session');
  hideEmailViewer();
  if (currentUser && savedInboxes.length > 0) {
    showDashboard();
  } else {
    showWelcome();
  }
};

// ── Auth & Dashboard Logic ──

function initAuth() {
  firebase.auth().onAuthStateChanged(async (user) => {
    currentUser = user;
    const authBtn = document.getElementById('auth-btn');
    const dashBtn = document.getElementById('dashboard-btn');
    const logoutBtn = document.getElementById('logout-btn');
    
    if (user) {
      authBtn.style.display = 'none';
      dashBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'inline-block';
      
      if (document.getElementById('inbox-section').style.display === 'block') {
        document.getElementById('save-btn').style.display = 'inline-flex';
      }
      await loadSavedInboxes();
      if (!currentInboxId && savedInboxes.length > 0) {
        showDashboard();
      }
    } else {
      authBtn.style.display = 'inline-block';
      dashBtn.style.display = 'none';
      logoutBtn.style.display = 'none';
      
      if (document.getElementById('inbox-section').style.display === 'block') {
        document.getElementById('save-btn').style.display = 'inline-flex';
        document.getElementById('save-btn').textContent = '⭐ Save';
        document.getElementById('save-btn').disabled = false;
      } else {
        document.getElementById('save-btn').style.display = 'none';
      }
      
      savedInboxes = [];
      if (document.getElementById('dashboard-section').style.display === 'block') {
        showWelcome();
      }
    }
  });
}

// Ensure initAuth is called after initFirebase
const originalInitFirebase = initFirebase;
window.initFirebase = function() {
  originalInitFirebase();
  initAuth();
};

async function handleLogout() {
  if (currentUser) {
    try {
      await firebase.auth().signOut();
      showToast('Logged out');
    } catch (err) {
      console.error(err);
      showToast('Logout failed', 'error');
    }
  }
}

async function handleLogin() {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await firebase.auth().signInWithPopup(provider);
    showToast('Logged in successfully!');
  } catch (err) {
    console.error(err);
    if (err.code === 'auth/popup-closed-by-user') {
      showToast('Login cancelled', 'info');
    } else {
      showToast('Login failed', 'error');
    }
  }
}

async function loadSavedInboxes() {
  if (!currentUser) return;
  try {
    const doc = await firebase.firestore().collection('users').doc(currentUser.uid).get();
    if (doc.exists) {
      savedInboxes = doc.data().inboxes || [];
    } else {
      savedInboxes = [];
    }
    renderDashboard();
    checkIfSaved();
  } catch (err) {
    console.error('Failed to load saved inboxes', err);
    if (err.code === 'permission-denied') {
      showToast('Database permission denied. Ensure Firestore rules are updated.', 'error');
    } else {
      showToast('Failed to load saved inboxes', 'error');
    }
  }
}

function showDashboard() {
  document.getElementById('welcome-section').style.display = 'none';
  document.getElementById('inbox-section').style.display = 'none';
  document.getElementById('dashboard-section').style.display = 'block';
  renderDashboard();
}

function renderDashboard() {
  const list = document.getElementById('saved-inboxes-list');
  if (!list) return;
  
  if (savedInboxes.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="border-radius: var(--radius-lg); padding: 40px 24px;">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.4">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
          </svg>
        </div>
        <p class="empty-text">No saved inboxes yet.</p>
        <p class="empty-subtext">Generate an inbox and click the ⭐ Save button.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = savedInboxes.map(inbox => `
    <div class="email-row" onclick="openSavedInbox('${inbox.token}')">
      <div class="email-avatar" style="background: #222; font-size: 14px;">⭐</div>
      <div class="email-info">
        <div class="email-sender">${inbox.email}</div>
        <div class="email-preview">Saved permanently</div>
      </div>
      <div class="email-meta">
        <button class="btn btn-ghost btn-sm" onclick="deleteSavedInbox(event, '${inbox.inboxId}')">Delete</button>
      </div>
    </div>
  `).join('');
}

window.openSavedInbox = async function(token) {
  setGenerateLoading(true);
  try {
    const resp = await fetch(`${WORKER_API}/api/inbox/${encodeURIComponent(token)}`);
    if (!resp.ok) throw new Error('Failed to load inbox');
    const data = await resp.json();
    
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    
    currentToken = token;
    currentEmail = data.email;
    currentInboxId = data.inboxId;
    currentExpiresAt = data.expiresAt;

    localStorage.setItem(
      'cruzemail_session',
      JSON.stringify({ token: currentToken, email: currentEmail, inboxId: currentInboxId, expiresAt: currentExpiresAt })
    );

    showInbox();
    startListening();
    startTimer();
  } catch (err) {
    console.error(err);
    showToast('Failed to open saved inbox', 'error');
  } finally {
    setGenerateLoading(false);
  }
};

window.deleteSavedInbox = async function(event, inboxId) {
  event.stopPropagation();
  if (!currentUser) return;
  
  savedInboxes = savedInboxes.filter(i => i.inboxId !== inboxId);
  try {
    await firebase.firestore().collection('users').doc(currentUser.uid).set({ inboxes: savedInboxes });
    renderDashboard();
    checkIfSaved();
    showToast('Removed from saved inboxes');
  } catch (err) {
    console.error(err);
    showToast('Failed to delete', 'error');
  }
};

function checkIfSaved() {
  const btn = document.getElementById('save-btn');
  if (!btn || !currentInboxId) return;
  const isSaved = savedInboxes.some(i => i.inboxId === currentInboxId);
  if (isSaved) {
    btn.textContent = '⭐ Saved';
    btn.disabled = true;
  } else {
    btn.textContent = '⭐ Save';
    btn.disabled = false;
  }
}

async function saveInbox() {
  if (!currentUser) {
    showToast('Please login to save inboxes.', 'error');
    return;
  }
  if (savedInboxes.length >= 5) {
    showToast('Maximum 5 saved inboxes reached. Please delete one first.', 'error');
    return;
  }
  if (savedInboxes.some(i => i.inboxId === currentInboxId)) return;

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    // Call worker to make it permanent
    const resp = await fetch(`${WORKER_API}/api/inbox/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentToken })
    });
    
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Failed to save on server');
    }

    const data = await resp.json();
    currentToken = data.token; // updated token that never expires
    
    // Save to Firestore
    savedInboxes.push({
      email: currentEmail,
      inboxId: currentInboxId,
      token: currentToken,
      savedAt: Date.now()
    });

    await firebase.firestore().collection('users').doc(currentUser.uid).set({ inboxes: savedInboxes });
    
    checkIfSaved();
    showToast('Inbox saved to Dashboard!');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = '⭐ Save';
  }
}

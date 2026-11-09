'use strict';

// Maps a /api/success-session response (or a failed request) to what the page shows.
// The API is unchanged. This only chooses the wording.
function describeSession(sessionId, data) {
  if (!sessionId) {
    return {
      tone: 'error',
      message: 'This page shows a Pro licence key after payment. This link has no payment reference, so there is no key to show.',
    };
  }
  if (!data) {
    return {
      tone: 'error',
      message: 'The payment check could not reach the server. Check your connection, then refresh this page.',
      retry: true,
    };
  }
  if (data.verified && typeof data.licenceKey === 'string' && data.licenceKey) {
    return { tone: 'success', message: 'Payment confirmed. Your key is below.', licenceKey: data.licenceKey };
  }
  if (data.pending) {
    return {
      tone: 'pending',
      message: 'Your payment is still being confirmed. Refresh this page in a minute to see your key.',
      retry: true,
    };
  }
  if (data.reason === 'invalid checkout session') {
    return {
      tone: 'error',
      message: 'This link has a payment reference the server does not recognise. Use the link Stripe opened after payment.',
    };
  }
  if (data.reason === 'payments not configured') {
    return { tone: 'error', message: 'Pro is not on sale yet, so there is no key to show.' };
  }
  return { tone: 'error', message: 'This payment could not be confirmed, so no key is shown.' };
}

function renderSession(view) {
  const status = document.querySelector('[data-status]');
  status.className = `status-box is-${view.tone}`;
  status.textContent = '';
  const text = document.createElement('p');
  text.textContent = view.message;
  status.appendChild(text);
  if (view.retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary';
    button.textContent = 'Refresh';
    button.addEventListener('click', () => window.location.reload());
    status.appendChild(button);
  }
  if (view.licenceKey) {
    document.querySelector('[data-licence-key]').textContent = view.licenceKey;
    document.querySelector('[data-key-panel]').classList.remove('hidden');
  }
}

async function copyKey() {
  const key = document.querySelector('[data-licence-key]');
  const note = document.querySelector('[data-copy-status]');
  try {
    await navigator.clipboard.writeText(key.textContent);
    note.textContent = 'Copied.';
  } catch (error) {
    const range = document.createRange();
    range.selectNodeContents(key);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    note.textContent = 'Copy is blocked here. The key is selected, so press Ctrl+C or Cmd+C.';
  }
}

async function verifySuccess() {
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  if (!sessionId) {
    renderSession(describeSession(''));
    return;
  }
  let data = null;
  try {
    const response = await fetch('/api/success-session', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    data = await response.json();
  } catch (error) {
    data = null;
  }
  renderSession(describeSession(sessionId, data));
}



function readWaitlistRef() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('ref') || params.get('utm_source') || '';
  if (fromQuery) {
    try { window.sessionStorage.setItem('mts_waitlist_ref', fromQuery); } catch (error) { /* ignore */ }
    return fromQuery;
  }
  try { return window.sessionStorage.getItem('mts_waitlist_ref') || ''; } catch (error) { return ''; }
}

function setWaitlistStatus(form, tone, message) {
  const status = form.querySelector('[data-waitlist-status]');
  if (!status) return;
  status.className = `waitlist-status${tone ? ` is-${tone}` : ''}`;
  status.textContent = message;
}

async function submitWaitlist(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const email = form.email.value;
  const note = form.note ? form.note.value : '';
  const company = form.company ? form.company.value : '';
  const refInput = form.querySelector('input[name="ref"]');
  const ref = (refInput && refInput.value) || readWaitlistRef();
  if (refInput) refInput.value = ref;
  setWaitlistStatus(form, '', 'Sending…');
  if (button) button.disabled = true;
  let data = null;
  try {
    const response = await fetch('/api/waitlist', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, note, company, source: ref, ref }),
    });
    data = await response.json();
    if (!response.ok || !data.ok) {
      setWaitlistStatus(form, 'error', (data && data.reason) || 'Could not join the waitlist. Try again.');
      return;
    }
    setWaitlistStatus(form, 'ok', data.message || 'Thanks. We will email you when it launches.');
    form.reset();
    if (refInput) refInput.value = ref;
  } catch (error) {
    setWaitlistStatus(form, 'error', 'Could not reach the server. Check your connection and try again.');
  } finally {
    if (button) button.disabled = false;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const siteConfig = window.METABASE_TO_SHEETS_CONFIG || { baseUrl: window.location.origin };
  const canonical = document.querySelector('[data-canonical]');
  const ogUrl = document.querySelector('meta[property="og:url"]');
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (siteConfig.baseUrl) {
    const pageUrl = `${siteConfig.baseUrl}${window.location.pathname}`;
    if (canonical) canonical.href = pageUrl;
    if (ogUrl) ogUrl.content = pageUrl;
    if (ogImage) ogImage.content = `${siteConfig.baseUrl}/assets/og.png`;
  }
  const copyButton = document.querySelector('[data-copy-key]');
  if (copyButton) copyButton.addEventListener('click', copyKey);
  if (document.querySelector('[data-licence-key]')) verifySuccess();
  const waitlistForms = document.querySelectorAll('[data-waitlist]');
  const storedRef = readWaitlistRef();
  waitlistForms.forEach((form) => {
    const refInput = form.querySelector('input[name="ref"]');
    if (refInput && storedRef) refInput.value = storedRef;
    form.addEventListener('submit', submitWaitlist);
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { describeSession, readWaitlistRef, submitWaitlist };

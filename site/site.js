'use strict';

const siteConfig = window.METABASE_TO_SHEETS_CONFIG || { baseUrl: window.location.origin };
const canonical = document.querySelector('[data-canonical]');
if (canonical && siteConfig.baseUrl) canonical.href = `${siteConfig.baseUrl}${window.location.pathname}`;

function showStatus(message, isError) {
  const box = document.querySelector('[data-status]');
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('error', Boolean(isError));
  box.classList.remove('hidden');
}

async function loadPaymentLink() {
  const link = document.querySelector('[data-payment-link]');
  if (!link) return;
  try {
    const response = await fetch('/api/payment-link', { cache: 'no-store', credentials: 'omit' });
    const data = await response.json();
    if (data.configured && typeof data.url === 'string' && /^https:\/\/buy\.stripe\.com\//.test(data.url)) {
      link.href = data.url;
      link.removeAttribute('aria-disabled');
      link.classList.remove('hidden');
      const note = document.querySelector('[data-payment-note]');
      if (note) note.textContent = 'Stripe opens in a separate hosted payment page.';
    } else {
      showStatus('The payment link is not configured yet. Price and checkout remain pending approval.', false);
    }
  } catch (error) {
    showStatus('The payment link could not be checked. Try again later.', true);
  }
}

async function verifySuccess() {
  const status = document.querySelector('[data-status]');
  const keyBox = document.querySelector('[data-licence-key]');
  if (!status || !keyBox) return;
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  if (!sessionId) {
    showStatus('No Stripe checkout session was supplied. Return to pricing and try again.', true);
    return;
  }

  showStatus('Checking the paid session and waiting for webhook fulfilment.', false);
  try {
    const response = await fetch('/api/success-session', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    const data = await response.json();
    if (data.verified && typeof data.licenceKey === 'string') {
      status.textContent = 'Your paid subscription is verified. Save this key in the Google Sheets sidebar.';
      keyBox.textContent = data.licenceKey;
      keyBox.classList.remove('hidden');
      return;
    }
    showStatus(data.pending
      ? 'Payment was received. The signed webhook has not finished assigning the licence yet. Refresh this page shortly.'
      : (data.reason || 'The session could not be verified.'), Boolean(!data.pending));
  } catch (error) {
    showStatus('The verification request failed. Refresh this page shortly.', true);
  }
}

if (document.querySelector('[data-payment-link]')) loadPaymentLink();
if (document.querySelector('[data-licence-key]')) verifySuccess();

// State
let appState = {
  events: [],
  users: [],
  subscriptions: [],
  products: [],
  ledgerBalances: [],
  ledgerEntries: [],
  selectedEvent: null,
  selectedProduct: null,
};

// DOM Elements
const alertBanner = document.getElementById('alert-banner');

function showAlert(message, type = 'success') {
  alertBanner.className = `alert-banner ${type}`;
  alertBanner.textContent = message;
  alertBanner.classList.remove('hidden');
  setTimeout(() => {
    alertBanner.classList.add('hidden');
  }, 4000);
}

// Navigation Tabs
function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabId}`);
  });

  const titles = {
    overview: 'External System Overview',
    terminal: 'Card Terminal & Payment Processor',
    events: 'Webhook Audit Stream',
    subscriptions: 'Subscriptions & Customers',
    ledger: 'Financial Ledger & Double-Entry Accounts',
    simulator: 'Webhook Event Simulator',
    integration: 'Stripe CLI & Webhook Setup Guide',
  };
  document.getElementById('page-title').textContent = titles[tabId] || 'Stripe External System';
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Format currency
function formatCents(cents, currency = 'usd') {
  const symbol = currency.toLowerCase() === 'eur' ? '€' : currency.toLowerCase() === 'gbp' ? '£' : '$';
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

// Format relative date
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Load Health and System Status
async function loadHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    document.getElementById('stripe-mode-tag').textContent = 
      data.stripeMode === 'connected' ? 'Stripe Connected' : 'Simulated Sandbox';
  } catch (err) {
    console.error('Failed to load health:', err);
  }
}

// Load All Data
async function refreshAll() {
  await Promise.all([
    loadEvents(),
    loadSubscriptions(),
    loadUsers(),
    loadProducts(),
    loadLedger(),
    loadTestCards(),
    loadStoredCards(),
  ]);
  updateOverviewStats();
}

async function loadEvents() {
  try {
    const res = await fetch('/api/events?limit=50');
    const data = await res.json();
    appState.events = data.events || [];

    document.getElementById('event-badge-count').textContent = appState.events.length;
    renderEvents();
  } catch (err) {
    console.error('Failed to load events:', err);
  }
}

function renderEvents() {
  // Overview mini table
  const overviewTbody = document.querySelector('#table-overview-events tbody');
  const recent5 = appState.events.slice(0, 5);
  if (recent5.length === 0) {
    overviewTbody.innerHTML = '<tr><td colspan="4" class="empty-state">No events yet. Trigger one on the right!</td></tr>';
  } else {
    overviewTbody.innerHTML = recent5.map(evt => `
      <tr>
        <td><code>${evt.event_id}</code></td>
        <td><strong>${evt.event_type}</strong></td>
        <td><span class="badge ${evt.status === 'processed' ? 'badge-success' : 'badge-danger'}">${evt.status}</span></td>
        <td>${formatDate(evt.received_at)}</td>
      </tr>
    `).join('');
  }

  // Full table
  const fullTbody = document.querySelector('#table-events-full tbody');
  if (appState.events.length === 0) {
    fullTbody.innerHTML = '<tr><td colspan="6" class="empty-state">No events recorded.</td></tr>';
  } else {
    fullTbody.innerHTML = appState.events.map(evt => `
      <tr>
        <td><code>${evt.event_id}</code></td>
        <td><strong>${evt.event_type}</strong></td>
        <td><span class="badge ${evt.status === 'processed' ? 'badge-success' : 'badge-danger'}">${evt.status}</span></td>
        <td><code>${JSON.stringify(evt.payload?.data?.object?.id || evt.payload?.type || '')}</code></td>
        <td>${formatDate(evt.received_at)}</td>
        <td>
          <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="viewEvent('${evt.id}')">Inspect</button>
          <button class="btn btn-primary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="replayEvent('${evt.id}')">Replay</button>
        </td>
      </tr>
    `).join('');
  }
}

async function loadSubscriptions() {
  try {
    const res = await fetch('/api/subscriptions');
    const data = await res.json();
    appState.subscriptions = data.subscriptions || [];

    const tbody = document.querySelector('#table-subscriptions tbody');
    if (appState.subscriptions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No subscriptions registered.</td></tr>';
    } else {
      tbody.innerHTML = appState.subscriptions.map(s => `
        <tr>
          <td><code>${s.stripe_subscription_id}</code></td>
          <td><code>${s.stripe_customer_id}</code></td>
          <td><strong>${s.plan_name || s.plan_id}</strong></td>
          <td><span class="badge ${s.status === 'active' ? 'badge-success' : 'badge-danger'}">${s.status}</span></td>
          <td>${formatDate(s.current_period_start)}</td>
          <td>${formatDate(s.current_period_end)}</td>
          <td>${s.cancel_at_period_end ? 'Yes' : 'No'}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load subscriptions:', err);
  }
}

async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const data = await res.json();
    appState.users = data.users || [];

    const tbody = document.querySelector('#table-users tbody');
    if (appState.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No users registered.</td></tr>';
    } else {
      tbody.innerHTML = appState.users.map(u => `
        <tr>
          <td><code>${u.id}</code></td>
          <td><strong>${u.name}</strong></td>
          <td>${u.email}</td>
          <td><code>${u.stripe_customer_id || 'Not mapped yet'}</code></td>
          <td>${formatDate(u.created_at)}</td>
        </tr>
      `).join('');
    }

    // Populate simulator, checkout, and terminal user dropdowns
    const simSelect = document.getElementById('sim-user');
    const checkoutSelect = document.getElementById('checkout-user-select');
    const terminalSelect = document.getElementById('terminal-user');
    const options = appState.users.map(u => `<option value="${u.id}">${u.name} (${u.email})</option>`).join('');
    if (simSelect) simSelect.innerHTML = options;
    if (checkoutSelect) checkoutSelect.innerHTML = options;
    if (terminalSelect) terminalSelect.innerHTML = options;
  } catch (err) {
    console.error('Failed to load users:', err);
  }
}

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    appState.products = data.products || [];

    const tierList = document.getElementById('checkout-tier-list');
    tierList.innerHTML = appState.products.map((p, idx) => `
      <div class="tier-card ${idx === 0 ? 'selected' : ''}" onclick="selectTier('${p.id}', this)">
        <div class="tier-name">${p.name}</div>
        <div class="tier-price">${formatCents(p.amount, p.currency)}<span style="font-size: 0.75rem; color: #64748b;">/${p.interval}</span></div>
      </div>
    `).join('');

    if (appState.products.length > 0) {
      appState.selectedProduct = appState.products[0].id;
    }
  } catch (err) {
    console.error('Failed to load products:', err);
  }
}

function selectTier(productId, el) {
  document.querySelectorAll('.tier-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  appState.selectedProduct = productId;
}

async function loadLedger() {
  try {
    const [balRes, entriesRes] = await Promise.all([
      fetch('/api/ledger/balances'),
      fetch('/api/ledger/entries?limit=50'),
    ]);
    const balData = await balRes.json();
    const entriesData = await entriesRes.json();

    appState.ledgerBalances = balData.balances || [];
    appState.ledgerEntries = entriesData.entries || [];

    // Render Balances
    const balTbody = document.querySelector('#table-ledger-balances tbody');
    if (appState.ledgerBalances.length === 0) {
      balTbody.innerHTML = '<tr><td colspan="5" class="empty-state">No ledger entries recorded yet.</td></tr>';
    } else {
      balTbody.innerHTML = appState.ledgerBalances.map(b => `
        <tr>
          <td><strong>${b.account}</strong></td>
          <td>${b.currency.toUpperCase()}</td>
          <td>${formatCents(b.total_debit, b.currency)}</td>
          <td>${formatCents(b.total_credit, b.currency)}</td>
          <td><strong>${formatCents(b.net_balance, b.currency)}</strong></td>
        </tr>
      `).join('');
    }

    // Render Journal Entries
    const entriesTbody = document.querySelector('#table-ledger-entries tbody');
    if (appState.ledgerEntries.length === 0) {
      entriesTbody.innerHTML = '<tr><td colspan="6" class="empty-state">No journal entries recorded.</td></tr>';
    } else {
      entriesTbody.innerHTML = appState.ledgerEntries.map(e => `
        <tr>
          <td>${formatDate(e.created_at)}</td>
          <td><code>${e.entry_type}</code></td>
          <td>${e.account}</td>
          <td>${e.debit > 0 ? formatCents(e.debit, e.currency) : '-'}</td>
          <td>${e.credit > 0 ? formatCents(e.credit, e.currency) : '-'}</td>
          <td>${e.description}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load ledger:', err);
  }
}

function updateOverviewStats() {
  // Revenue credited
  const revenueBal = appState.ledgerBalances.find(b => b.account === 'subscription_revenue');
  const revenueTotal = revenueBal ? revenueBal.total_credit : 0;
  document.getElementById('stat-revenue').textContent = formatCents(revenueTotal);

  // Clearing balance
  const clearingBal = appState.ledgerBalances.find(b => b.account === 'stripe_clearing');
  const clearingTotal = clearingBal ? clearingBal.net_balance : 0;
  document.getElementById('stat-clearing').textContent = formatCents(clearingTotal);

  // Active subs
  const activeCount = appState.subscriptions.filter(s => s.status === 'active').length;
  document.getElementById('stat-active-subs').textContent = activeCount;

  // Processed events
  const processedCount = appState.events.filter(e => e.status === 'processed').length;
  document.getElementById('stat-webhooks-processed').textContent = processedCount;
}

// Quick Simulator trigger
async function triggerQuickEvent(eventType) {
  try {
    const user = appState.users[0];
    const res = await fetch('/api/simulator/trigger-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType,
        userId: user ? user.id : 'usr_demo_001',
        amount: 4900,
        currency: 'usd',
      }),
    });
    const result = await res.json();
    if (res.ok) {
      showAlert(`Dispatched & processed ${eventType}!`);
      await refreshAll();
    } else {
      alert(`Simulation failed: ${result.error}`);
    }
  } catch (err) {
    alert(`Simulation error: ${err.message}`);
  }
}

// Event Inspection Modal
function viewEvent(id) {
  const evt = appState.events.find(e => e.id === id);
  if (!evt) return;
  appState.selectedEvent = evt;
  document.getElementById('modal-event-title').textContent = `${evt.event_type} (${evt.event_id})`;
  document.getElementById('modal-event-json').textContent = JSON.stringify(evt.payload, null, 2);
  document.getElementById('modal-event').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-event').classList.add('hidden');
}

async function replayEvent(id) {
  try {
    const res = await fetch(`/api/events/${id}/replay`, { method: 'POST' });
    const result = await res.json();
    if (res.ok) {
      showAlert(`Event replayed successfully!`);
      closeModal();
      await refreshAll();
    } else {
      alert(`Replay failed: ${result.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

document.getElementById('btn-modal-replay').addEventListener('click', () => {
  if (appState.selectedEvent) {
    replayEvent(appState.selectedEvent.id);
  }
});

// Checkout Modal
document.getElementById('btn-open-checkout').addEventListener('click', () => {
  document.getElementById('modal-checkout').classList.remove('hidden');
});

function closeCheckoutModal() {
  document.getElementById('modal-checkout').classList.add('hidden');
}

document.getElementById('btn-submit-checkout').addEventListener('click', async () => {
  const userId = document.getElementById('checkout-user-select').value;
  const priceId = appState.selectedProduct || 'price_starter';

  try {
    const res = await fetch('/api/checkout/create-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, priceId }),
    });

    const data = await res.json();
    if (res.ok) {
      closeCheckoutModal();
      showAlert(`Checkout session created: ${data.sessionId}`);

      // If simulated checkout, auto-trigger checkout.session.completed event!
      if (data.simulated) {
        setTimeout(async () => {
          await triggerQuickEvent('checkout.session.completed');
        }, 600);
      } else if (data.url) {
        window.open(data.url, '_blank');
      }
    } else {
      alert(`Checkout failed: ${JSON.stringify(data.error)}`);
    }
  } catch (err) {
    alert(`Checkout error: ${err.message}`);
  }
});

async function openPortalForDemoUser() {
  const user = appState.users[0];
  if (!user) return alert('No user available');

  try {
    const res = await fetch('/api/portal/create-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    });
    const data = await res.json();
    if (res.ok) {
      showAlert(`Portal session launched: ${data.sessionId}`);
      if (!data.simulated && data.url) {
        window.open(data.url, '_blank');
      }
    } else {
      alert(`Portal error: ${data.error}`);
    }
  } catch (err) {
    alert(`Portal error: ${err.message}`);
  }
}

// Simulator Form submit
document.getElementById('simulator-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const eventType = document.getElementById('sim-event-type').value;
  const userId = document.getElementById('sim-user').value;
  const amount = document.getElementById('sim-amount').value;
  const currency = document.getElementById('sim-currency').value;

  const btn = document.getElementById('btn-dispatch-sim');
  btn.disabled = true;
  btn.textContent = 'Dispatching...';

  try {
    const res = await fetch('/api/simulator/trigger-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, userId, amount, currency }),
    });

    const data = await res.json();
    const codeBox = document.getElementById('sim-response-card');
    const codeElem = document.getElementById('sim-response-code');

    codeElem.textContent = JSON.stringify(data, null, 2);
    codeBox.classList.remove('hidden');

    if (res.ok) {
      showAlert(`Event ${eventType} dispatched and verified!`);
      await refreshAll();
    }
  } catch (err) {
    alert(`Simulator error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> Dispatch Simulated Event`;
  }
});

// --- CARD TERMINAL & PAYMENT LOGIC ---

async function loadTestCards() {
  try {
    const res = await fetch('/api/payments/test-cards');
    const data = await res.json();
    appState.testCards = data.testCards || [];

    const container = document.getElementById('test-cards-container');
    if (!container) return;

    container.innerHTML = appState.testCards.map(tc => `
      <div class="test-card-item" onclick="fillTestCard('${tc.number}', '${tc.exp}', '${tc.cvc}')">
        <div class="test-card-header">
          <span class="test-card-name">${tc.name}</span>
          <span class="test-card-badge">${tc.brand.toUpperCase()}</span>
        </div>
        <div class="test-card-number">${tc.number}</div>
        <div class="test-card-desc">${tc.description}</div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load test cards:', err);
  }
}

function fillTestCard(number, exp, cvc) {
  const cardInput = document.getElementById('card-number-input');
  const expInput = document.getElementById('card-expiry-input');
  const cvcInput = document.getElementById('card-cvc-input');

  if (cardInput) {
    cardInput.value = number;
    cardInput.dispatchEvent(new Event('input'));
  }
  if (expInput) {
    expInput.value = exp;
    expInput.dispatchEvent(new Event('input'));
  }
  if (cvcInput) {
    cvcInput.value = cvc;
  }
  showAlert(`Loaded ${number} into payment terminal!`, 'info');
}

async function loadStoredCards() {
  try {
    const res = await fetch('/api/payments/methods');
    const data = await res.json();
    appState.storedCards = data.paymentMethods || [];

    const container = document.getElementById('stored-cards-container');
    if (!container) return;

    if (appState.storedCards.length === 0) {
      container.innerHTML = '<div class="empty-state">No stored cards yet. Process a payment to attach one!</div>';
    } else {
      container.innerHTML = appState.storedCards.map(c => `
        <div class="stored-card-item">
          <div>
            <span class="stored-card-brand">${c.brand}</span>
            <strong> •••• ${c.last4}</strong>
            <div class="stored-card-meta">Expires ${c.exp_month}/${c.exp_year} &bull; ${c.cardholder_name || 'Cardholder'}</div>
          </div>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" onclick="useStoredCard('${c.brand}', '${c.last4}', ${c.exp_month}, ${c.exp_year}, '${c.cardholder_name || ''}')">Use Card</button>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load stored cards:', err);
  }
}

function useStoredCard(brand, last4, expMonth, expYear, name) {
  document.getElementById('preview-brand-logo').textContent = brand.toUpperCase();
  document.getElementById('input-brand-badge').textContent = brand.toUpperCase();
  document.getElementById('preview-card-number').textContent = `•••• •••• •••• ${last4}`;
  document.getElementById('preview-card-expiry').textContent = `${String(expMonth).padStart(2, '0')}/${String(expYear).slice(-2)}`;
  if (name) {
    document.getElementById('preview-card-holder').textContent = name.toUpperCase();
    document.getElementById('card-holder-input').value = name;
  }
  showAlert(`Selected saved ${brand.toUpperCase()} ending in ${last4}`);
}

// Formatters & Live Card Preview Listeners
const cardNumInput = document.getElementById('card-number-input');
const cardExpInput = document.getElementById('card-expiry-input');
const cardHolderInput = document.getElementById('card-holder-input');
const amountInput = document.getElementById('terminal-amount');
const currencySelect = document.getElementById('terminal-currency');

function detectClientBrand(number) {
  const clean = number.replace(/\D/g, '');
  if (/^4/.test(clean)) return 'VISA';
  if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/.test(clean)) return 'MASTERCARD';
  if (/^3[47]/.test(clean)) return 'AMEX';
  if (/^6(?:011|5)/.test(clean)) return 'DISCOVER';
  return 'CARD';
}

// --- PIPELINE TRACKER & REQUEST INSPECTOR LOGIC ---
function setPipelineStep(stepNumber) {
  for (let i = 1; i <= 5; i++) {
    const stepEl = document.getElementById(`pipe-step-${i}`);
    const lineEl = document.getElementById(`pipe-line-${i}`);
    const circleEl = document.getElementById(`circle-step-${i}`);

    if (stepEl) {
      stepEl.classList.remove('active', 'completed');
      if (i < stepNumber) {
        stepEl.classList.add('completed');
        if (circleEl) circleEl.innerHTML = '&#10003;';
      } else if (i === stepNumber) {
        stepEl.classList.add('active');
        if (circleEl) circleEl.textContent = i;
      } else {
        if (circleEl) circleEl.textContent = i;
      }
    }

    if (lineEl) {
      lineEl.classList.remove('active', 'completed');
      if (i < stepNumber) {
        lineEl.classList.add('completed');
      } else if (i === stepNumber) {
        lineEl.classList.add('active');
      }
    }
  }
}

function updateRequestInspector() {
  const rawNumber = (document.getElementById('card-number-input')?.value || '').replace(/\s+/g, '');
  const rawExp = (document.getElementById('card-expiry-input')?.value || '').replace(/\s+/g, '');
  const [expMonthStr, expYearStr] = rawExp.split('/');
  const cvc = document.getElementById('card-cvc-input')?.value || '';
  const cardholderName = document.getElementById('card-holder-input')?.value || 'Alex Mercer';
  const amountVal = parseFloat(document.getElementById('terminal-amount')?.value || '49.00');
  const currency = document.getElementById('terminal-currency')?.value || 'usd';
  const userId = document.getElementById('terminal-user')?.value || 'usr_demo_001';

  let fullYear = parseInt(expYearStr, 10);
  if (fullYear && fullYear < 100) fullYear += 2000;

  const previewPayload = {
    amount: Math.round(amountVal * 100),
    currency,
    userId,
    cardholderName,
    cardNumber: rawNumber ? `${rawNumber.slice(0, 4)} •••• •••• ${rawNumber.slice(-4)}` : '•••• •••• •••• ••••',
    expMonth: parseInt(expMonthStr, 10) || null,
    expYear: fullYear || null,
    cvc: cvc ? '•••' : null,
    description: `Card payment for ${cardholderName}`,
    saveCard: Boolean(document.getElementById('card-save-checkbox')?.checked)
  };

  const reqCode = document.getElementById('inspector-request-json');
  if (reqCode) {
    reqCode.textContent = JSON.stringify(previewPayload, null, 2);
  }
}

function validateLuhnClient(cardNumber) {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

if (cardNumInput) {
  cardNumInput.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, '');
    const brand = detectClientBrand(value);

    // Format with spaces
    let formatted = '';
    if (brand === 'AMEX') {
      if (value.length > 0) formatted += value.substring(0, 4);
      if (value.length > 4) formatted += ' ' + value.substring(4, 10);
      if (value.length > 10) formatted += ' ' + value.substring(10, 15);
    } else {
      for (let i = 0; i < value.length && i < 16; i += 4) {
        if (i > 0) formatted += ' ';
        formatted += value.substring(i, i + 4);
      }
    }

    e.target.value = formatted;

    document.getElementById('preview-brand-logo').textContent = brand;
    document.getElementById('input-brand-badge').textContent = brand;
    document.getElementById('preview-card-number').textContent = formatted || '•••• •••• •••• ••••';

    const inspTag = document.getElementById('inspector-tag');
    if (value.length >= 13) {
      const isValidLuhn = validateLuhnClient(value);
      if (isValidLuhn) {
        setPipelineStep(3); // Stage 3: Feed & Validate
        if (inspTag) {
          inspTag.textContent = `${brand} Ingested (Luhn Valid)`;
          inspTag.className = 'tag tag-success';
        }
      } else {
        if (inspTag) {
          inspTag.textContent = 'Invalid Card Checksum';
          inspTag.className = 'tag tag-danger';
        }
      }
    } else if (value.length > 0) {
      setPipelineStep(2); // Stage 2: Supplying
      if (inspTag) {
        inspTag.textContent = 'Entering Card Digits...';
        inspTag.className = 'tag';
      }
    } else {
      setPipelineStep(2);
      if (inspTag) {
        inspTag.textContent = 'Ready for Card Data';
        inspTag.className = 'tag';
      }
    }

    updateRequestInspector();
  });
}

if (cardExpInput) {
  cardExpInput.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length >= 2) {
      val = val.substring(0, 2) + ' / ' + val.substring(2, 4);
    }
    e.target.value = val;
    document.getElementById('preview-card-expiry').textContent = val || 'MM/YY';
    updateRequestInspector();
  });
}

if (cardHolderInput) {
  cardHolderInput.addEventListener('input', (e) => {
    document.getElementById('preview-card-holder').textContent = (e.target.value || 'CARDHOLDER NAME').toUpperCase();
    updateRequestInspector();
  });
}

function updatePayButtonText() {
  const amt = parseFloat(amountInput ? amountInput.value : 49) || 0;
  const curr = currencySelect ? currencySelect.value : 'usd';
  const symbol = curr === 'eur' ? '€' : curr === 'gbp' ? '£' : '$';
  const payBtnText = document.getElementById('btn-pay-text');
  if (payBtnText) {
    payBtnText.textContent = `Pay ${symbol}${amt.toFixed(2)}`;
  }
  updateRequestInspector();
}

if (amountInput) amountInput.addEventListener('input', updatePayButtonText);
if (currencySelect) currencySelect.addEventListener('change', updatePayButtonText);

// Card Payment Form Submission
const cardPaymentForm = document.getElementById('card-payment-form');
if (cardPaymentForm) {
  cardPaymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payBtn = document.getElementById('btn-process-payment');
    const payText = document.getElementById('btn-pay-text');
    const originalText = payText.textContent;

    payBtn.disabled = true;
    payText.textContent = 'Dispatching API Request...';
    setPipelineStep(4); // Stage 4: API Request Sent

    const inspTag = document.getElementById('inspector-tag');
    if (inspTag) {
      inspTag.textContent = 'API Request Dispatched...';
      inspTag.className = 'tag tag-info';
    }

    const rawNumber = document.getElementById('card-number-input').value.replace(/\s+/g, '');
    const rawExp = document.getElementById('card-expiry-input').value.replace(/\s+/g, '');
    const [expMonthStr, expYearStr] = rawExp.split('/');
    const expMonth = parseInt(expMonthStr, 10);
    let expYear = parseInt(expYearStr, 10);
    if (expYear < 100) expYear += 2000;

    const cvc = document.getElementById('card-cvc-input').value.trim();
    const cardholderName = document.getElementById('card-holder-input').value.trim();
    const billingZip = document.getElementById('card-zip-input').value.trim();
    const amountVal = parseFloat(document.getElementById('terminal-amount').value || '0');
    const amountInCents = Math.round(amountVal * 100);
    const currency = document.getElementById('terminal-currency').value;
    const userId = document.getElementById('terminal-user').value;
    const saveCard = document.getElementById('card-save-checkbox').checked;

    try {
      const res = await fetch('/api/payments/process-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardNumber: rawNumber,
          expMonth,
          expYear,
          cvc,
          cardholderName,
          billingZip,
          amount: amountInCents,
          currency,
          userId,
          description: `Card charge for ${cardholderName}`,
          saveCard,
        }),
      });

      const data = await res.json();

      // Show in Response Inspector
      const respCode = document.getElementById('inspector-response-json');
      if (respCode) {
        respCode.textContent = JSON.stringify(data, null, 2);
      }

      if (!res.ok) {
        if (inspTag) {
          inspTag.textContent = `Declined: ${data.error?.declineCode || 'Error'}`;
          inspTag.className = 'tag tag-danger';
        }
        throw new Error(data.error?.message || 'Payment failed to process');
      }

      // Stage 5: Response & Settle Complete!
      setPipelineStep(5);
      if (inspTag) {
        inspTag.textContent = 'Settled (200 OK)';
        inspTag.className = 'tag tag-success';
      }

      // Populate Receipt Modal
      const symbol = currency === 'eur' ? '€' : currency === 'gbp' ? '£' : '$';
      document.getElementById('receipt-amount-display').textContent = `${symbol}${(data.amount / 100).toFixed(2)}`;
      document.getElementById('receipt-pi-display').textContent = data.paymentIntentId;
      document.getElementById('receipt-method-display').textContent = `${data.brand.toUpperCase()} ending in ${data.last4}`;
      document.getElementById('receipt-date-display').textContent = new Date().toLocaleString();

      document.getElementById('modal-receipt').classList.remove('hidden');
      showAlert(`Payment of ${symbol}${(data.amount / 100).toFixed(2)} succeeded!`);

      // Refresh all data
      await refreshAll();

    } catch (err) {
      alert(`Card Error: ${err.message}`);
    } finally {
      payBtn.disabled = false;
      payText.textContent = originalText;
    }
  });
}

function closeReceiptModal() {
  document.getElementById('modal-receipt').classList.add('hidden');
}

// Refresh button
document.getElementById('btn-refresh').addEventListener('click', refreshAll);

// Init
window.addEventListener('DOMContentLoaded', () => {
  loadHealth();
  refreshAll();
  updateRequestInspector();
});

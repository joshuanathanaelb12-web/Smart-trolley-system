import { io } from 'socket.io-client';
import './style.css';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const params = new URLSearchParams(location.search);
let mode = params.get('view') === 'customer' ? 'customer' : 'dashboard';
let selectedTrolley = params.get('trolley') || 'T-001';
let state = { products: [], trolleys: [], alerts: [], payments: [] };
let latestBill = null;
let notice = '';
let busy = false;

const socket = io(API, { transports: ['websocket', 'polling'] });
socket.on('state:update', (next) => { state = next; render(); });
socket.on('connect_error', () => { notice = 'Live connection unavailable; retrying. Check that the API is running.'; });

async function api(path, body) {
  busy = true; render();
  try {
    const response = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    notice = data.accepted === false ? `Reader event ignored: ${data.reason}` : 'Updated successfully.';
    if (path === '/api/checkout/scan-trolley') latestBill = data;
    const fresh = await fetch(`${API}/api/state`).then((r) => r.json());
    state = fresh;
    return data;
  } catch (error) {
    notice = error.message;
    throw error;
  } finally {
    busy = false; render();
  }
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n || 0);
const current = () => state.trolleys.find((t) => t.id === selectedTrolley) || state.trolleys[0];
const cartItems = (t) => Object.entries(t?.cart || {}).map(([epc, item]) => ({ ...item, ...state.products.find((p) => p.epc === epc) }));

function header() {
  return `<header class="topbar"><div class="brand"><div class="brand-mark">ST</div><div><strong>Smart Trolley</strong><small>Queue-less store prototype</small></div></div><div class="top-actions"><span class="live-dot">● Live demo</span><button class="btn btn-quiet" data-action="reset">Reset simulation</button></div></header>`;
}
function nav() {
  return `<nav class="tabs"><button class="tab ${mode === 'dashboard' ? 'active' : ''}" data-mode="dashboard">Master dashboard</button><button class="tab ${mode === 'customer' ? 'active' : ''}" data-mode="customer">Customer app</button></nav>`;
}
function trolleyOptions() {
  return state.trolleys.map((t) => `<option value="${esc(t.id)}" ${t.id === selectedTrolley ? 'selected' : ''}>${esc(t.id)}</option>`).join('');
}
function cartTable(t) {
  const items = cartItems(t);
  if (!items.length) return `<div class="empty">Your basket is empty. Simulate an RFID product read to add an item.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th></th></tr></thead><tbody>${items.map((p) => `<tr><td><strong>${esc(p.name)}</strong><small>${esc(p.sku)}</small></td><td>${p.quantity}</td><td>${money(p.price * p.quantity)}</td><td>${mode === 'customer' ? `<button class="tiny" data-action="remove" data-epc="${p.epc}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function productControls(t) {
  return `<div class="product-grid">${state.products.map((p) => `<article class="product-card"><div class="product-icon">${p.category === 'Dairy' ? '🥛' : p.category === 'Bakery' ? '🍞' : p.category === 'Staples' ? '🌾' : p.category === 'Personal care' ? '🧼' : p.category === 'Snacks' ? '🥔' : '🛍️'}</div><div class="product-info"><strong>${esc(p.name)}</strong><small>${esc(p.sku)} · ${p.weightKg.toFixed(2)} kg</small><b>${money(p.price)}</b></div><button class="btn btn-small" data-action="add" data-epc="${p.epc}" ${t?.status !== 'active' || t?.cart?.[p.epc] ? 'disabled' : ''}>Simulate RFID add</button></article>`).join('')}</div>`;
}
function customerView() {
  const t = current();
  if (!t) return `<main class="content"><div class="empty">No trolley data received yet. Start the API server.</div></main>`;
  const active = t.status === 'active';
  return `<main class="content customer-page">
    <div class="customer-heading"><div><div class="eyebrow">CUSTOMER SHOPPING SESSION</div><h1>Welcome to smart shopping</h1><p>Products are added to your bill automatically when the basket RFID reader detects their tags.</p></div><div class="trolley-chip">Trolley <strong>${esc(t.id)}</strong></div></div>
    <section class="panel session-panel"><div><span class="eyebrow">SESSION STATUS</span><h2>${active ? 'Shopping in progress' : t.status === 'paid' ? 'Payment completed' : 'Ready to begin'}</h2><p>${active ? 'Your cart is syncing with the store billing system.' : 'Start your session to begin adding products.'}</p></div><button class="btn btn-primary" data-action="start" ${active ? 'disabled' : ''}>${active ? 'Session active' : 'Start shopping'}</button></section>
    <section class="panel"><div class="section-head"><div><span class="eyebrow">YOUR BASKET</span><h2>Shopping cart</h2></div><span class="count-pill">${cartItems(t).length} items</span></div>${cartTable(t)}<div class="bill-total"><span>Estimated bill</span><strong>${money(t.total)}</strong></div><div class="rfid-note"><span>◉</span> RFID events update this total automatically. No barcode scan is required.</div></section>
    <section class="panel"><div class="section-head"><div><span class="eyebrow">DEMO CONTROLS</span><h2>Simulate product detection</h2></div><span class="demo-label">Prototype only</span></div>${productControls(t)}</section>
    <section class="checkout-strip"><div><span class="eyebrow">READY TO CHECK OUT?</span><h2>${t.checkoutStatus === 'awaiting_gate' ? 'Waiting for checkout reader' : t.checkoutStatus === 'ready_to_pay' ? 'Trolley tag recognized' : 'Skip the checkout queue'}</h2><p>${t.checkoutStatus === 'awaiting_gate' ? 'Proceed to the existing checkout reader. The cashier scans your trolley RFID tag.' : t.checkoutStatus === 'ready_to_pay' ? 'Your bill has been matched. Complete the demo payment below.' : 'Press Pay now, then scan the trolley tag at the existing checkout reader.'}</p></div><div class="checkout-actions"><button class="btn btn-primary" data-action="checkout" ${!active || !cartItems(t).length || t.checkoutStatus === 'awaiting_gate' || t.checkoutStatus === 'ready_to_pay' ? 'disabled' : ''}>Pay now</button>${t.checkoutStatus === 'ready_to_pay' ? `<select id="pay-method" class="select"><option>UPI</option><option>Card</option><option>Cash</option></select><button class="btn btn-primary" data-action="pay">Confirm demo payment</button>` : ''}</div></section>
    ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
  </main>`;
}

function mapSvg() {
  const x = (v) => 35 + v * 6.2;
  const y = (v) => 25 + v * 3.6;
  const grid = Array.from({ length: 9 }, (_, i) => `<line x1="${35 + i * 77.5}" y1="25" x2="${35 + i * 77.5}" y2="385" class="map-grid"/><line x1="35" y1="${25 + i * 45}" x2="655" y2="${25 + i * 45}" class="map-grid"/>`).join('');
  const trails = state.trolleys.map((t) => `<polyline points="${(t.route || []).map((p) => `${x(p.x)},${y(p.y)}`).join(' ')}" class="trail"/>`).join('');
  const pins = state.trolleys.map((t, i) => `<g><circle cx="${x(t.x)}" cy="${y(t.y)}" r="17" class="trolley-pin pin-${i}"/><text x="${x(t.x)}" y="${y(t.y) + 4}" text-anchor="middle" class="pin-text">${i + 1}</text><text x="${x(t.x)}" y="${y(t.y) + 31}" text-anchor="middle" class="pin-label">${t.id}</text></g>`).join('');
  return `<svg viewBox="0 0 690 420" role="img" aria-label="Illustrative two dimensional supermarket trolley map">${grid}<rect x="68" y="50" width="150" height="80" rx="9" class="store-zone"/><text x="143" y="95" class="zone-label" text-anchor="middle">DAIRY</text><rect x="270" y="50" width="150" height="80" rx="9" class="store-zone"/><text x="345" y="95" class="zone-label" text-anchor="middle">GROCERY</text><rect x="470" y="50" width="150" height="80" rx="9" class="store-zone"/><text x="545" y="95" class="zone-label" text-anchor="middle">BAKERY</text><rect x="70" y="245" width="150" height="90" rx="9" class="store-zone"/><text x="145" y="294" class="zone-label" text-anchor="middle">CHECKOUT</text><rect x="270" y="245" width="150" height="90" rx="9" class="store-zone"/><text x="345" y="294" class="zone-label" text-anchor="middle">SNACKS</text><rect x="470" y="245" width="150" height="90" rx="9" class="store-zone"/><text x="545" y="294" class="zone-label" text-anchor="middle">STAPLES</text>${trails}${pins}</svg>`;
}
function dashboardView() {
  const t = current();
  const openAlerts = state.alerts.filter((a) => a.status === 'open');
  const totalSales = state.payments.reduce((sum, p) => sum + p.amount, 0);
  return `<main class="content">
    <div class="page-heading"><div><div class="eyebrow">STORE OPERATIONS</div><h1>Master control center</h1><p>Live overview of trolley sessions, basket totals and staff-review alerts.</p></div><div class="heading-actions"><button class="btn btn-secondary" data-action="move">Move all trolleys</button><button class="btn btn-primary" data-action="demo">Run demo sequence</button></div></div>
    <section class="metric-grid"><article class="metric"><span>Active sessions</span><strong>${state.trolleys.filter((x) => x.status === 'active').length}</strong><small>Across all monitored trolleys</small></article><article class="metric"><span>Open alerts</span><strong>${openAlerts.length}</strong><small>Requires staff review</small></article><article class="metric"><span>Demo sales</span><strong>${money(totalSales)}</strong><small>Paid transactions only</small></article><article class="metric"><span>Connected trolleys</span><strong>${state.trolleys.length}</strong><small>UHF trolley identity tags</small></article></section>
    <div class="main-columns"><section class="panel map-panel"><div class="section-head"><div><span class="eyebrow">MULTI-TROLLEY DIGITAL TWIN</span><h2>Store floor overview</h2></div><span class="map-caption">2D simulation</span></div><div class="map-wrap">${mapSvg()}</div><div class="map-legend"><span><i class="legend-dot green"></i>Trolley live position</span><span><i class="legend-line"></i>Recent movement trail</span></div><p class="fine-print">Illustrative 2D shared floor plan. A real deployment needs LiDAR/IMU/encoder localization and a validated map.</p></section>
    <section class="panel trolley-panel"><div class="section-head"><div><span class="eyebrow">FLEET</span><h2>Trolley status</h2></div><span class="count-pill">${state.trolleys.length} units</span></div>${state.trolleys.map((x) => `<button class="trolley-row ${x.id === selectedTrolley ? 'selected' : ''}" data-action="select" data-trolley="${x.id}"><span class="trolley-icon">🛒</span><span class="trolley-details"><strong>${x.id}</strong><small>${esc(x.status)} · ${esc(x.checkoutStatus.replaceAll('_', ' '))}</small></span><strong>${money(x.total)}</strong></button>`).join('')}</section></div>
    <div class="main-columns lower"><section class="panel"><div class="section-head"><div><span class="eyebrow">SELECTED TROLLEY</span><h2>${esc(t?.id || '—')} · Live basket</h2></div><span class="status-tag">${esc(t?.status || 'unknown')}</span></div><div class="trolley-meta"><div><small>Unique trolley EPC</small><code>${esc(t?.trolleyEpc || '')}</code></div><div><small>Expected weight</small><strong>${(t?.expectedWeightKg || 0).toFixed(2)} kg</strong></div><div><small>Measured weight</small><strong>${(t?.measuredWeightKg || 0).toFixed(2)} kg</strong></div></div>${cartTable(t)}<div class="bill-total"><span>Backend-calculated bill</span><strong>${money(t?.total)}</strong></div><div class="reader-actions"><button class="btn btn-secondary" data-action="gate-scan" ${t?.checkoutStatus !== 'awaiting_gate' ? 'disabled' : ''}>Simulate existing checkout reader scan</button><button class="btn btn-secondary" data-action="anomaly">Inject weight anomaly</button></div>${latestBill && latestBill.trolleyId === t?.id ? `<div class="bill-preview"><strong>Reader matched bill · ${money(latestBill.total)}</strong><small>${latestBill.items.map((i) => `${esc(i.name)} × ${i.quantity}`).join(' · ')}</small></div>` : ''}</section>
    <section class="panel alerts-panel"><div class="section-head"><div><span class="eyebrow">EXCEPTIONS</span><h2>Staff review alerts</h2></div><span class="count-pill">${openAlerts.length} open</span></div>${openAlerts.length ? openAlerts.map((a) => `<div class="alert-row"><span class="alert-symbol">!</span><div class="alert-copy"><strong>${esc(a.trolleyId)} · ${esc(a.type.replaceAll('_', ' '))}</strong><p>${esc(a.message)}</p><small>${new Date(a.createdAt).toLocaleTimeString()}</small></div><button class="tiny" data-action="resolve" data-alert="${a.id}">Mark reviewed</button></div>`).join('') : '<div class="empty compact">No open alerts.</div>'}</section></div>
    <section class="panel integration-panel"><div><span class="eyebrow">SYSTEM FLOW</span><h2>RFID billing and checkout</h2><p>Product EPC → basket RFID zone → cart total → customer Pay now → existing checkout reader scans trolley EPC → payment confirmation → inventory deduction.</p></div><div class="flow-pills"><span>Product EPC</span><b>→</b><span>Cart bill</span><b>→</b><span>Trolley EPC</span><b>→</b><span>Payment</span></div></section>
    ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
  </main>`;
}

function render() {
  const app = document.querySelector('#app');
  if (!app) return;
  app.innerHTML = `${header()}${nav()}${mode === 'customer' ? customerView() : dashboardView()}<footer>Smart Trolley Prototype · Simulated sensor events · No real payments or gate hardware connected</footer>`;
  app.querySelectorAll('[data-mode]').forEach((el) => el.addEventListener('click', () => {
    mode = el.dataset.mode;
    const url = new URL(location.href); url.searchParams.set('view', mode); url.searchParams.set('trolley', selectedTrolley); history.replaceState({}, '', url);
    render();
  }));
  app.querySelectorAll('[data-action]').forEach((el) => el.addEventListener('click', () => handleAction(el.dataset.action, el.dataset)));
}

async function handleAction(action, data) {
  const t = current();
  try {
    if (action === 'select') { selectedTrolley = data.trolley; latestBill = null; render(); return; }
    if (action === 'reset') { latestBill = null; await api('/api/simulation/reset', {}); return; }
    if (action === 'start') await api('/api/session/start', { trolleyId: selectedTrolley });
    if (action === 'add') await api('/api/rfid/read', { trolleyId: selectedTrolley, epc: data.epc, action: 'add' });
    if (action === 'remove') await api('/api/rfid/read', { trolleyId: selectedTrolley, epc: data.epc, action: 'remove' });
    if (action === 'checkout') await api('/api/checkout/request', { trolleyId: selectedTrolley });
    if (action === 'gate-scan') await api('/api/checkout/scan-trolley', { trolleyEpc: t.trolleyEpc });
    if (action === 'pay') { await api('/api/checkout/pay', { trolleyId: selectedTrolley, method: document.querySelector('#pay-method')?.value || 'UPI' }); latestBill = null; }
    if (action === 'move') await api('/api/simulation/move', {});
    if (action === 'demo') await api('/api/simulation/run-demo', {});
    if (action === 'anomaly') await api('/api/sensors/weight', { trolleyId: selectedTrolley, measuredKg: Number((t.expectedWeightKg + 0.9).toFixed(2)) });
    if (action === 'resolve') await api(`/api/alerts/${data.alert}/resolve`, {});
  } catch (_) { /* Error is shown in the notice region. */ }
}

async function init() {
  try { state = await fetch(`${API}/api/state`).then((r) => { if (!r.ok) throw new Error('API unavailable'); return r.json(); }); }
  catch { notice = 'Cannot reach backend. Start the API in the server folder, then refresh this page.'; }
  render();
}
init();

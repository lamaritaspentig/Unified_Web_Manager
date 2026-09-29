const CFG = window.UNIFIED_MANAGER_CONFIG || {};
const URL = String(CFG.APPS_SCRIPT_URL || '').trim();
const SESSION = 'unified_admin_session_v1';
const CLIENT = 'unified_client_id_v1';
const $ = id => document.getElementById(id);

function sget(storage, key) {
  try { return storage.getItem(key) || ''; } catch (_) { return ''; }
}
function sset(storage, key, value) {
  try { storage.setItem(key, value); return true; } catch (_) { return false; }
}
function sdel(storage, key) {
  try { storage.removeItem(key); } catch (_) {}
}
function nonce() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  try {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  }
}
function isAppsScriptResponseOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && (
      url.hostname === 'script.google.com' ||
      url.hostname === 'script.googleusercontent.com' ||
      url.hostname.endsWith('.googleusercontent.com')
    );
  } catch (_) {
    return false;
  }
}
function validBackendUrl() {
  return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:[?#].*)?$/.test(URL);
}

let client = sget(localStorage, CLIENT);
if (!/^[A-Za-z0-9_-]{20,120}$/.test(client)) {
  client = nonce().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96);
  if (client.length < 20) client = `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  sset(localStorage, CLIENT, client);
}
let session = sget(sessionStorage, SESSION);
let seq = 0;
const pending = new Map();

window.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.type !== 'gitpage-rpc-result' || !msg.id || !msg.nonce) return;

  const p = pending.get(msg.id);
  if (!p || p.nonce !== msg.nonce) return;

  const exactFrameSource = event.source === p.frame.contentWindow;
  const trustedOrigin = isAppsScriptResponseOrigin(event.origin) ||
    (event.origin === 'null' && exactFrameSource);
  if (!exactFrameSource || !trustedOrigin) return;

  pending.delete(msg.id);
  clearTimeout(p.timer);
  p.frame.remove();

  if (msg.ok) {
    p.resolve(msg.result);
    return;
  }

  const err = new Error(msg.error || 'Backend error');
  if (/Sesi admin|Token sesi/i.test(err.message)) {
    session = '';
    sdel(sessionStorage, SESSION);
    show();
  }
  p.reject(err);
});

function rpc(method, ...args) {
  return new Promise((resolve, reject) => {
    if (!validBackendUrl()) {
      reject(new Error('Isi APPS_SCRIPT_URL pada config.js terlebih dahulu.'));
      return;
    }

    const id = `rpc_${Date.now()}_${++seq}`;
    const n = nonce();
    const frame = document.createElement('iframe');
    frame.name = `uf_${seq}_${Date.now()}`;
    frame.title = 'Unified Manager RPC';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(frame);

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = URL;
    form.target = frame.name;
    form.acceptCharset = 'UTF-8';
    form.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify({
      id,
      nonce: n,
      method,
      args,
      sessionToken: session,
      clientId: client,
      clientApp: 'gitpage',
      requestOrigin: location.origin
    });
    form.appendChild(input);
    document.body.appendChild(form);

    const timer = setTimeout(() => {
      pending.delete(id);
      frame.remove();
      reject(new Error('Backend tidak merespons. Periksa deployment Apps Script dan FRONTEND_ORIGIN.'));
    }, 45000);

    pending.set(id, { resolve, reject, nonce: n, timer, frame });
    try { form.submit(); }
    catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      frame.remove();
      reject(err);
    } finally {
      form.remove();
    }
  });
}

function show() {
  if (session) {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
  } else {
    $('appView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
  }
}

$('togglePassword').onclick = () => {
  const input = $('password');
  input.type = input.type === 'password' ? 'text' : 'password';
};

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('error').textContent = '';
  $('loginBtn').disabled = true;
  const original = $('loginBtn').textContent;
  $('loginBtn').textContent = 'Memeriksa...';
  try {
    const result = await rpc('loginAdmin', $('password').value);
    session = String(result && result.sessionToken || '');
    if (!session) throw new Error('Backend tidak mengembalikan sesi login.');
    sset(sessionStorage, SESSION, session);
    $('password').value = '';
    show();
  } catch (err) {
    $('error').textContent = err.message || 'Login gagal.';
  } finally {
    $('loginBtn').disabled = false;
    $('loginBtn').textContent = original;
  }
});

$('logoutBtn').onclick = async () => {
  try { await rpc('logoutAdmin'); } catch (_) {}
  session = '';
  sdel(sessionStorage, SESSION);
  show();
};

if (!validBackendUrl()) {
  $('error').textContent = 'Isi APPS_SCRIPT_URL pada config.js terlebih dahulu.';
}
show();

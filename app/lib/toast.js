// Premium toast notifications — supports types: success, error, warning, info
// Usage: toast('Card added!') | toast('Error', 'error') | toast('Message', true) [legacy warn]
export function toast(msg, typeOrWarn = false) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('toasts');
  if (!container) return;

  // Normalize type param
  let type = 'success';
  if (typeOrWarn === true || typeOrWarn === 'error') type = 'error';
  else if (typeOrWarn === 'warning') type = 'warning';
  else if (typeOrWarn === 'info') type = 'info';

  // Limit to 4 concurrent toasts
  while (container.children.length >= 4) {
    container.removeChild(container.firstChild);
  }

  const t = document.createElement('div');
  t.className = `toast ${type !== 'success' ? 'warn' : ''}`;
  t.classList.add('toast-enter');

  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  t.innerHTML = `<span class="ti">${icons[type]}</span><span class="toast-msg">${msg}</span>`;
  container.appendChild(t);

  const lifetime = type === 'error' ? 4000 : 2800;
  const timer = setTimeout(() => remove(t), lifetime);

  // Click to dismiss
  t.addEventListener('click', () => { clearTimeout(timer); remove(t); });

  function remove(el) {
    el.classList.remove('toast-enter');
    el.classList.add('toast-exit');
    setTimeout(() => el.remove(), 200);
  }
}

// Convenience wrappers
toast.success = (msg) => toast(msg, false);
toast.error = (msg) => toast(msg, 'error');
toast.warning = (msg) => toast(msg, 'warning');
toast.info = (msg) => toast(msg, 'info');

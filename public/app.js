const pinForm = document.getElementById('pin-form');
const pinInput = document.getElementById('pin-input');
const pinMessage = document.getElementById('pin-message');
const authCard = document.getElementById('auth-card');
const statusCard = document.getElementById('status-card');
const noteCard = document.getElementById('note-card');
const statusIndicator = document.getElementById('status-indicator');
const statusTitle = document.getElementById('status-title');
const statusSubtitle = document.getElementById('status-subtitle');
const actionButton = document.getElementById('action-button');
const actionMessage = document.getElementById('action-message');
const noteTitle = document.getElementById('note-title');
const noteForm = document.getElementById('note-form');
const noteInput = document.getElementById('note-input');
const noteMessage = document.getElementById('note-message');
const noteCancel = document.getElementById('note-cancel');
const logoutButton = document.getElementById('logout');

let authToken = null;
let pendingType = null;

function showCard(card) {
  [authCard, statusCard, noteCard].forEach((el) => {
    el.classList.toggle('hidden', el !== card);
  });
}

function setMessage(element, text, isError = true) {
  element.textContent = text;
  element.style.color = isError ? '#dc2626' : '#16a34a';
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || 'Request failed.';
    throw new Error(message);
  }
  return payload;
}

async function refreshStatus() {
  const data = await apiFetch('/api/status');
  statusIndicator.textContent = data.status;
  statusIndicator.classList.toggle('in', data.status === 'IN');
  statusIndicator.classList.toggle('out', data.status === 'OUT');
  statusTitle.textContent = data.status === 'IN' ? 'You are clocked IN' : 'You are clocked OUT';
  statusSubtitle.textContent = data.lastEvent
    ? `Last punch ${data.lastEvent.type} at ${new Date(data.lastEvent.at).toLocaleTimeString()}.`
    : 'No punches recorded yet.';
  actionButton.textContent = data.status === 'IN' ? 'Punch OUT' : 'Punch IN';
  actionButton.dataset.type = data.status === 'IN' ? 'OUT' : 'IN';
}

pinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  pinMessage.textContent = '';
  try {
    const payload = await apiFetch('/api/auth/pin', {
      method: 'POST',
      body: JSON.stringify({ pin: pinInput.value }),
    });
    authToken = payload.token;
    pinInput.value = '';
    await refreshStatus();
    showCard(statusCard);
  } catch (error) {
    setMessage(pinMessage, error.message);
  }
});

logoutButton.addEventListener('click', () => {
  authToken = null;
  showCard(authCard);
});

actionButton.addEventListener('click', () => {
  pendingType = actionButton.dataset.type;
  noteTitle.textContent = pendingType === 'IN' ? 'Punch IN note' : 'Punch OUT note';
  noteInput.value = '';
  noteMessage.textContent = '';
  showCard(noteCard);
});

noteCancel.addEventListener('click', () => {
  pendingType = null;
  showCard(statusCard);
});

noteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!pendingType) {
    return;
  }
  noteMessage.textContent = '';
  try {
    await apiFetch('/api/punch', {
      method: 'POST',
      body: JSON.stringify({ type: pendingType, note: noteInput.value.trim() }),
    });
    setMessage(actionMessage, `Punch ${pendingType} recorded.`, false);
    pendingType = null;
    await refreshStatus();
    showCard(statusCard);
  } catch (error) {
    setMessage(noteMessage, error.message);
  }
});

showCard(authCard);

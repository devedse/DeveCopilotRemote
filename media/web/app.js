const navButtons = Array.from(document.querySelectorAll('.section-rail__item'));
const panels = {
  chat: document.getElementById('panel-chat'),
  changes: document.getElementById('panel-changes'),
  files: document.getElementById('panel-files')
};

const connectionStatus = document.getElementById('connectionStatus');
const chatForm = document.getElementById('chatForm');
const promptInput = document.getElementById('prompt');
const promptMeta = document.getElementById('promptMeta');
const modeInput = document.getElementById('mode');
const modelInput = document.getElementById('model');
const attachActiveFileInput = document.getElementById('attachActiveFile');
const submitButton = document.getElementById('submitButton');
const clearButton = document.getElementById('clearButton');
const activityLog = document.getElementById('activityLog');
const emptyState = document.getElementById('emptyState');
const toast = document.getElementById('toast');

const searchParams = new URLSearchParams(window.location.search);
const initialToken = searchParams.get('token') || localStorage.getItem('deveCopilotRemoteToken') || '';

if (initialToken) {
  localStorage.setItem('deveCopilotRemoteToken', initialToken);
}

navButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const panelName = button.dataset.panel;
    if (!panelName || !panels[panelName]) {
      return;
    }

    navButtons.forEach((item) => item.classList.toggle('is-active', item === button));

    Object.entries(panels).forEach(([name, panel]) => {
      const isActive = name === panelName;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });
  });
});

promptInput.addEventListener('input', () => {
  promptMeta.textContent = `${promptInput.value.length} / 12000`;
});

// Enter to send, Shift+Enter for newline
promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

clearButton.addEventListener('click', () => {
  promptInput.value = '';
  promptMeta.textContent = '0 / 12000';
  promptInput.focus();
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const prompt = promptInput.value.trim();
  if (!prompt) {
    showToast('Prompt is required.', 'error');
    promptInput.focus();
    return;
  }

  setBusy(true);

  // Clear input immediately and keep focus
  promptInput.value = '';
  promptMeta.textContent = '0 / 12000';
  promptInput.focus();

  const userTurn = addUserTurn({
    prompt,
    mode: modeInput.value,
    attached: attachActiveFileInput.checked
  });
  const assistantTurn = addAssistantTurn();

  try {
    const token = localStorage.getItem('deveCopilotRemoteToken') || '';
    const body = {
      prompt,
      mode: modeInput.value,
      attachActiveFile: attachActiveFileInput.checked
    };
    if (modelInput && modelInput.value) {
      body.model = modelInput.value;
    }
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DeveCopilotRemote-Token': token
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Failed to submit prompt.');
    }

    if (!response.body) {
      throw new Error('Streaming response body was not available.');
    }

    await consumeStream(response.body, assistantTurn);

    showToast('Prompt submitted to VS Code chat.', 'success');
  } catch (error) {
    setAssistantTurnError(assistantTurn, error instanceof Error ? error.message : String(error));
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    setBusy(false);
  }
});

initialize().catch((error) => {
  showToast(error instanceof Error ? error.message : String(error), 'error');
});

async function initialize() {
  const response = await fetch('/api/status');
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    connectionStatus.textContent = 'Unavailable';
    return;
  }

  connectionStatus.textContent = 'Connected';

  if (payload.defaultMode && typeof payload.defaultMode === 'string') {
    modeInput.value = payload.defaultMode;
  }

  // Load available models
  await loadModels();
}

async function loadModels() {
  if (!modelInput) {
    return;
  }

  try {
    const token = localStorage.getItem('deveCopilotRemoteToken') || '';
    const response = await fetch(`/api/models?token=${encodeURIComponent(token)}`);
    const payload = await response.json();

    if (!response.ok || !payload.ok || !payload.models) {
      return;
    }

    modelInput.innerHTML = '<option value="">Default</option>';
    for (const model of payload.models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name || model.id;
      modelInput.appendChild(option);
    }
  } catch {
    // Models not available — that's fine
  }
}

function addUserTurn(entry) {
  if (emptyState) {
    emptyState.hidden = true;
  }

  const userTurn = document.createElement('article');
  userTurn.className = 'turn turn--user';

  const userAvatar = document.createElement('div');
  userAvatar.className = 'turn__avatar';
  userAvatar.textContent = 'You';

  const userBody = document.createElement('div');
  userBody.className = 'turn__body';

  const time = document.createElement('span');
  time.className = 'activity-log__time';
  time.textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });

  const userHeader = document.createElement('div');
  userHeader.className = 'turn__header';

  const userAuthor = document.createElement('span');
  userAuthor.className = 'turn__author';
  userAuthor.textContent = 'You';

  time.className = 'turn__time';
  userHeader.appendChild(userAuthor);
  userHeader.appendChild(time);

  const userContent = document.createElement('div');
  userContent.className = 'turn__content';

  const userText = document.createElement('p');
  userText.textContent = entry.prompt;

  userContent.appendChild(userText);
  userBody.appendChild(userHeader);
  userBody.appendChild(userContent);
  userTurn.appendChild(userAvatar);
  userTurn.appendChild(userBody);

  activityLog.appendChild(userTurn);
  scrollTranscriptToBottom();
  return userTurn;
}

function addAssistantTurn() {
  if (emptyState) {
    emptyState.hidden = true;
  }

  const assistantTurn = document.createElement('article');
  assistantTurn.className = 'turn turn--assistant';

  const assistantAvatar = document.createElement('div');
  assistantAvatar.className = 'turn__avatar';
  assistantAvatar.textContent = '✦';

  const assistantBody = document.createElement('div');
  assistantBody.className = 'turn__body';

  const assistantHeader = document.createElement('div');
  assistantHeader.className = 'turn__header';

  const assistantAuthor = document.createElement('span');
  assistantAuthor.className = 'turn__author';
  assistantAuthor.textContent = 'GitHub Copilot';

  const assistantTime = document.createElement('span');
  assistantTime.className = 'turn__time';
  assistantTime.textContent = 'Streaming';

  assistantHeader.appendChild(assistantAuthor);
  assistantHeader.appendChild(assistantTime);

  const assistantContent = document.createElement('div');
  assistantContent.className = 'turn__content';

  const assistantText = document.createElement('p');
  assistantText.textContent = '';

  const assistantStatus = document.createElement('p');
  assistantStatus.className = 'turn__status';
  assistantStatus.textContent = 'Submitting to VS Code...';

  const changesContainer = document.createElement('div');
  changesContainer.className = 'turn__changes';

  assistantContent.appendChild(assistantText);
  assistantContent.appendChild(changesContainer);
  assistantContent.appendChild(assistantStatus);
  assistantBody.appendChild(assistantHeader);
  assistantBody.appendChild(assistantContent);
  assistantTurn.appendChild(assistantAvatar);
  assistantTurn.appendChild(assistantBody);

  activityLog.appendChild(assistantTurn);
  scrollTranscriptToBottom();

  return {
    root: assistantTurn,
    textNode: assistantText,
    statusNode: assistantStatus,
    timeNode: assistantTime,
    changesNode: changesContainer
  };
}

async function consumeStream(stream, assistantTurn) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      handleStreamEvent(JSON.parse(line), assistantTurn);
    }
  }

  if (buffered.trim()) {
    handleStreamEvent(JSON.parse(buffered), assistantTurn);
  }
}

function handleStreamEvent(event, assistantTurn) {
  if (event.type === 'status') {
    assistantTurn.statusNode.textContent = event.message;
    if (event.stage === 'response-complete') {
      assistantTurn.timeNode.textContent = 'Done';
    }
  } else if (event.type === 'change') {
    renderSingleChange(event.file, assistantTurn.changesNode);
  } else if (event.type === 'error') {
    setAssistantTurnError(assistantTurn, event.message);
  } else if (event.type === 'done') {
    if (event.note) {
      assistantTurn.statusNode.textContent = event.note;
    }
    if (!assistantTurn.textNode.textContent.trim() && assistantTurn.changesNode.children.length === 0) {
      assistantTurn.textNode.textContent = 'Response is in the VS Code chat panel on your desktop.';
    }
    assistantTurn.timeNode.textContent = 'Done';
  }

  scrollTranscriptToBottom();
}

function setAssistantTurnError(assistantTurn, message) {
  assistantTurn.root.classList.add('turn--error');
  assistantTurn.statusNode.textContent = message;
  if (!assistantTurn.textNode.textContent.trim()) {
    assistantTurn.textNode.textContent = 'Failed to submit prompt to VS Code.';
  }
  assistantTurn.timeNode.textContent = 'Error';
  scrollTranscriptToBottom();
}

function scrollTranscriptToBottom() {
  const transcript = document.getElementById('transcript');
  if (transcript) {
    transcript.scrollTop = transcript.scrollHeight;
  }
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  clearButton.disabled = isBusy;
  submitButton.textContent = isBusy ? 'Sending...' : 'Send to chat';
}

let toastTimer;

function showToast(message, type) {
  toast.textContent = message;
  toast.hidden = false;
  toast.className = `toast is-${type}`;

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function renderChanges(files, container) {
  container.innerHTML = '';

  if (!files || files.length === 0) {
    return;
  }

  const header = document.createElement('p');
  header.className = 'diff-header';
  header.textContent = `${files.length} file${files.length === 1 ? '' : 's'} changed`;
  container.appendChild(header);

  for (const file of files) {
    renderSingleChange(file, container);
  }
}

function renderSingleChange(file, container) {
  const fileBlock = document.createElement('details');
  fileBlock.className = 'diff-file';

  const summary = document.createElement('summary');
  summary.className = 'diff-file__summary';

  const statusBadge = document.createElement('span');
  statusBadge.className = `diff-badge diff-badge--${file.status}`;
  statusBadge.textContent = file.status.charAt(0).toUpperCase();

  const fileName = document.createElement('span');
  fileName.className = 'diff-file__name';
  fileName.textContent = file.path;

  summary.appendChild(statusBadge);
  summary.appendChild(fileName);
  fileBlock.appendChild(summary);

  const diffBlock = document.createElement('pre');
  diffBlock.className = 'diff-block';

  const lines = file.diff.split('\n');
  for (const line of lines) {
    const lineEl = document.createElement('span');

    if (line.startsWith('+') && !line.startsWith('+++')) {
      lineEl.className = 'diff-line diff-line--added';
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      lineEl.className = 'diff-line diff-line--removed';
    } else if (line.startsWith('@@')) {
      lineEl.className = 'diff-line diff-line--hunk';
    } else {
      lineEl.className = 'diff-line';
    }

    lineEl.textContent = line;
    diffBlock.appendChild(lineEl);
    diffBlock.appendChild(document.createTextNode('\n'));
  }

  fileBlock.appendChild(diffBlock);
  container.appendChild(fileBlock);
}

// Changes panel: live SSE stream
const changesPanel = document.getElementById('panel-changes');
const changesPanelContent = changesPanel?.querySelector('.placeholder-view');
let changesEventSource = null;

navButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.panel === 'changes') {
      startChangesStream();
    } else {
      stopChangesStream();
    }
  });
});

function startChangesStream() {
  if (changesEventSource) {
    return;
  }

  const token = localStorage.getItem('deveCopilotRemoteToken') || '';
  changesEventSource = new EventSource(`/api/changes?token=${encodeURIComponent(token)}`);

  let target = changesPanel.querySelector('.changes-list');
  if (!target) {
    target = document.createElement('div');
    target.className = 'changes-list';
    changesPanel.appendChild(target);
  }

  if (changesPanelContent) {
    changesPanelContent.hidden = true;
  }

  changesEventSource.onmessage = (event) => {
    try {
      const change = JSON.parse(event.data);
      renderSingleChange(change, target);
    } catch {
      // ignore parse errors
    }
  };

  changesEventSource.onerror = () => {
    stopChangesStream();
  };
}

function stopChangesStream() {
  if (changesEventSource) {
    changesEventSource.close();
    changesEventSource = null;
  }
}
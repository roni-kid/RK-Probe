const candidateSelect = document.querySelector('#candidate-select');
const startButton = document.querySelector('#start-button');
const answerForm = document.querySelector('#answer-form');
const answerInput = document.querySelector('#answer-input');
const sendButton = document.querySelector('#send-button');
const messages = document.querySelector('#messages');
const typingIndicator = document.querySelector('#typing-indicator');
const errorMessage = document.querySelector('#error-message');
const feedbackSection = document.querySelector('#feedback');
const statusDot = document.querySelector('#status-dot');
const statusText = document.querySelector('#status-text');

let candidates = [];
let sessionId = null;
let interviewComplete = false;

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function clearError() {
  errorMessage.hidden = true;
  errorMessage.textContent = '';
}

function setStatus(state, label) {
  statusDot.classList.remove('is-live', 'is-done');
  if (state) statusDot.classList.add(state);
  statusText.textContent = label;
}

function setWaiting(isWaiting) {
  typingIndicator.hidden = !isWaiting;
  startButton.disabled = isWaiting || candidates.length === 0 || Boolean(sessionId);
  answerInput.disabled = isWaiting || interviewComplete;
  sendButton.disabled = isWaiting || interviewComplete;
}

function addMessage(text, speaker) {
  const emptyState = messages.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const message = document.createElement('div');
  message.className = `message ${speaker}`;
  message.textContent = text;
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

function createSessionId() {
  return crypto.randomUUID ? crypto.randomUUID() : `rk-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function callInterviewApi(payload) {
  const response = await fetch('/api/interview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || 'The interview service could not complete this request.');
  }
  return body;
}

function createFeedbackList(title, items) {
  const heading = document.createElement('h3');
  heading.textContent = title;
  const list = document.createElement('ul');
  (items || []).forEach((item) => {
    const listItem = document.createElement('li');
    listItem.textContent = item;
    list.append(listItem);
  });
  feedbackSection.append(heading, list);
}

function renderFeedback(feedback) {
  feedbackSection.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = 'Interview feedback';
  const summaryHeading = document.createElement('h3');
  summaryHeading.textContent = 'Summary';
  const summary = document.createElement('p');
  summary.textContent = feedback?.summary || 'No written feedback was returned.';
  feedbackSection.append(title, summaryHeading, summary);
  createFeedbackList('Strengths', feedback?.strengths);
  createFeedbackList('Gaps', feedback?.gaps);
  createFeedbackList('Next steps', feedback?.next);
  feedbackSection.hidden = false;
}

async function loadCandidates() {
  try {
    const response = await fetch('/candidates.json');
    if (!response.ok) throw new Error('Could not load the demo candidates.');
    const data = await response.json();
    candidates = data.candidates || [];
    if (candidates.length === 0) throw new Error('No demo candidates were found.');

    candidateSelect.replaceChildren();
    candidates.forEach((candidate, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${candidate.member.name} — ${candidate.member.jobRole}`;
      candidateSelect.append(option);
    });
    candidateSelect.disabled = false;
    startButton.disabled = false;
  } catch (error) {
    candidateSelect.replaceChildren(new Option('Candidates unavailable'));
    showError(error.message);
  }
}

startButton.addEventListener('click', async () => {
  clearError();
  sessionId = createSessionId();
  const candidate = candidates[Number(candidateSelect.value)];
  setWaiting(true);
  setStatus(null, 'Connecting…');

  try {
    const result = await callInterviewApi({ sessionId, candidate });
    addMessage(result.reply, 'interviewer');
    answerForm.hidden = false;
    answerInput.focus();
    setStatus('is-live', 'Interview in progress');
  } catch (error) {
    sessionId = null;
    showError(error.message);
    setStatus(null, 'Waiting to start');
  } finally {
    setWaiting(false);
  }
});

answerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = answerInput.value.trim();
  if (!message || !sessionId || interviewComplete) return;

  clearError();
  addMessage(message, 'candidate');
  answerInput.value = '';
  setWaiting(true);

  try {
    const result = await callInterviewApi({ sessionId, message });
    addMessage(result.reply, 'interviewer');
    if (result.done) {
      interviewComplete = true;
      answerForm.hidden = true;
      renderFeedback(result.feedback);
      setStatus('is-done', 'Interview complete');
    }
  } catch (error) {
    answerInput.value = message;
    showError(error.message);
  } finally {
    setWaiting(false);
    if (!interviewComplete) answerInput.focus();
  }
});

loadCandidates();
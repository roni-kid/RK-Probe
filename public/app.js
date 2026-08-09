const candidateGrid = document.querySelector('#candidate-grid');
const startPanel = document.querySelector('.start-panel');
const loadingView = document.querySelector('#loading-view');
const loadingViewText = document.querySelector('#loading-view-text');
const answerForm = document.querySelector('#answer-form');
const answerInput = document.querySelector('#answer-input');
const sendButton = document.querySelector('#send-button');
const messages = document.querySelector('#messages');
const typingIndicator = document.querySelector('#typing-indicator');
const errorMessage = document.querySelector('#error-message');
const feedbackSection = document.querySelector('#feedback');
const statusDot = document.querySelector('#status-dot');
const statusText = document.querySelector('#status-text');
const micButton = document.querySelector('#mic-button');
const voiceStatus = document.querySelector('#voice-status');
const candidatePanel = document.querySelector('#candidate-panel');
const candidateAvatar = document.querySelector('#candidate-avatar');
const candidateName = document.querySelector('#candidate-name');
const candidateRole = document.querySelector('#candidate-role');
const candidateExperience = document.querySelector('#candidate-experience');
const candidateEducation = document.querySelector('#candidate-education');
const progressPanel = document.querySelector('#progress-panel');
const questionsCount = document.querySelector('#questions-count');
const daysProgressBar = document.querySelector('#days-progress-bar');
const daysProgressFill = document.querySelector('#days-progress-fill');
const daysProgressCaption = document.querySelector('#days-progress-caption');
const focusList = document.querySelector('#focus-list');
const workspace = document.querySelector('.workspace');
const restartButton = document.querySelector('#restart-button');

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
  answerInput.disabled = isWaiting || interviewComplete;
  sendButton.disabled = isWaiting || interviewComplete;
  micButton.disabled = isWaiting || interviewComplete;
  if ((isWaiting || interviewComplete) && isRecording) stopRecording();
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

// Formats the feedback object as clean plain text for the clipboard — no
// stray JSON braces/quotes, just readable summary + bulleted sections.
function formatFeedbackAsText(feedback) {
  const lines = ['RK Probe — Interview Feedback', ''];
  lines.push('Summary:');
  lines.push(feedback?.summary || 'No written feedback was returned.');

  const section = (title, items) => {
    if (!items || items.length === 0) return;
    lines.push('', `${title}:`);
    items.forEach((item) => lines.push(`- ${item}`));
  };
  section('Strengths', feedback?.strengths);
  section('Gaps', feedback?.gaps);
  section('Next steps', feedback?.next);

  return lines.join('\n');
}

function createCopyFeedbackButton(feedback) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-feedback-button button-secondary';
  const label = document.createElement('span');
  label.className = 'btn-label';
  label.textContent = 'Copy feedback';
  button.append(label);

  let resetTimer = null;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(formatFeedbackAsText(feedback));
      label.textContent = 'Copied!';
      button.classList.add('is-copied');
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        label.textContent = 'Copy feedback';
        button.classList.remove('is-copied');
      }, 2000);
    } catch {
      label.textContent = 'Copy failed';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        label.textContent = 'Copy feedback';
      }, 2000);
    }
  });

  return button;
}

// The `reason` each focus day was chosen is deliberately redacted from the
// `progress` object during the interview (see interviewer.js), but once the
// interview is done, revealing it demonstrates RK Probe's editorial
// decision-making. Kept visually secondary (collapsed by default) since the
// feedback itself is still the primary content a candidate cares about.
function renderFocusReasoning(focusPlan) {
  if (!focusPlan || focusPlan.length === 0) return null;

  const details = document.createElement('details');
  details.className = 'focus-reasoning';
  const summaryEl = document.createElement('summary');
  summaryEl.textContent = 'Why these focus areas';
  const list = document.createElement('ul');

  focusPlan.forEach((focusDay) => {
    const item = document.createElement('li');
    const label = document.createElement('strong');
    label.textContent = `Day ${focusDay.day} — ${focusDay.title}: `;
    item.append(label, document.createTextNode(focusDay.reason || ''));
    list.append(item);
  });

  details.append(summaryEl, list);
  return details;
}

function renderFeedback(feedback, focusPlan) {
  feedbackSection.replaceChildren();

  const header = document.createElement('div');
  header.className = 'feedback-header';
  const title = document.createElement('h2');
  title.textContent = 'Interview feedback';
  header.append(title, createCopyFeedbackButton(feedback));

  const summaryHeading = document.createElement('h3');
  summaryHeading.textContent = 'Summary';
  const summary = document.createElement('p');
  summary.textContent = feedback?.summary || 'No written feedback was returned.';
  feedbackSection.append(header, summaryHeading, summary);
  createFeedbackList('Strengths', feedback?.strengths);
  createFeedbackList('Gaps', feedback?.gaps);
  createFeedbackList('Next steps', feedback?.next);

  const reasoning = renderFocusReasoning(focusPlan);
  if (reasoning) feedbackSection.append(reasoning);

  feedbackSection.hidden = false;
}

function initials(name) {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// Simple completed/total count for the card's progress bar — deliberately
// NOT the same as contextBuilder.js's priority scoring (skipped/attempts/etc).
// This is just "how much of the curriculum did they touch", shown for
// browsing/picking a candidate; the real editorial scoring only ever runs
// server-side once an interview actually starts.
function missionProgress(candidate) {
  const missions = candidate.missions || [];
  const total = missions.length;
  const completed = missions.filter((m) => m.passed === true).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percent };
}

function createCandidateCard(candidate, index) {
  const member = candidate.member ?? candidate;
  const { completed, total, percent } = missionProgress(candidate);

  const card = document.createElement('article');
  card.className = 'candidate-card';

  const header = document.createElement('div');
  header.className = 'candidate-card-header';
  const avatar = document.createElement('div');
  avatar.className = 'candidate-card-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = initials(member.name || '?');
  const identity = document.createElement('div');
  const name = document.createElement('h3');
  name.className = 'candidate-card-name';
  name.textContent = member.name || 'Unknown candidate';
  const role = document.createElement('p');
  role.className = 'candidate-card-role';
  role.textContent = member.jobRole || '';
  identity.append(name, role);
  header.append(avatar, identity);

  const meta = document.createElement('p');
  meta.className = 'candidate-card-meta';
  const experienceText = member.yearsExperience != null ? `${member.yearsExperience} yrs experience` : null;
  meta.textContent = [experienceText, member.education].filter(Boolean).join(' · ');

  const progress = document.createElement('div');
  progress.className = 'candidate-card-progress';
  const progressLabel = document.createElement('div');
  progressLabel.className = 'candidate-card-progress-label';
  const progressLabelText = document.createElement('span');
  progressLabelText.textContent = 'Curriculum progress';
  const progressLabelValue = document.createElement('span');
  progressLabelValue.textContent = `${completed}/${total}`;
  progressLabel.append(progressLabelText, progressLabelValue);
  const barTrack = document.createElement('div');
  barTrack.className = 'candidate-card-bar-track';
  barTrack.setAttribute('role', 'progressbar');
  barTrack.setAttribute('aria-label', `${member.name || 'Candidate'} curriculum progress`);
  barTrack.setAttribute('aria-valuemin', '0');
  barTrack.setAttribute('aria-valuemax', String(total));
  barTrack.setAttribute('aria-valuenow', String(completed));
  const barFill = document.createElement('div');
  barFill.className = 'candidate-card-bar-fill';
  barFill.style.width = `${percent}%`;
  barTrack.append(barFill);
  progress.append(progressLabel, barTrack);

  const startCardButton = document.createElement('button');
  startCardButton.type = 'button';
  startCardButton.className = 'candidate-card-start';
  const startLabel = document.createElement('span');
  startLabel.className = 'btn-label';
  startLabel.textContent = 'Start interview';
  startCardButton.append(startLabel);
  startCardButton.addEventListener('click', () => startInterview(candidate));

  card.append(header, meta, progress, startCardButton);
  return card;
}

function renderCandidateCards() {
  candidateGrid.replaceChildren();
  candidates.forEach((candidate, index) => {
    candidateGrid.append(createCandidateCard(candidate, index));
  });
}

function renderCandidatePanel(candidate) {
  const member = candidate.member ?? candidate;
  candidateAvatar.textContent = initials(member.name || '?');
  candidateName.textContent = member.name || 'Unknown candidate';
  candidateRole.textContent = member.jobRole || '';
  candidateExperience.textContent = member.yearsExperience != null
    ? `${member.yearsExperience} years`
    : 'Not specified';
  candidateEducation.textContent = member.education || 'Not specified';
  candidatePanel.hidden = false;
}

// Renders the right-hand progress panel from the `progress` object the API
// returns on every turn (see interviewer.js buildProgressSummary). This is
// real session state from the server, not something the client invents —
// the client only ever displays day numbers/titles, never the `reason` each
// day was chosen, since that's deliberately kept from the candidate.
function renderProgress(progress) {
  if (!progress) return;
  progressPanel.hidden = false;

  questionsCount.textContent = progress.questionsAsked;

  const totalDays = progress.focusPlan.length;
  const coveredCount = progress.focusPlan.filter(
    (f) => progress.daysCovered.includes(f.day)
  ).length;
  const percent = totalDays > 0 ? Math.round((coveredCount / totalDays) * 100) : 0;

  daysProgressFill.style.width = `${percent}%`;
  daysProgressBar.setAttribute('aria-valuenow', String(coveredCount));
  daysProgressBar.setAttribute('aria-valuemax', String(totalDays));
  daysProgressCaption.textContent = `${coveredCount} of ${totalDays} focus days covered`;

  focusList.replaceChildren();
  progress.focusPlan.forEach((focusDay) => {
    const isCovered = progress.daysCovered.includes(focusDay.day);
    const item = document.createElement('li');
    item.className = isCovered ? 'is-covered' : '';
    const dot = document.createElement('span');
    dot.className = 'focus-list-dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = `Day ${focusDay.day} — ${focusDay.title}`;
    item.append(dot, label);
    focusList.append(item);
  });
}

async function loadCandidates() {
  try {
    const response = await fetch('/candidates.json');
    if (!response.ok) throw new Error('Could not load the demo candidates.');
    const data = await response.json();
    candidates = data.candidates || [];
    if (candidates.length === 0) throw new Error('No demo candidates were found.');

    renderCandidateCards();
  } catch (error) {
    candidateGrid.replaceChildren();
    const message = document.createElement('p');
    message.className = 'empty-state';
    message.textContent = 'Candidates unavailable';
    candidateGrid.append(message);
    showError(error.message);
  }
}

// =========================================================
// Voice input (push-to-talk)
//
// Two implementations, chosen once at load time based on browser support:
//
//   1. Native SpeechRecognition (Chrome/Edge/Safari) — instant, on-device,
//      no network round trip. Fills the textarea live as you speak.
//   2. MediaRecorder + server-side Gemini transcription (Firefox, or any
//      browser without SpeechRecognition) — records audio locally, sends it
//      to POST /api/transcribe once you release the mic, and drops the
//      returned text into the textarea. Slower (a real network + model
//      round trip) but works anywhere MediaRecorder does.
//
// Both implementations expose the same three functions — startRecording(),
// stopRecording(), and use the same showVoiceStatus()/clearVoiceStatus()
// helpers — so the mic button's event listeners below don't need to know
// or care which path is active. Only one implementation's variables/
// functions are ever defined, based on which branch runs at load time.
// =========================================================
const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;
let textBeforeRecording = '';

function showVoiceStatus(message, isError = false) {
  voiceStatus.textContent = message;
  voiceStatus.classList.toggle('is-error', isError);
  voiceStatus.hidden = false;
}

function clearVoiceStatus() {
  voiceStatus.hidden = true;
  voiceStatus.textContent = '';
  voiceStatus.classList.remove('is-error');
}

function setRecordingUI(recording) {
  isRecording = recording;
  micButton.classList.toggle('is-recording', recording);
  micButton.setAttribute('aria-pressed', String(recording));
  if (recording) {
    showVoiceStatus('Listening… release to stop.');
  }
  // Note: we deliberately don't clear the status here when recording stops —
  // stopRecording() already set a "Finishing up…" or "hold longer" message,
  // and the result/error handlers below decide what the final message says.
}

const MIN_HOLD_MS = 350; // holds shorter than this rarely give either path enough audio to work with
let recordingStartedAt = 0;
let startRecording = () => {}; // replaced below once we know which API is available
let stopRecording = () => {};

if (SpeechRecognitionApi) {
  // ---- Path 1: native SpeechRecognition ----
  recognition = new SpeechRecognitionApi();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.addEventListener('result', (event) => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i += 1) {
      transcript += event.results[i][0].transcript;
    }
    const joiner = textBeforeRecording && !textBeforeRecording.endsWith(' ') ? ' ' : '';
    answerInput.value = `${textBeforeRecording}${joiner}${transcript}`;
    if (transcript.trim()) clearVoiceStatus();
  });

  recognition.addEventListener('error', (event) => {
    setRecordingUI(false);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      showVoiceStatus('Microphone access was denied. You can still type your answer.', true);
    } else if (event.error === 'no-speech') {
      showVoiceStatus('No speech detected — try again or type your answer.', true);
    } else {
      showVoiceStatus('Voice input had a problem. You can still type your answer.', true);
    }
  });

  recognition.addEventListener('end', () => {
    setRecordingUI(false);
    if (voiceStatus.textContent === 'Finishing up…') {
      showVoiceStatus('Didn\u2019t catch that — try holding the mic a bit longer.', true);
    }
  });

  startRecording = () => {
    if (isRecording || answerInput.disabled) return;
    textBeforeRecording = answerInput.value;
    try {
      recognition.start();
      recordingStartedAt = Date.now();
      setRecordingUI(true);
    } catch {
      // start() throws if called while already running; safe to ignore.
    }
  };

  stopRecording = () => {
    if (!isRecording) return;
    const heldFor = Date.now() - recordingStartedAt;
    if (heldFor < MIN_HOLD_MS) {
      showVoiceStatus('Hold the mic a little longer while you speak.', true);
    } else {
      showVoiceStatus('Finishing up…');
    }
    recognition.stop();
  };

  micButton.hidden = false;
} else if (window.MediaRecorder && navigator.mediaDevices?.getUserMedia) {
  // ---- Path 2: MediaRecorder + server-side Gemini transcription ----
  // Firefox (and any other SpeechRecognition-less browser) falls here.
  // Gemini's documented supported audio formats are WAV/MP3/AIFF/AAC/OGG/FLAC
  // (see transcribe.js) — audio/webm is NOT on that list, so we specifically
  // request 'audio/ogg;codecs=opus', which Firefox has supported since
  // version 29. If ogg recording isn't available for some reason, we fall
  // back to whatever the browser's default is rather than silently failing,
  // but that fallback format may not be one Gemini accepts.
  const PREFERRED_MIME = 'audio/ogg;codecs=opus';
  const recordingMimeType = MediaRecorder.isTypeSupported(PREFERRED_MIME)
    ? PREFERRED_MIME
    : '';

  let mediaRecorder = null;
  let mediaStream = null;
  let recordedChunks = [];

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // reader.result is a data: URL like "data:audio/ogg;base64,AAAA..." —
        // we only want the part after the comma.
        const base64 = String(reader.result).split(',')[1] || '';
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function sendForTranscription(blob, mimeType) {
    showVoiceStatus('Transcribing…');
    try {
      const base64Audio = await blobToBase64(blob);
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64Audio, mimeType }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || 'Transcription failed.');
      }
      const transcript = (body.transcript || '').trim();
      if (!transcript) {
        showVoiceStatus('Didn\u2019t catch that — try holding the mic a bit longer.', true);
        return;
      }
      const joiner = textBeforeRecording && !textBeforeRecording.endsWith(' ') ? ' ' : '';
      answerInput.value = `${textBeforeRecording}${joiner}${transcript}`;
      clearVoiceStatus();
    } catch (err) {
      showVoiceStatus('Voice input had a problem. You can still type your answer.', true);
    }
  }

  startRecording = async () => {
    if (isRecording || answerInput.disabled) return;
    textBeforeRecording = answerInput.value;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showVoiceStatus('Microphone access was denied. You can still type your answer.', true);
      return;
    }
    recordedChunks = [];
    const options = recordingMimeType ? { mimeType: recordingMimeType } : undefined;
    try {
      mediaRecorder = new MediaRecorder(mediaStream, options);
    } catch {
      // Browser rejected our preferred mimeType — fall back to its default.
      mediaRecorder = new MediaRecorder(mediaStream);
    }
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    });
    mediaRecorder.addEventListener('stop', () => {
      mediaStream.getTracks().forEach((track) => track.stop());
      const heldFor = Date.now() - recordingStartedAt;
      if (heldFor < MIN_HOLD_MS || recordedChunks.length === 0) {
        showVoiceStatus('Hold the mic a little longer while you speak.', true);
        return;
      }
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
      sendForTranscription(blob, mediaRecorder.mimeType);
    });
    mediaRecorder.start();
    recordingStartedAt = Date.now();
    setRecordingUI(true);
  };

  stopRecording = () => {
    if (!isRecording || !mediaRecorder || mediaRecorder.state === 'inactive') return;
    setRecordingUI(false);
    mediaRecorder.stop();
  };

  micButton.hidden = false;
}

if (!micButton.hidden) {
  micButton.addEventListener('mousedown', startRecording);
  micButton.addEventListener('touchstart', (event) => {
    event.preventDefault(); // avoid ghost mousedown + double-trigger on touch devices
    startRecording();
  });
  micButton.addEventListener('mouseup', stopRecording);
  micButton.addEventListener('mouseleave', stopRecording);
  micButton.addEventListener('touchend', stopRecording);
  micButton.addEventListener('touchcancel', stopRecording);
}

// Resets all client-side state back to the initial candidate-picker view so
// judges can try another candidate without a page refresh. Doesn't call the
// backend to delete the old session — it simply becomes orphaned in the
// server's in-memory Map, which is fine given the documented no-persistence
// scope (see sessions.js).
function resetToStart() {
  sessionId = null;
  interviewComplete = false;

  messages.replaceChildren();
  const emptyState = document.createElement('p');
  emptyState.className = 'empty-state';
  emptyState.textContent = 'Select a candidate to begin.';
  messages.append(emptyState);

  answerForm.hidden = true;
  answerInput.value = '';
  typingIndicator.hidden = true;

  feedbackSection.hidden = true;
  feedbackSection.replaceChildren();

  candidatePanel.hidden = true;
  progressPanel.hidden = true;
  focusList.replaceChildren();
  workspace.classList.remove('workspace--active');
  workspace.hidden = true;

  restartButton.hidden = true;
  if (isRecording) stopRecording();
  clearVoiceStatus();
  clearError();
  setStatus(null, 'Waiting to start');

  startPanel.hidden = false;
  loadingView.hidden = true;
}

restartButton.addEventListener('click', resetToStart);

async function startInterview(candidate) {
  clearError();
  sessionId = createSessionId();

  const member = candidate.member ?? candidate;
  startPanel.hidden = true;
  loadingViewText.textContent = `Preparing interview for ${member.name || 'candidate'}…`;
  loadingView.hidden = false;

  setWaiting(true);
  setStatus(null, 'Connecting…');

  try {
    const result = await callInterviewApi({ sessionId, candidate });
    loadingView.hidden = true;
    addMessage(result.reply, 'interviewer');
    answerForm.hidden = false;
    answerInput.focus();
    setStatus('is-live', 'Interview in progress');
    renderCandidatePanel(candidate);
    renderProgress(result.progress);
    workspace.hidden = false;
    workspace.classList.add('workspace--active');
    restartButton.hidden = false;
  } catch (error) {
    sessionId = null;
    loadingView.hidden = true;
    startPanel.hidden = false;
    showError(error.message);
    setStatus(null, 'Waiting to start');
  } finally {
    setWaiting(false);
  }
}

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
      renderFeedback(result.feedback, result.focusPlan);
      setStatus('is-done', 'Interview complete');
    } else {
      renderProgress(result.progress);
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
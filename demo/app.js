const slider = document.querySelector('#timelineSlider');
const progress = document.querySelector('#timelineProgress');
const readout = document.querySelector('#timeReadout');
const playButton = document.querySelector('#playButton');
const playIcon = document.querySelector('#playIcon');
const notification = document.querySelector('#notificationCard');
const phoneScreen = document.querySelector('.phone-screen');
const gameDetail = document.querySelector('#gameDetail');
const marker = document.querySelector('#chartMarker');
const socialMarker = document.querySelector('#socialMarker');
const velocityStatus = document.querySelector('#velocityStatus');
const improbabilityStatus = document.querySelector('#improbabilityStatus');
const decisionCard = document.querySelector('.decision-card');
const signalCards = document.querySelectorAll('.signal-card');
const chartVisualization = document.querySelector('#chartVisualization');
const chartReveal = document.querySelector('#chartRevealClip rect');
const chartAreas = document.querySelectorAll('.animated-area');
const mobileNotification = document.querySelector('#mobileNotificationCard');
const mobileAlertPlaceholder = document.querySelector('#mobileAlertPlaceholder');
const mobileGameInfo = document.querySelector('#mobileGameInfo');
const mobileGameInfoBack = document.querySelector('#mobileGameInfoBack');
const signalDetails = document.querySelector('#signalDetails');
const signalDetailEyebrow = document.querySelector('#signalDetailEyebrow');
const signalDetailValue = document.querySelector('#signalDetailValue');
const signalDetailUnit = document.querySelector('#signalDetailUnit');
const signalDetailContext = document.querySelector('#signalDetailContext');
const signalDetailTitle = document.querySelector('#signalDetailTitle');
const signalDetailBody = document.querySelector('#signalDetailBody');
const signalDetailNote = document.querySelector('#signalDetailNote');
const signalDetailsClose = document.querySelector('#signalDetailsClose');

let timer;
let selectedSignal = null;
const signalAt = 62.5;
const totalDuration = 100;

function setMoment(value) {
  const moment = Math.max(0, Math.min(100, Number(value)));
  const ratio = moment / 100;
  progress.style.width = `${moment}%`;
  chartReveal.setAttribute('width', String(760 * ratio));
  chartAreas.forEach((area) => {
    area.style.clipPath = `inset(0 ${100 - moment}% 0 0)`;
  });
  const minute = 32 + Math.floor(moment * 8 / 100);
  readout.textContent = `10:${String(minute).padStart(2, '0')} PM`;
  const atEnd = moment >= totalDuration;
  playIcon.classList.toggle('is-replay', atEnd);
  if (!timer) playButton.setAttribute('aria-label', atEnd ? 'Replay demo' : 'Play demo');
  const fired = moment >= signalAt;
  notification.classList.toggle('show', fired);
  mobileNotification.classList.toggle('show', fired);
  mobileNotification.setAttribute('aria-hidden', String(!fired));
  mobileAlertPlaceholder.classList.toggle('hidden', fired);
  if (!fired) closeGameDetail();
  phoneScreen.classList.toggle('notification-visible', fired);
  marker.classList.toggle('fired', fired);
  socialMarker.classList.toggle('fired', moment >= totalDuration);
  velocityStatus.textContent = fired ? 'TRIGGERED' : 'WATCHING';
  improbabilityStatus.textContent = fired ? 'TRIGGERED' : 'WATCHING';
  improbabilityStatus.classList.toggle('muted', !fired);
  decisionCard.classList.toggle('active', fired);
  signalCards.forEach((card) => {
    card.classList.toggle('selected', card.dataset.signal === selectedSignal);
    card.setAttribute('aria-expanded', String(card.dataset.signal === selectedSignal));
  });
}

const signalExplanations = {
  velocity: {
    title: 'Odds velocity',
    eyebrow: 'ODDS VELOCITY',
    value: '0.104',
    unit: '30s velocity',
    context: 'Signal field: velocity_30s',
    body: 'A short-window movement in implied odds helps answer “why now?” It is the timing signal: a sharp move can indicate that a live moment is unfolding.',
    note: '0.104 is copied from the sample decision record. The production unit and trigger threshold still need to be defined.'
  },
  improbability: {
    title: 'Improbability score',
    eyebrow: 'IMPROBABILITY',
    value: '7.2',
    unit: 'signal value',
    context: 'Starting implied win probability: 4.8% (demo)',
    body: 'Adds context to the fast move: was the outcome already unlikely before it began? Lower starting probability means a more surprising outcome.',
    note: '7.2 is the sample signal value from the decision record. The score scale and calculation are not specified; 4.8% is illustrative UI context.'
  },
  volume: {
    title: 'Volume anomaly',
    eyebrow: 'VOLUME ANOMALY',
    value: '4.1×',
    unit: 'vs baseline',
    context: 'Signal field: volume_vs_baseline',
    body: 'Compares current traded volume with its expected baseline to indicate whether market activity is unusually high.',
    note: '4.1 is present in the sample decision record, but no live volume feed or baseline method is connected or validated.'
  }
};

function selectSignal(signal) {
  selectedSignal = selectedSignal === signal ? null : signal;
  const explanation = selectedSignal ? signalExplanations[selectedSignal] : null;
  chartVisualization.hidden = Boolean(explanation);
  signalDetails.hidden = !explanation;
  if (explanation) {
    signalDetailEyebrow.textContent = explanation.eyebrow;
    signalDetailValue.textContent = explanation.value;
    signalDetailUnit.textContent = explanation.unit;
    signalDetailContext.textContent = explanation.context;
    signalDetailTitle.textContent = explanation.title;
    signalDetailBody.textContent = explanation.body;
    signalDetailNote.textContent = explanation.note;
  }
  signalCards.forEach((card) => {
    const selected = card.dataset.signal === selectedSignal;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-expanded', String(selected));
  });
}

function openGameDetail() {
  if (!notification.classList.contains('show')) return;
  gameDetail.classList.add('open');
  gameDetail.setAttribute('aria-hidden', 'false');
  phoneScreen.classList.add('detail-open');
}

function openMobileGameDetail() {
  if (!mobileNotification.classList.contains('show')) return;
  mobileGameInfo.hidden = false;
  mobileGameInfo.setAttribute('aria-hidden', 'false');
  chartVisualization.hidden = true;
  signalDetails.hidden = true;
  mobileNotification.classList.remove('show');
  mobileNotification.setAttribute('aria-hidden', 'true');
  mobileAlertPlaceholder.classList.add('hidden');
}

function closeMobileGameDetail() {
  mobileGameInfo.hidden = true;
  mobileGameInfo.setAttribute('aria-hidden', 'true');
  chartVisualization.hidden = false;
}

function closeGameDetail() {
  gameDetail.classList.remove('open');
  gameDetail.setAttribute('aria-hidden', 'true');
  phoneScreen.classList.remove('detail-open');
  closeMobileGameDetail();
}

function pause() {
  clearInterval(timer);
  timer = null;
  playIcon.classList.remove('is-paused');
  playIcon.classList.remove('is-replay');
  playButton.setAttribute('aria-label', 'Play demo');
}

function finishPlayback() {
  clearInterval(timer);
  timer = null;
  playIcon.classList.remove('is-paused');
  playIcon.classList.add('is-replay');
  playButton.setAttribute('aria-label', 'Replay demo');
}

function play() {
  if (timer) return pause();
  if (Number(slider.value) >= totalDuration) {
    slider.value = '0';
    setMoment(0);
  }
  playIcon.classList.remove('is-replay');
  playIcon.classList.add('is-paused');
  playButton.setAttribute('aria-label', 'Pause demo');
  timer = setInterval(() => {
    const next = Math.min(totalDuration, Number(slider.value) + 1);
    slider.value = String(next);
    setMoment(next);
    if (next >= totalDuration) finishPlayback();
  }, 65);
}

playButton.addEventListener('click', play);
slider.addEventListener('input', () => {
  pause();
  setMoment(slider.value);
});
notification.addEventListener('click', openGameDetail);
mobileNotification.addEventListener('click', openMobileGameDetail);
document.querySelector('#detailBack').addEventListener('click', closeGameDetail);
mobileGameInfoBack.addEventListener('click', closeMobileGameDetail);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeGameDetail();
});

setMoment(0);
document.querySelectorAll('.interactive-signal').forEach((card) => {
  card.addEventListener('click', () => selectSignal(card.dataset.signal));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectSignal(card.dataset.signal);
    }
  });
});
signalDetailsClose.addEventListener('click', () => selectSignal(selectedSignal));

import './styles.css';
import { isFirebaseConfigured, auth, db } from './firebase.js';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  endAt,
  get,
  orderByKey,
  query,
  ref,
  remove,
  set,
  startAt,
} from 'firebase/database';

const GOAL_LIMIT = 3;
const GOAL_TEXT_LIMIT = 80;
const appRoot = document.querySelector('#app');

const state = {
  authReady: false,
  loading: false,
  saving: false,
  user: null,
  view: 'home',
  todayKey: toDateKey(new Date()),
  days: {},
  stats: emptyStats(),
  loginError: '',
  dataError: '',
  addOpen: false,
  editIndex: null,
  modal: null,
};

let midnightTimer = null;

if (isFirebaseConfigured) {
  onAuthStateChanged(auth, async (user) => {
    state.authReady = true;
    state.user = user;
    state.loginError = '';

    if (!user) {
      state.view = 'home';
      state.days = {};
      state.stats = emptyStats();
      render();
      return;
    }

    state.view = 'home';
    await bootstrapUser(user);
    scheduleMidnightRefresh();
  });
} else {
  state.authReady = true;
  render();
}

function render() {
  if (!state.authReady) {
    appRoot.innerHTML = '<main class="screen center"><div class="loader"></div></main>';
    return;
  }

  if (!isFirebaseConfigured || !state.user) {
    renderLogin();
    return;
  }

  renderShell();
}

function renderLogin() {
  appRoot.innerHTML = `
    <main class="login-screen fade-in">
      <section class="login-panel">
        <p class="eyebrow">minimal daily focus</p>
        <h1>Daily 3</h1>
        <p class="login-copy">하루 딱 3가지만. 끝내면 오늘은 성공이야.</p>
        <button class="primary-action" data-action="google-login" ${!isFirebaseConfigured ? 'disabled' : ''}>
          <span class="google-dot">G</span>
          Google로 시작하기
        </button>
        ${state.loginError ? `<p class="error-text">${escapeHtml(state.loginError)}</p>` : ''}
        ${
          !isFirebaseConfigured
            ? '<p class="error-text">Firebase 환경변수를 먼저 설정해 주세요.</p>'
            : ''
        }
      </section>
    </main>
  `;

  appRoot.querySelector('[data-action="google-login"]')?.addEventListener('click', loginWithGoogle);
}

function renderShell() {
  const viewMarkup = {
    home: renderHome(),
    heatmap: renderHeatmap(),
    settings: renderSettings(),
  }[state.view];

  appRoot.innerHTML = `
    <main class="app-shell fade-in">
      <section class="content-area">${viewMarkup}</section>
      ${renderTabBar()}
      ${renderModal()}
    </main>
  `;

  bindGlobalEvents();
  bindViewEvents();
}

function renderHome() {
  const today = getToday();
  const userName = getFirstName(state.user?.displayName);
  const completed = today.goals.filter((goal) => goal.done).length;
  const progressText = `${completed}/${GOAL_LIMIT}`;
  const progressPercent = Math.min(100, Math.round((completed / GOAL_LIMIT) * 100));
  const isPerfect = today.goals.length === GOAL_LIMIT && completed === GOAL_LIMIT && !today.restDay;
  const goalCards = today.goals.length
    ? today.goals.map((goal, index) => renderGoalCard(goal, index)).join('')
    : `<div class="empty-card">${today.restDay ? '오늘은 쉬는 날이에요.' : '오늘 목표 없음'}</div>`;

  return `
    <section class="view stack">
      <header class="top-header">
        <div>
          <p class="muted">안녕하세요, ${escapeHtml(userName)}님</p>
          <h2>오늘의 Daily 3</h2>
        </div>
        <time>${formatKoreanDate(state.todayKey)}</time>
      </header>

      <article class="progress-card">
        <div class="progress-top">
          <span>오늘 완료율</span>
          <strong>${progressText}</strong>
        </div>
        <div class="progress-track" aria-label="오늘 완료율 ${progressText}">
          <span style="width: ${progressPercent}%"></span>
        </div>
      </article>

      ${isPerfect ? renderCelebration() : ''}

      <section class="goal-list" aria-label="오늘 목표">
        ${goalCards}
      </section>

      ${renderAddGoalArea(today)}

      <button class="quiet-action" data-action="rest-day">
        ${today.restDay ? '쉬는 날 취소' : '오늘 목표 없음'}
      </button>
      ${state.dataError ? `<p class="error-text">${escapeHtml(state.dataError)}</p>` : ''}
    </section>
  `;
}

function renderGoalCard(goal, index) {
  const isEditing = state.editIndex === index;
  const checked = goal.done ? 'checked' : '';

  return `
    <article class="goal-card ${goal.done ? 'done' : ''}">
      <label class="check-wrap" aria-label="목표 완료">
        <input type="checkbox" data-action="toggle-goal" data-index="${index}" ${checked} />
        <span></span>
      </label>
      ${
        isEditing
          ? `
            <form class="edit-form" data-action="save-edit" data-index="${index}">
              <input
                name="goal"
                maxlength="${GOAL_TEXT_LIMIT}"
                value="${escapeAttr(goal.text)}"
                autocomplete="off"
                aria-label="목표 수정"
              />
              <button type="submit">저장</button>
            </form>
          `
          : `
            <p>${escapeHtml(goal.text)}</p>
            <div class="goal-actions">
              <button data-action="edit-goal" data-index="${index}" aria-label="목표 수정">수정</button>
              <button data-action="delete-goal" data-index="${index}" aria-label="목표 삭제">×</button>
            </div>
          `
      }
    </article>
  `;
}

function renderAddGoalArea(today) {
  if (today.goals.length >= GOAL_LIMIT || today.restDay) {
    return '';
  }

  if (!state.addOpen) {
    return '<button class="add-action" data-action="open-add">+ 목표 추가</button>';
  }

  return `
    <form class="add-form" data-action="add-goal">
      <input
        name="goal"
        maxlength="${GOAL_TEXT_LIMIT}"
        placeholder="오늘 끝낼 목표 입력"
        autocomplete="off"
        aria-label="새 목표"
      />
      <button type="submit">추가</button>
    </form>
  `;
}

function renderCelebration() {
  const particles = [
    [-88, -24],
    [-72, 28],
    [-54, -48],
    [-32, 38],
    [-14, -62],
    [8, 52],
    [28, -42],
    [46, 34],
    [64, -26],
    [84, 18],
    [-96, 10],
    [96, -8],
    [-22, -28],
    [22, 24],
    [-64, -6],
    [58, 4],
    [-8, 68],
    [10, -72],
  ];

  return `
    <section class="celebration-card" aria-live="polite">
      <div class="particles">
        ${particles
          .map(
            ([x, y], index) =>
              `<span style="--i:${index}; --tx:${x}px; --ty:${y}px"></span>`,
          )
          .join('')}
      </div>
      <strong>🎉 오늘 완벽해요!</strong>
    </section>
  `;
}

function renderHeatmap() {
  const derived = deriveStats(state.days, state.stats);
  const cells = getRecentDateKeys(90)
    .map((dateKey) => {
      const day = normalizeDay(state.days[dateKey]);
      const level = getHeatLevel(day);
      return `
        <button
          class="heat-cell ${level}"
          data-action="open-day"
          data-date="${dateKey}"
          title="${escapeAttr(formatKoreanDate(dateKey))} · ${escapeAttr(getRateLabel(day))}"
          aria-label="${escapeAttr(formatKoreanDate(dateKey))} ${escapeAttr(getRateLabel(day))}"
        ></button>
      `;
    })
    .join('');

  return `
    <section class="view stack">
      <header class="top-header">
        <div>
          <p class="muted">나의 기록</p>
          <h2>최근 90일</h2>
        </div>
      </header>

      <section class="stats-grid" aria-label="요약 통계">
        <article>
          <span>현재 스트릭</span>
          <strong>${derived.currentStreak}일</strong>
        </article>
        <article>
          <span>최장 스트릭</span>
          <strong>${derived.longestStreak}일</strong>
        </article>
        <article>
          <span>이번 달 평균</span>
          <strong>${Math.round(derived.monthAverage * 100)}%</strong>
        </article>
      </section>

      <section class="heatmap-card">
        <div class="heatmap-grid">${cells}</div>
        <div class="legend">
          <span>기록 없음</span>
          <i class="level-none"></i>
          <i class="level-rest"></i>
          <i class="level-zero"></i>
          <i class="level-one"></i>
          <i class="level-two"></i>
          <i class="level-full"></i>
          <span>완료</span>
        </div>
      </section>
    </section>
  `;
}

function renderSettings() {
  const user = state.user;
  const photo = user.photoURL
    ? `<img src="${escapeAttr(user.photoURL)}" alt="" referrerpolicy="no-referrer" />`
    : `<span>${escapeHtml(getInitial(user.displayName))}</span>`;

  return `
    <section class="view stack">
      <header class="top-header">
        <div>
          <p class="muted">계정</p>
          <h2>설정</h2>
        </div>
      </header>

      <section class="profile-card">
        <div class="avatar">${photo}</div>
        <div>
          <strong>${escapeHtml(user.displayName || '사용자')}</strong>
          <span>${escapeHtml(user.email || '')}</span>
        </div>
      </section>

      <div class="settings-actions">
        <button class="secondary-action" data-action="logout">로그아웃</button>
        <button class="danger-action" data-action="confirm-delete-data">데이터 전체 삭제</button>
      </div>
    </section>
  `;
}

function renderTabBar() {
  const tabs = [
    ['home', '홈', '⌂'],
    ['heatmap', '기록', '▦'],
    ['settings', '설정', '⚙'],
  ];

  return `
    <nav class="tab-bar" aria-label="화면 이동">
      ${tabs
        .map(([view, label, icon]) => {
          const active = state.view === view ? 'active' : '';
          return `
            <button class="${active}" data-action="change-view" data-view="${view}" aria-label="${label}">
              <span>${icon}</span>
              ${label}
            </button>
          `;
        })
        .join('')}
    </nav>
  `;
}

function renderModal() {
  if (!state.modal) {
    return '';
  }

  if (state.modal.type === 'day') {
    const day = normalizeDay(state.days[state.modal.dateKey]);
    const goals = day.goals.length
      ? day.goals
          .map((goal) => `<li class="${goal.done ? 'done' : ''}">${escapeHtml(goal.text)}</li>`)
          .join('')
      : `<li>${day.restDay ? '쉬는 날' : '기록 없음'}</li>`;

    return `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal-card" role="dialog" aria-modal="true" aria-label="날짜별 목표">
          <header>
            <strong>${formatKoreanDate(state.modal.dateKey)}</strong>
            <button data-action="close-modal" aria-label="닫기">×</button>
          </header>
          <p class="modal-rate">${getRateLabel(day)}</p>
          <ul class="day-goals">${goals}</ul>
        </section>
      </div>
    `;
  }

  if (state.modal.type === 'delete-data') {
    return `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal-card" role="dialog" aria-modal="true" aria-label="데이터 삭제 확인">
          <header>
            <strong>정말 삭제하시겠어요?</strong>
            <button data-action="close-modal" aria-label="닫기">×</button>
          </header>
          <p>되돌릴 수 없어요.</p>
          <div class="modal-actions">
            <button class="secondary-action" data-action="close-modal">취소</button>
            <button class="danger-action" data-action="delete-data">삭제</button>
          </div>
        </section>
      </div>
    `;
  }

  return '';
}

function bindGlobalEvents() {
  appRoot.querySelectorAll('[data-action="change-view"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      state.addOpen = false;
      state.editIndex = null;
      render();
    });
  });

  appRoot.querySelectorAll('[data-action="close-modal"]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (event.target !== element && element.classList.contains('modal-backdrop')) {
        return;
      }
      state.modal = null;
      render();
    });
  });
}

function bindViewEvents() {
  appRoot.querySelector('[data-action="open-add"]')?.addEventListener('click', () => {
    state.addOpen = true;
    render();
    appRoot.querySelector('.add-form input')?.focus();
  });

  appRoot.querySelector('[data-action="add-goal"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = cleanGoalText(new FormData(event.currentTarget).get('goal'));
    if (!text) return;
    await saveTodayWithGoals([...getToday().goals, { text, done: false }], false);
    state.addOpen = false;
  });

  appRoot.querySelectorAll('[data-action="toggle-goal"]').forEach((input) => {
    input.addEventListener('change', async () => {
      const index = Number(input.dataset.index);
      const goals = getToday().goals.map((goal, goalIndex) =>
        goalIndex === index ? { ...goal, done: input.checked } : goal,
      );
      await saveTodayWithGoals(goals, false);
    });
  });

  appRoot.querySelectorAll('[data-action="edit-goal"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.editIndex = Number(button.dataset.index);
      render();
      appRoot.querySelector('.edit-form input')?.focus();
    });
  });

  appRoot.querySelectorAll('[data-action="save-edit"]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const index = Number(form.dataset.index);
      const text = cleanGoalText(new FormData(form).get('goal'));
      if (!text) return;
      const goals = getToday().goals.map((goal, goalIndex) =>
        goalIndex === index ? { ...goal, text } : goal,
      );
      state.editIndex = null;
      await saveTodayWithGoals(goals, false);
    });
  });

  appRoot.querySelectorAll('[data-action="delete-goal"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const index = Number(button.dataset.index);
      const goals = getToday().goals.filter((_, goalIndex) => goalIndex !== index);
      state.editIndex = null;
      await saveTodayWithGoals(goals, false);
    });
  });

  appRoot.querySelector('[data-action="rest-day"]')?.addEventListener('click', async () => {
    if (getToday().restDay) {
      await removeToday();
      return;
    }

    await saveRestDay();
  });

  appRoot.querySelectorAll('[data-action="open-day"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.modal = { type: 'day', dateKey: button.dataset.date };
      render();
    });
  });

  appRoot.querySelector('[data-action="logout"]')?.addEventListener('click', async () => {
    await signOut(auth);
  });

  appRoot.querySelector('[data-action="confirm-delete-data"]')?.addEventListener('click', () => {
    state.modal = { type: 'delete-data' };
    render();
  });

  appRoot.querySelector('[data-action="delete-data"]')?.addEventListener('click', deleteAllData);
}

async function loginWithGoogle() {
  if (!isFirebaseConfigured) return;
  state.loginError = '';
  render();

  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  } catch (error) {
    state.loginError = getFriendlyAuthError(error);
    render();
  }
}

async function bootstrapUser(user) {
  state.loading = true;
  state.dataError = '';
  render();

  try {
    await ensureProfile(user);
    await loadRecentData();
  } catch (error) {
    state.dataError = '데이터를 불러오지 못했어요. Firebase 설정과 규칙을 확인해 주세요.';
    console.error(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function ensureProfile(user) {
  const profileRef = ref(db, `users/${user.uid}/profile`);
  const snapshot = await get(profileRef);
  const previous = snapshot.val() || {};

  await set(profileRef, {
    name: user.displayName || previous.name || '사용자',
    email: user.email || previous.email || '',
    createdAt: previous.createdAt || Date.now(),
  });
}

async function loadRecentData() {
  const startKey = getRecentDateKeys(90)[0];
  const daysRef = query(
    ref(db, `users/${state.user.uid}/days`),
    orderByKey(),
    startAt(startKey),
    endAt(state.todayKey),
  );

  const [daysSnapshot, statsSnapshot] = await Promise.all([
    get(daysRef),
    get(ref(db, `users/${state.user.uid}/stats`)),
  ]);

  state.days = daysSnapshot.val() || {};
  state.stats = { ...emptyStats(), ...(statsSnapshot.val() || {}) };
  await persistStats();
}

async function saveTodayWithGoals(goals, restDay) {
  await ensureCurrentDate();
  const cleanedGoals = goals
    .map((goal) => ({
      text: cleanGoalText(goal.text),
      done: Boolean(goal.done),
    }))
    .filter((goal) => goal.text)
    .slice(0, GOAL_LIMIT);

  if (!cleanedGoals.length && !restDay) {
    await removeToday();
    return;
  }

  const payload = buildDayPayload(cleanedGoals, restDay);
  await writeDay(payload);
}

async function saveRestDay() {
  await ensureCurrentDate();
  await writeDay(buildDayPayload([], true));
  state.addOpen = false;
  state.editIndex = null;
}

async function writeDay(payload) {
  state.saving = true;
  state.dataError = '';
  render();

  try {
    await set(ref(db, `users/${state.user.uid}/days/${state.todayKey}`), payload);
    state.days = { ...state.days, [state.todayKey]: payload };
    await persistStats();
  } catch (error) {
    state.dataError = '저장하지 못했어요. 잠시 후 다시 시도해 주세요.';
    console.error(error);
  } finally {
    state.saving = false;
    render();
  }
}

async function removeToday() {
  state.saving = true;
  render();

  try {
    await remove(ref(db, `users/${state.user.uid}/days/${state.todayKey}`));
    const nextDays = { ...state.days };
    delete nextDays[state.todayKey];
    state.days = nextDays;
    await persistStats();
  } catch (error) {
    state.dataError = '삭제하지 못했어요. 잠시 후 다시 시도해 주세요.';
    console.error(error);
  } finally {
    state.saving = false;
    render();
  }
}

async function persistStats() {
  if (!state.user) return;
  const derived = deriveStats(state.days, state.stats);
  const nextStats = {
    currentStreak: derived.currentStreak,
    longestStreak: derived.longestStreak,
    totalActiveDays: derived.totalActiveDays,
    updatedAt: Date.now(),
  };
  state.stats = nextStats;
  await set(ref(db, `users/${state.user.uid}/stats`), nextStats);
}

async function deleteAllData() {
  state.modal = null;
  state.saving = true;
  render();

  try {
    await Promise.all([
      remove(ref(db, `users/${state.user.uid}/days`)),
      remove(ref(db, `users/${state.user.uid}/stats`)),
    ]);
    state.days = {};
    state.stats = emptyStats();
  } catch (error) {
    state.dataError = '데이터를 삭제하지 못했어요. Firebase 규칙을 확인해 주세요.';
    console.error(error);
  } finally {
    state.saving = false;
    render();
  }
}

async function ensureCurrentDate() {
  const nextKey = toDateKey(new Date());
  if (nextKey === state.todayKey) return;

  state.todayKey = nextKey;
  await loadRecentData();
}

function scheduleMidnightRefresh() {
  clearTimeout(midnightTimer);
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setDate(now.getDate() + 1);
  nextMidnight.setHours(0, 0, 2, 0);

  midnightTimer = window.setTimeout(async () => {
    state.todayKey = toDateKey(new Date());
    if (state.user) {
      await loadRecentData();
      render();
    }
    scheduleMidnightRefresh();
  }, nextMidnight.getTime() - now.getTime());
}

function buildDayPayload(goals, restDay) {
  const goalMap = {};
  goals.slice(0, GOAL_LIMIT).forEach((goal, index) => {
    goalMap[`g${index + 1}`] = {
      text: goal.text,
      done: Boolean(goal.done),
    };
  });

  const completed = goals.filter((goal) => goal.done).length;

  return {
    goals: goalMap,
    completionRate: restDay ? 1 : toDailyRate(completed),
    goalCount: goals.length,
    restDay,
    updatedAt: Date.now(),
  };
}

function getToday() {
  return normalizeDay(state.days[state.todayKey]);
}

function normalizeDay(day) {
  if (!day) {
    return {
      goals: [],
      completionRate: 0,
      goalCount: 0,
      restDay: false,
      updatedAt: 0,
    };
  }

  return {
    goals: Object.entries(day.goals || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, GOAL_LIMIT)
      .map(([, goal]) => ({
        text: String(goal.text || '').slice(0, GOAL_TEXT_LIMIT),
        done: Boolean(goal.done),
      })),
    completionRate: Number(day.completionRate || 0),
    goalCount: Number(day.goalCount || 0),
    restDay: Boolean(day.restDay),
    updatedAt: Number(day.updatedAt || 0),
  };
}

function deriveStats(days, storedStats) {
  const keys = getRecentDateKeys(90);
  let currentStreak = 0;
  let cursor = keys.length - 1;
  const today = normalizeDay(days[state.todayKey]);

  if (!isActiveDay(today)) {
    cursor -= 1;
  }

  for (let index = cursor; index >= 0; index -= 1) {
    const day = normalizeDay(days[keys[index]]);
    if (!isSuccessfulDay(day)) break;
    currentStreak += 1;
  }

  let run = 0;
  let longestInWindow = 0;
  let totalActiveDays = 0;

  keys.forEach((dateKey) => {
    const day = normalizeDay(days[dateKey]);

    if (isActiveDay(day)) {
      totalActiveDays += 1;
    }

    if (isSuccessfulDay(day)) {
      run += 1;
      longestInWindow = Math.max(longestInWindow, run);
    } else {
      run = 0;
    }
  });

  const monthKeys = keys.filter((dateKey) => dateKey.startsWith(state.todayKey.slice(0, 7)));
  const activeMonthDays = monthKeys
    .map((dateKey) => normalizeDay(days[dateKey]))
    .filter(isActiveDay);
  const monthAverage = activeMonthDays.length
    ? activeMonthDays.reduce((sum, day) => sum + getComparableRate(day), 0) / activeMonthDays.length
    : 0;

  return {
    currentStreak,
    longestStreak: Math.max(Number(storedStats?.longestStreak || 0), longestInWindow),
    totalActiveDays: Math.max(Number(storedStats?.totalActiveDays || 0), totalActiveDays),
    monthAverage,
  };
}

function isActiveDay(day) {
  return day.restDay || day.goalCount > 0;
}

function isSuccessfulDay(day) {
  return day.restDay || day.completionRate === 1;
}

function getComparableRate(day) {
  return day.restDay ? 1 : day.completionRate;
}

function getHeatLevel(day) {
  if (!isActiveDay(day)) return 'level-none';
  if (day.restDay) return 'level-rest';
  if (day.completionRate <= 0) return 'level-zero';
  if (day.completionRate <= 0.34) return 'level-one';
  if (day.completionRate <= 0.67) return 'level-two';
  return 'level-full';
}

function getRateLabel(day) {
  if (!isActiveDay(day)) return '기록 없음';
  if (day.restDay) return '쉬는 날';
  return `완료율 ${Math.round(day.completionRate * 100)}%`;
}

function cleanGoalText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, GOAL_TEXT_LIMIT);
}

function toDailyRate(completed) {
  return [0, 0.33, 0.67, 1][Math.max(0, Math.min(GOAL_LIMIT, completed))];
}

function emptyStats() {
  return {
    currentStreak: 0,
    longestStreak: 0,
    totalActiveDays: 0,
    updatedAt: 0,
  };
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function getRecentDateKeys(count) {
  const today = fromDateKey(state.todayKey);
  return Array.from({ length: count }, (_, index) => toDateKey(addDays(today, index - count + 1)));
}

function formatKoreanDate(dateKey) {
  const date = fromDateKey(dateKey);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date);
}

function getFirstName(name) {
  return String(name || '사용자').trim().split(/\s+/)[0] || '사용자';
}

function getInitial(name) {
  return getFirstName(name).slice(0, 1).toUpperCase();
}

function getFriendlyAuthError(error) {
  if (error?.code === 'auth/popup-closed-by-user') {
    return '로그인 창이 닫혔어요.';
  }
  if (error?.code === 'auth/unauthorized-domain') {
    return 'Firebase Authentication 승인 도메인에 현재 도메인을 추가해 주세요.';
  }
  return 'Google 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

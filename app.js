'use strict';

const STORAGE_KEY = 'personal24WeekTrackerV1';
const PLAN_WEEKS = 24;
const PACE_OPTIONS = {
  male: {
    conservative: { label: 'Conservative', value: 0.50 },
    ideal: { label: 'Ideal', value: 0.75 },
    aggressive: { label: 'Aggressive', value: 1.00 }
  },
  female: {
    conservative: { label: 'Conservative', value: 0.25 },
    ideal: { label: 'Ideal', value: 0.50 },
    aggressive: { label: 'Aggressive', value: 0.75 }
  }
};

const ACTIVITY_OPTIONS = {
  sedentary: { label: 'Sedentary', factor: 1.20 },
  light: { label: 'Light', factor: 1.375 },
  moderate: { label: 'Moderate', factor: 1.55 },
  very: { label: 'Very active', factor: 1.725 },
  extra: { label: 'Extra active', factor: 1.90 }
};

const KCAL_PER_KG = 7700;

let data = loadData();
let TARGETS = [];

const $ = id => document.getElementById(id);

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return parsed && parsed.profile ? parsed : null;
  } catch {
    return null;
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function saveAndRender() {
  persist();
  render();
}

function parseISODate(iso) {
  return new Date(`${iso}T00:00:00`);
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(iso, numberOfDays) {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + numberOfDays);
  return toISODate(date);
}

function daysBetween(start, end) {
  return Math.round((parseISODate(end) - parseISODate(start)) / 86400000);
}

function fmtDate(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(parseISODate(iso));
}

function round1(value) {
  return Number(value.toFixed(1));
}

function heightToCm(feet, inches) {
  return ((Number(feet) * 12) + Number(inches)) * 2.54;
}

function calculateBmi(weightKg, heightFeet, heightInches) {
  const heightMetres = heightToCm(heightFeet, heightInches) / 100;
  if (!heightMetres || heightMetres <= 0) return null;
  return Number(weightKg) / (heightMetres * heightMetres);
}

function getBmiCategory(bmi) {
  if (!Number.isFinite(bmi)) return 'Unavailable';
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Healthy weight';
  if (bmi < 30) return 'Overweight';
  if (bmi < 35) return 'Obesity class I';
  if (bmi < 40) return 'Obesity class II';
  return 'Obesity class III';
}

function calculateCaloriePlan(profile, weight = profile.startWeight) {
  const heightCm = heightToCm(profile.heightFeet, profile.heightInches);
  const sexAdjustment = profile.gender === 'male' ? 5 : -161;

  // Mifflin–St Jeor resting-energy equation.
  const bmr =
    (10 * Number(weight)) +
    (6.25 * heightCm) -
    (5 * Number(profile.age)) +
    sexAdjustment;

  const activityFactor = ACTIVITY_OPTIONS[profile.activityLevel]?.factor || 1.20;
  const maintenance = bmr * activityFactor;
  const dailyDeficit = (Number(profile.weeklyLoss) * KCAL_PER_KG) / 7;
  const dailyTarget = maintenance - dailyDeficit;

  return {
    heightCm,
    bmr: Math.round(bmr),
    maintenance: Math.round(maintenance),
    dailyDeficit: Math.round(dailyDeficit),
    dailyTarget: Math.round(dailyTarget)
  };
}

function hasCalorieProfile(profile) {
  return Boolean(
    profile &&
    Number.isFinite(Number(profile.age)) &&
    Number.isFinite(Number(profile.heightFeet)) &&
    Number.isFinite(Number(profile.heightInches)) &&
    profile.activityLevel
  );
}

function populatePaceOptions(gender, selectedPace = '') {
  const paceSelect = $('setupPace');
  const customLabel = $('customLossLabel');

  if (!gender || !PACE_OPTIONS[gender]) {
    paceSelect.innerHTML = '<option value="">Select gender first</option>';
    paceSelect.disabled = true;
    customLabel.hidden = true;
    return;
  }

  paceSelect.disabled = false;
  paceSelect.innerHTML = `
    <option value="">Select a pace</option>
    ${Object.entries(PACE_OPTIONS[gender]).map(([key, option]) =>
      `<option value="${key}">${option.label} — ${option.value.toFixed(2)} kg/week</option>`
    ).join('')}
    <option value="custom">Custom</option>
  `;

  paceSelect.value = selectedPace || '';
  customLabel.hidden = paceSelect.value !== 'custom';
}

function inferPaceKey(gender, weeklyLoss) {
  const options = PACE_OPTIONS[gender] || {};
  const match = Object.entries(options).find(([, option]) =>
    Math.abs(option.value - Number(weeklyLoss)) < 0.001
  );
  return match ? match[0] : 'custom';
}

function getSelectedWeeklyLoss() {
  const gender = $('setupGender').value;
  const pace = $('setupPace').value;

  if (!gender || !pace) return null;

  if (pace === 'custom') {
    const customLoss = Number($('setupCustomLoss').value);
    return Number.isFinite(customLoss) ? customLoss : null;
  }

  return PACE_OPTIONS[gender]?.[pace]?.value ?? null;
}

function generateTargets(profile) {
  const targets = [];
  for (let week = 0; week <= PLAN_WEEKS; week++) {
    targets.push({
      week,
      date: addDays(profile.startDate, week * 7),
      target: round1(profile.startWeight - profile.weeklyLoss * week)
    });
  }
  return targets;
}

function generateMilestones(profile) {
  const result = [round1(profile.startWeight)];
  const finalTarget = round1(profile.targetWeight);

  let next = Math.floor((profile.startWeight - 0.01) / 5) * 5;
  while (next > finalTarget) {
    if (!result.includes(next)) result.push(next);
    next -= 5;
  }

  if (!result.includes(finalTarget)) result.push(finalTarget);
  return result;
}

function latestWeighIn() {
  return [...data.weighIns].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
}

function targetForDate(date) {
  let closest = TARGETS[0];
  for (const target of TARGETS) {
    if (target.date <= date) closest = target;
    else break;
  }
  return closest;
}

function getWeekRange(week) {
  const startDate = addDays(data.profile.startDate, (week - 1) * 7);
  const endDate = addDays(startDate, 6);
  return { startDate, endDate };
}

function getWeeklyAverage(week) {
  const { startDate, endDate } = getWeekRange(week);

  const entries = data.weighIns.filter(item =>
    item.date >= startDate &&
    item.date <= endDate &&
    item.note !== 'Start'
  );

  if (!entries.length) {
    return { average: null, count: 0, entries: [] };
  }

  const average =
    entries.reduce((sum, item) => sum + Number(item.weight), 0) / entries.length;

  return {
    average,
    count: entries.length,
    entries
  };
}

function isWeekComplete(week) {
  const { endDate } = getWeekRange(week);
  return toISODate(new Date()) > endDate;
}

function calculate() {
  const profile = data.profile;
  const latest = latestWeighIn();
  const totalRequired = profile.startWeight - profile.targetWeight;
  const totalLost = profile.startWeight - latest.weight;
  const percent = totalRequired > 0
    ? Math.max(0, Math.min(100, totalLost / totalRequired * 100))
    : 0;

  const elapsedDays = Math.max(1, daysBetween(profile.startDate, latest.date));
  const averagePerWeek = totalLost / (elapsedDays / 7);
  const currentTarget = targetForDate(latest.date);
  const difference = currentTarget.target - latest.weight;
  const remaining = Math.max(0, latest.weight - profile.targetWeight);

  return {
    latest,
    totalLost,
    percent,
    averagePerWeek,
    difference,
    remaining
  };
}

function showSetup(editing = false) {
  const overlay = $('setupOverlay');
  overlay.hidden = false;
  $('setupError').textContent = '';
  $('cancelSetupBtn').hidden = !editing;

  const submitButton = $('setupForm').querySelector('button[type="submit"]');
  submitButton.textContent = editing ? 'Save plan' : 'Create plan';

  if (editing && data?.profile) {
    $('setupName').value = data.profile.name || '';
    $('setupGender').value = data.profile.gender;
    $('setupStartDate').value = data.profile.startDate;
    $('setupStartWeight').value = data.profile.startWeight;
    $('setupAge').value = data.profile.age || '';
    $('setupHeightFeet').value = data.profile.heightFeet ?? '';
    $('setupHeightInches').value = data.profile.heightInches ?? '';
    $('setupActivity').value = data.profile.activityLevel || '';

    const paceKey = data.profile.paceKey ||
      inferPaceKey(data.profile.gender, data.profile.weeklyLoss);

    populatePaceOptions(data.profile.gender, paceKey);
    $('setupPace').value = paceKey;

    if (paceKey === 'custom') {
      $('setupCustomLoss').value = data.profile.weeklyLoss;
      $('customLossLabel').hidden = false;
    }
  } else {
    $('setupForm').reset();
    $('setupStartDate').value = toISODate(new Date());
    populatePaceOptions('');
    $('setupCustomLoss').value = '';
  }

  updateSetupPreview();
}

function hideSetup() {
  $('setupOverlay').hidden = true;
}

function updateSetupPreview() {
  const gender = $('setupGender').value;
  const startWeight = Number($('setupStartWeight').value);
  const startDate = $('setupStartDate').value;
  const weeklyLoss = getSelectedWeeklyLoss();
  const age = Number($('setupAge').value);
  const heightFeet = Number($('setupHeightFeet').value);
  const heightInches = Number($('setupHeightInches').value);
  const activityLevel = $('setupActivity').value;

  if (
    !gender ||
    !weeklyLoss ||
    !Number.isFinite(startWeight) ||
    !startDate ||
    !Number.isFinite(age) ||
    !Number.isFinite(heightFeet) ||
    !Number.isFinite(heightInches) ||
    !activityLevel
  ) {
    $('setupPreview').textContent = 'Complete the fields to preview the plan.';
    return;
  }

  const targetWeight = round1(startWeight - weeklyLoss * PLAN_WEEKS);
  const finishDate = addDays(startDate, PLAN_WEEKS * 7);
  const caloriePlan = calculateCaloriePlan({
    gender,
    age,
    heightFeet,
    heightInches,
    activityLevel,
    weeklyLoss,
    startWeight
  });

  const lowThreshold = gender === 'male' ? 1500 : 1200;
  const warning = caloriePlan.dailyTarget < lowThreshold
    ? `<br><span class="calorie-warning">Warning: this estimate is below ${lowThreshold} kcal/day. Choose a slower pace or get professional guidance.</span>`
    : '';

  $('setupPreview').innerHTML = `
    <strong>${weeklyLoss.toFixed(2)} kg/week</strong> for ${PLAN_WEEKS} weeks<br>
    Target: <strong>${targetWeight.toFixed(1)} kg</strong><br>
    Final check-in: <strong>${fmtDate(finishDate)}</strong><br>
    Estimated maintenance: <strong>${caloriePlan.maintenance} kcal/day</strong><br>
    Required deficit: <strong>${caloriePlan.dailyDeficit} kcal/day</strong><br>
    Estimated intake target: <strong>${caloriePlan.dailyTarget} kcal/day</strong>
    ${warning}
  `;
}

function buildProfileFromSetup() {
  const name = $('setupName').value.trim();
  const gender = $('setupGender').value;
  const startDate = $('setupStartDate').value;
  const startWeight = Number($('setupStartWeight').value);
  const age = Number($('setupAge').value);
  const heightFeet = Number($('setupHeightFeet').value);
  const heightInches = Number($('setupHeightInches').value);
  const activityLevel = $('setupActivity').value;
  const paceKey = $('setupPace').value;
  const weeklyLoss = getSelectedWeeklyLoss();

  if (
    !gender ||
    !startDate ||
    !Number.isFinite(startWeight) ||
    !Number.isFinite(age) ||
    !Number.isFinite(heightFeet) ||
    !Number.isFinite(heightInches) ||
    !activityLevel ||
    !paceKey ||
    !weeklyLoss
  ) {
    throw new Error('Complete all required fields.');
  }

  if (age < 18 || age > 100) {
    throw new Error('Age must be between 18 and 100.');
  }

  if (heightFeet < 3 || heightFeet > 8 || heightInches < 0 || heightInches > 11) {
    throw new Error('Enter a valid height in feet and inches.');
  }

  if (weeklyLoss < 0.10 || weeklyLoss > 2.00) {
    throw new Error('Weekly loss must be between 0.10 kg and 2.00 kg.');
  }

  const targetWeight = round1(startWeight - weeklyLoss * PLAN_WEEKS);
  if (targetWeight < 30) {
    throw new Error('This 24-week target would fall below 30 kg. The starting weight is too low for this fixed plan.');
  }

  return {
    name,
    gender,
    age,
    heightFeet,
    heightInches,
    activityLevel,
    startDate,
    startWeight: round1(startWeight),
    paceKey,
    weeklyLoss: Number(weeklyLoss.toFixed(2)),
    targetWeight,
    finishDate: addDays(startDate, PLAN_WEEKS * 7)
  };
}

function render() {
  if (!data?.profile) {
    showSetup(false);
    return;
  }

  if (!hasCalorieProfile(data.profile)) {
    showSetup(true);
    $('setupError').textContent =
      'Add age, height and activity level to calculate maintenance and daily calories.';
    return;
  }

  TARGETS = generateTargets(data.profile);
  $('editPlanBtn').hidden = false;

  const c = calculate();
  const profile = data.profile;
  const displayName = profile.name ? `${profile.name}'s` : 'My';

  document.title = `${displayName} 24-week tracker`;
  $('pageTitle').textContent = `${displayName} road to ${profile.targetWeight.toFixed(1)} kg`;
  $('currentWeight').textContent = c.latest.weight.toFixed(1);
  $('changeSinceStart').textContent =
    `${c.totalLost >= 0 ? '−' : '+'}${Math.abs(c.totalLost).toFixed(1)} kg since start`;
  $('lastUpdate').textContent = fmtDate(c.latest.date);
  $('goalPercent').textContent = `${c.percent.toFixed(1)}%`;
  $('remainingWeight').textContent = c.remaining.toFixed(1);
  $('goalSummary').textContent =
    `Start ${profile.startWeight.toFixed(1)} kg → 24-week target ${profile.targetWeight.toFixed(1)} kg`;
  $('totalLost').textContent = `${c.totalLost.toFixed(1)} kg`;
  $('avgWeekly').textContent = `${c.averagePerWeek.toFixed(2)} kg/week`;
  const paceLabel = profile.paceKey === 'custom'
    ? 'Custom'
    : PACE_OPTIONS[profile.gender]?.[profile.paceKey]?.label || 'Selected';

  $('targetPace').textContent =
    `${paceLabel}: ${profile.weeklyLoss.toFixed(2)} kg/week`;

  const caloriePlan = calculateCaloriePlan(profile, c.latest.weight);
  $('dailyCalories').textContent = `${caloriePlan.dailyTarget} kcal`;
  $('calorieDetails').textContent =
    `Maintenance ${caloriePlan.maintenance} • Deficit ${caloriePlan.dailyDeficit}/day`;

  const lowThreshold = profile.gender === 'male' ? 1500 : 1200;
  $('dailyCalories').classList.toggle('unsafe-calories', caloriePlan.dailyTarget < lowThreshold);
  $('calorieDetails').textContent += caloriePlan.dailyTarget < lowThreshold
    ? ' • Very low estimate'
    : '';

  const bmi = calculateBmi(
    c.latest.weight,
    profile.heightFeet,
    profile.heightInches
  );

  $('currentBmi').textContent = bmi ? bmi.toFixed(1) : '—';
  $('bmiMeaning').textContent = bmi
    ? `${getBmiCategory(bmi)} • adult BMI scale`
    : 'BMI unavailable';

  $('planFinish').textContent = fmtDate(profile.finishDate);

  const circumference = 314.16;
  $('ringProgress').style.strokeDashoffset =
    circumference * (1 - c.percent / 100);

  const status = $('planStatus');
  if (c.difference >= 0.5) {
    status.textContent = 'Ahead of plan';
    status.className = 'status ahead';
  } else if (c.difference >= -0.5) {
    status.textContent = 'On track';
    status.className = 'status';
  } else {
    status.textContent = 'Behind plan';
    status.className = 'status';
  }

  const elapsedWeeks = Math.max(
    0,
    Math.min(PLAN_WEEKS, Math.floor(daysBetween(profile.startDate, c.latest.date) / 7))
  );
  const nextWeek = Math.min(PLAN_WEEKS, elapsedWeeks + 1);
  const nextTarget = TARGETS[nextWeek];

  if (c.latest.weight <= profile.targetWeight) {
    $('missionTitle').textContent = '24-week target reached';
    $('missionText').textContent = 'Keep tracking and maintain the result.';
    $('missionBar').style.width = '100%';
  } else {
    $('missionTitle').textContent = `Week ${nextWeek}: ${nextTarget.target.toFixed(1)} kg`;
    $('missionText').textContent = `Enter weigh-ins any day. Week ${nextWeek} ends ${fmtDate(addDays(profile.startDate, nextWeek * 7 - 1))}.`;
    $('missionBar').style.width = `${c.percent}%`;
  }

  renderChart();
  renderHistory();
  renderMilestones();
  renderMeasurements();
}

function renderChart() {
  const el = $('weightChart');
  const width = Math.max(760, el.clientWidth || 760);
  const height = 320;
  const pad = { l: 52, r: 20, t: 20, b: 42 };

  const allWeights = [
    ...TARGETS.map(item => item.target),
    ...data.weighIns.map(item => item.weight)
  ];

  const yMin = Math.floor(Math.min(...allWeights) / 5) * 5 - 5;
  const yMax = Math.ceil(Math.max(...allWeights) / 5) * 5 + 5;

  const start = parseISODate(TARGETS[0].date).getTime();
  const finish = parseISODate(TARGETS.at(-1).date).getTime();
  const span = Math.max(1, finish - start);

  const xForDate = iso =>
    pad.l + (parseISODate(iso).getTime() - start) / span * (width - pad.l - pad.r);

  const y = value =>
    pad.t + (yMax - value) * (height - pad.t - pad.b) / (yMax - yMin);

  const targetPoints = TARGETS
    .map(item => `${xForDate(item.date)},${y(item.target)}`)
    .join(' ');

  const actual = [];

  for (let week = 1; week <= PLAN_WEEKS; week++) {
    if (!isWeekComplete(week)) continue;

    const weekly = getWeeklyAverage(week);
    if (weekly.average === null) continue;

    actual.push({
      date: TARGETS[week].date,
      weight: weekly.average,
      count: weekly.count,
      week
    });
  }

  const actualPoints = actual
    .map(item => `${xForDate(item.date)},${y(item.weight)}`)
    .join(' ');

  let grid = '';
  for (let value = Math.ceil(yMin / 5) * 5; value <= yMax; value += 5) {
    grid += `
      <line x1="${pad.l}" y1="${y(value)}" x2="${width - pad.r}" y2="${y(value)}" stroke="#23354d"/>
      <text x="8" y="${y(value) + 4}" fill="#8295ad" font-size="11">${value}</text>
    `;
  }

  const labelIndexes = [0, 4, 8, 12, 16, 20, 24];
  const labels = labelIndexes.map(index => `
    <text x="${xForDate(TARGETS[index].date)}"
          y="${height - 12}"
          text-anchor="middle"
          fill="#8295ad"
          font-size="11">W${index}</text>
  `).join('');

  const dots = actual.map(item => `
    <circle cx="${xForDate(item.date)}" cy="${y(item.weight)}" r="4" fill="#5da7ff">
      <title>Week ${item.week} average: ${item.weight.toFixed(1)} kg (${item.count} check-ins)</title>
    </circle>
  `).join('');

  el.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Weight trend chart">
      ${grid}
      <polyline points="${targetPoints}" fill="none" stroke="#63d68a" stroke-width="3"/>
      ${actualPoints ? `<polyline points="${actualPoints}" fill="none" stroke="#5da7ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      ${dots}
      ${labels}
    </svg>
  `;
}

function renderHistory() {
  const tbody = $('historyBody');
  tbody.innerHTML = '';

  const startRow = document.createElement('tr');
  startRow.innerHTML = `
    <td>Start</td>
    <td>${fmtDate(data.profile.startDate)}</td>
    <td>${data.profile.startWeight.toFixed(1)} kg</td>
    <td>${data.profile.startWeight.toFixed(1)} kg</td>
    <td>1</td>
    <td>—</td>
    <td><span class="badge track">Started</span></td>
  `;
  tbody.appendChild(startRow);

  for (let week = 1; week <= PLAN_WEEKS; week++) {
    const target = TARGETS[week];
    const { endDate } = getWeekRange(week);
    const weekly = getWeeklyAverage(week);
    const complete = isWeekComplete(week);

    const average = complete ? weekly.average : null;
    const difference = average !== null ? target.target - average : null;

    let statusText = complete ? 'No check-ins' : 'In progress';
    let statusClass = 'track';

    if (complete && average !== null) {
      if (difference >= 0.5) {
        statusText = 'Ahead';
        statusClass = 'ahead';
      } else if (difference >= -0.5) {
        statusText = 'On track';
        statusClass = 'track';
      } else {
        statusText = 'Behind';
        statusClass = 'behind';
      }
    }

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${week}</td>
      <td>${fmtDate(endDate)}</td>
      <td>${target.target.toFixed(1)} kg</td>
      <td>${average !== null ? `${average.toFixed(1)} kg` : '—'}</td>
      <td>${complete ? weekly.count : '—'}</td>
      <td>${difference !== null ? `${difference >= 0 ? '+' : ''}${difference.toFixed(1)} kg` : '—'}</td>
      <td><span class="badge ${statusClass}">${statusText}</span></td>
    `;
    tbody.appendChild(row);
  }
}

function renderMilestones() {
  const c = calculate();
  const milestones = generateMilestones(data.profile);

  $('milestones').innerHTML = milestones.map((value, index) => {
    const done = c.latest.weight <= value;
    const isStart = index === 0;
    const isLast = index === milestones.length - 1;
    const label = isStart ? 'Started' : isLast ? '24-week target' : 'Checkpoint';

    return `
      <div class="milestone ${done ? 'done' : ''}">
        <div class="milestone-icon">${done ? '✓' : index + 1}</div>
        <div>
          <h3>${value.toFixed(1)} kg</h3>
          <p>${label}</p>
        </div>
        <div class="milestone-tag">
          ${done ? 'Completed' : `${Math.max(0, c.latest.weight - value).toFixed(1)} kg left`}
        </div>
      </div>
    `;
  }).join('');
}

function renderMeasurements() {
  const el = $('measurementList');

  if (!data.measurements.length) {
    el.innerHTML =
      '<p style="color:#8da0b8">No measurements yet. Add waist, chest, hips, thigh, and arm measurements monthly.</p>';
    return;
  }

  const sorted = [...data.measurements].sort((a, b) => b.date.localeCompare(a.date));

  el.innerHTML = sorted.map((item, index) => `
    <div class="measurement-row">
      <strong>${fmtDate(item.date)}</strong>
      <span>Waist ${item.waist || '—'}</span>
      <span>Chest ${item.chest || '—'}</span>
      <span>Hips ${item.hips || '—'}</span>
      <span>Thigh ${item.thigh || '—'}</span>
      <span>Arm ${item.arm || '—'}</span>
      <button class="delete-btn" data-index="${index}">Delete</button>
    </div>
  `).join('');

  el.querySelectorAll('.delete-btn').forEach(button => {
    button.onclick = () => {
      const item = sorted[Number(button.dataset.index)];
      data.measurements = data.measurements.filter(candidate => candidate !== item);
      saveAndRender();
    };
  });
}

$('setupGender').addEventListener('change', () => {
  populatePaceOptions($('setupGender').value);
  $('setupCustomLoss').value = '';
  updateSetupPreview();
});

$('setupPace').addEventListener('change', () => {
  $('customLossLabel').hidden = $('setupPace').value !== 'custom';
  if ($('setupPace').value !== 'custom') $('setupCustomLoss').value = '';
  updateSetupPreview();
});

$('setupCustomLoss').addEventListener('input', updateSetupPreview);
$('setupStartDate').addEventListener('input', updateSetupPreview);
$('setupStartWeight').addEventListener('input', updateSetupPreview);
$('setupAge').addEventListener('input', updateSetupPreview);
$('setupHeightFeet').addEventListener('input', updateSetupPreview);
$('setupHeightInches').addEventListener('input', updateSetupPreview);
$('setupActivity').addEventListener('change', updateSetupPreview);

$('setupForm').addEventListener('submit', event => {
  event.preventDefault();
  $('setupError').textContent = '';

  try {
    const profile = buildProfileFromSetup();
    const existingMeasurements = data?.measurements || [];
    const existingWeighIns = data?.weighIns || [];

    const startEntry = {
      date: profile.startDate,
      weight: profile.startWeight,
      note: 'Start'
    };

    data = {
      profile,
      weighIns: [startEntry],
      measurements: []
    };

    if ($('cancelSetupBtn').hidden === false && existingWeighIns.length) {
      data.weighIns = existingWeighIns
        .filter(item => item.note !== 'Start')
        .concat(startEntry)
        .sort((a, b) => a.date.localeCompare(b.date));
      data.measurements = existingMeasurements;
    }

    persist();
    hideSetup();
    render();
  } catch (error) {
    $('setupError').textContent = error.message;
  }
});

$('cancelSetupBtn').addEventListener('click', hideSetup);
$('editPlanBtn').addEventListener('click', () => showSetup(true));

$('weighInForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!data?.profile) return;

  const date = $('entryDate').value;
  const weight = Number($('entryWeight').value);
  const note = $('entryNote').value.trim();

  const existing = data.weighIns.find(item => item.date === date);
  if (existing) {
    existing.weight = weight;
    existing.note = note;
  } else {
    data.weighIns.push({ date, weight, note });
  }

  data.weighIns.sort((a, b) => a.date.localeCompare(b.date));
  event.target.reset();
  $('entryDate').value = toISODate(new Date());
  saveAndRender();
});

$('measurementForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!data?.profile) return;

  data.measurements.push({
    date: $('mDate').value,
    waist: $('mWaist').value,
    chest: $('mChest').value,
    hips: $('mHips').value,
    thigh: $('mThigh').value,
    arm: $('mArm').value
  });

  event.target.reset();
  $('mDate').value = toISODate(new Date());
  saveAndRender();
});

$('exportBtn').addEventListener('click', () => {
  if (!data) {
    alert('Create a plan first.');
    return;
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json'
  });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = '24-week-weight-tracker-data.json';
  anchor.click();
  URL.revokeObjectURL(anchor.href);
});

$('importInput').addEventListener('change', async event => {
  try {
    const file = event.target.files?.[0];
    if (!file) return;

    const parsed = JSON.parse(await file.text());
    if (!parsed.profile || !Array.isArray(parsed.weighIns) || !Array.isArray(parsed.measurements)) {
      throw new Error('Invalid file');
    }

    data = parsed;
    persist();
    hideSetup();
    render();
  } catch {
    alert('That file is not a valid tracker export.');
  } finally {
    event.target.value = '';
  }
});

$('resetBtn').addEventListener('click', () => {
  if (!confirm('Delete this browser’s tracker data and create a new plan?')) return;

  localStorage.removeItem(STORAGE_KEY);
  data = null;
  $('editPlanBtn').hidden = true;
  showSetup(false);
});

window.addEventListener('resize', () => {
  if (data?.profile) renderChart();
});

$('entryDate').value = toISODate(new Date());
$('mDate').value = toISODate(new Date());

if (data?.profile) {
  hideSetup();
  render();
} else {
  showSetup(false);
}

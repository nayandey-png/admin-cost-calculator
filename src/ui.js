/* ui.js — rendering, events, tooltips, storage, CSV and print. */

import {
  ROLE_DEFAULTS,
  INSURERS,
  insurerLabel,
  DAYS_TO_PAY_OPTIONS,
  REJECTION_OPTIONS,
  WRITE_OFF_OPTIONS,
  GROUP_LABELS,
  BASIS_LABELS,
  ASSUMPTIONS_TEXT,
  TOOLTIPS,
  CONSTANTS
} from './defaults.js';
import { buildModel, compute, roleCost, roundedDelta } from './calc.js';
import {
  QUESTIONS,
  demoAnswers,
  blankAnswers,
  applyNotSure,
  validateQuestion,
  frontRoleOptions
} from './survey.js';
import { groupedBarChart, horizontalBarChart, escapeHtml } from './charts.js';

const STORAGE_KEY = 'pmiCalc.v1';
const SCHEMA_VERSION = 1;
const esc = escapeHtml;

/* ---------- formatting ---------- */

const gbp0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const gbp2 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

const money = (v) => gbp0.format(v);
const moneyPrecise = (v) => gbp2.format(v);
const hours = (v) => `${num0.format(v)} hrs`;
const hours1 = (v) => `${num1.format(v)} hrs`;
const days = (v) => `${num0.format(v)} days`;
const percent = (v) => `${num1.format(v * 100)}%`;

/* ---------- state ---------- */

const state = {
  view: 'survey',
  step: 0,
  answers: demoAnswers(),
  model: null,
  error: '',
  openTips: [],
  detailsOpen: false,
  status: ''
};

function rebuildModel() {
  state.model = buildModel(state.answers);
}

/* ---------- tooltips ---------- */

/** `instance` keeps ids unique where the same tooltip appears more than once. */
function tooltip(key, labelHtml, instance = '') {
  const text = TOOLTIPS[key];
  if (!text) return labelHtml;
  const slug = instance ? `${key}-${instance}` : key;
  const id = `tip-${slug}`;
  const open = state.openTips.includes(slug);
  return (
    `<span class="tip-wrap">${labelHtml}` +
    `<button type="button" class="tip-btn" id="tipbtn-${esc(slug)}" data-tip="${esc(slug)}" aria-expanded="${open}" aria-controls="${id}">` +
    `<span aria-hidden="true">?</span><span class="visually-hidden">What does this mean?</span></button></span>` +
    `<div class="tip-body" id="${id}"${open ? '' : ' hidden'}>${esc(text)}</div>`
  );
}

function toggleTip(key) {
  const index = state.openTips.indexOf(key);
  if (index === -1) state.openTips.push(key);
  else state.openTips.splice(index, 1);
}

/* ---------- small html helpers ---------- */

function field({ id, label, value, type = 'number', hint = '', min = 0, step = 'any', suffix = '', dataset = {} }) {
  const attrs = Object.entries(dataset)
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join('');
  return (
    `<div class="field">` +
    `<label for="${esc(id)}">${esc(label)}${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}</label>` +
    `<input id="${esc(id)}" type="${type}" inputmode="decimal" min="${min}" step="${step}" value="${esc(value)}" aria-describedby="${esc(id)}-error"${attrs}>` +
    (suffix ? `<span class="field__hint">${esc(suffix)}</span>` : '') +
    `<p class="error" id="${esc(id)}-error" aria-live="polite"></p>` +
    `</div>`
  );
}

function choice({ name, value, label, checked, type = 'radio', dataset = {} }) {
  const attrs = Object.entries(dataset)
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join('');
  const id = `${name}-${value}`;
  return (
    `<label class="choice${checked ? ' choice--selected' : ''}" for="${esc(id)}">` +
    `<input type="${type}" id="${esc(id)}" name="${esc(name)}" value="${esc(value)}"${checked ? ' checked' : ''}${attrs}>` +
    `<span>${esc(label)}</span></label>`
  );
}

function tile({ label, value, note = '', success = false, negative = false, tip = '' }) {
  const labelHtml = tip ? tooltip(tip, `<span class="tile__label">${esc(label)}</span>`) : `<span class="tile__label">${esc(label)}</span>`;
  return (
    `<div class="tile${success ? ' tile--success' : ''}">` +
    labelHtml +
    `<span class="tile__value${negative ? ' tile__value--negative' : ''}">${esc(value)}</span>` +
    (note ? `<span class="tile__note">${esc(note)}</span>` : '') +
    `</div>`
  );
}

/* ---------- survey ---------- */

function roleSettingsBlock(roleKey) {
  const base = ROLE_DEFAULTS.find((r) => r.key === roleKey);
  if (!base) return '';
  const custom = (state.answers.roleSettings || {})[roleKey] || {};
  const salary = custom.salary !== undefined && custom.salary !== '' ? custom.salary : base.salary;
  const weeklyHours = custom.weeklyHours !== undefined && custom.weeklyHours !== '' ? custom.weeklyHours : base.weeklyHours;
  return (
    `<div class="role-settings">` +
    field({
      id: `salary-${roleKey}`,
      label: `${base.label} — salary a year`,
      value: salary,
      dataset: { rolesetting: 'salary', role: roleKey }
    }) +
    field({
      id: `hours-${roleKey}`,
      label: `${base.label} — hours a week`,
      value: weeklyHours,
      dataset: { rolesetting: 'weeklyHours', role: roleKey }
    }) +
    `</div>`
  );
}

function renderQuestion(index) {
  const q = QUESTIONS[index];
  const a = state.answers;

  switch (q.id) {
    case 'insurers':
      return (
        `<fieldset><legend class="visually-hidden">Insurers</legend><div class="choice-list choice-list--inline">` +
        INSURERS.map((i) =>
          choice({
            name: 'insurers',
            value: i.key,
            label: i.label,
            checked: (a.insurers || []).includes(i.key),
            type: 'checkbox',
            dataset: { answer: 'insurers' }
          })
        ).join('') +
        `</div></fieldset>`
      );

    case 'appointments':
      return (a.insurers || [])
        .map((key) =>
          field({
            id: `appts-${key}`,
            label: `${insurerLabel(key)} — appointments a month`,
            value: (a.appointments || {})[key] === undefined ? '' : a.appointments[key],
            dataset: { answer: 'appointments', insurer: key }
          })
        )
        .join('');

    case 'fee':
      return field({
        id: 'fee',
        label: 'Average fee per insured session',
        value: a.fee === undefined ? '' : a.fee,
        hint: 'In pounds, for example 70.',
        dataset: { answer: 'fee' }
      });

    case 'billingRoles': {
      const selected = a.billingRoles || [];
      const list =
        `<fieldset><legend class="visually-hidden">People who handle billing</legend><div class="choice-list">` +
        ROLE_DEFAULTS.map(
          (r) =>
            choice({
              name: 'billingRoles',
              value: r.key,
              label: r.label,
              checked: selected.includes(r.key),
              type: 'checkbox',
              dataset: { answer: 'billingRoles' }
            }) + (selected.includes(r.key) ? roleSettingsBlock(r.key) : '')
        ).join('') +
        `</div></fieldset>`;

      if (selected.length < 2) return list;

      const followUp =
        `<fieldset><legend>Who does most of the chasing and fixing problems?` +
        `<span class="field__hint">Rejected claims, shortfalls and overdue payments.</span></legend>` +
        `<div class="choice-list choice-list--inline">` +
        selected
          .map((key) => {
            const role = ROLE_DEFAULTS.find((r) => r.key === key);
            return choice({
              name: 'exceptionRole',
              value: key,
              label: role ? role.label : key,
              checked: a.exceptionRole === key,
              dataset: { answer: 'exceptionRole' }
            });
          })
          .join('') +
        `</div></fieldset>`;
      return list + followUp;
    }

    case 'frontRole': {
      const options = frontRoleOptions(a);
      const chosen = a.billingRoles || [];
      return (
        `<fieldset><legend class="visually-hidden">Person who handles authorisations</legend><div class="choice-list">` +
        options
          .map((r) => {
            const already = chosen.includes(r.key);
            const label = already ? `${r.label} (already handles billing)` : r.label;
            const block = a.frontRole === r.key && !already ? roleSettingsBlock(r.key) : '';
            return (
              choice({
                name: 'frontRole',
                value: r.key,
                label,
                checked: a.frontRole === r.key,
                dataset: { answer: 'frontRole' }
              }) + block
            );
          })
          .join('') +
        `</div></fieldset>`
      );
    }

    case 'daysToPay':
      return (a.insurers || [])
        .map(
          (key) =>
            `<fieldset><legend>${esc(insurerLabel(key))}</legend><div class="choice-list choice-list--inline">` +
            DAYS_TO_PAY_OPTIONS.map((o) =>
              choice({
                name: `daysToPay-${key}`,
                value: o.key,
                label: o.label,
                checked: (a.daysToPay || {})[key] === o.key,
                dataset: { answer: 'daysToPay', insurer: key }
              })
            ).join('') +
            `</div></fieldset>`
        )
        .join('');

    case 'rejections':
      return (
        `<fieldset><legend class="visually-hidden">Rejection frequency</legend><div class="choice-list choice-list--inline">` +
        REJECTION_OPTIONS.filter((o) => o.key !== 'notsure')
          .map((o) =>
            choice({
              name: 'rejections',
              value: o.key,
              label: o.label,
              checked: a.rejections === o.key,
              dataset: { answer: 'rejections' }
            })
          )
          .join('') +
        `</div></fieldset>` +
        (a.rejections === 'notsure' ? `<p class="note">Using a typical rate of 5% of claims.</p>` : '')
      );

    case 'agedDebt':
      return (
        tooltip('agedDebt', `<span class="field__label">What counts as aged debt?</span>`) +
        field({
          id: 'agedDebt',
          label: 'Total owed, over 30 days late',
          value: a.agedDebtNotSure ? '' : a.agedDebt,
          hint: 'In pounds. Leave it to us if you’re not sure.',
          dataset: { answer: 'agedDebt' }
        }) +
        (a.agedDebtNotSure ? `<p class="note">We’ll estimate this from how long each insurer takes to pay.</p>` : '')
      );

    case 'writeOffs':
      return (
        `<fieldset><legend class="visually-hidden">Annual write-offs</legend><div class="choice-list choice-list--inline">` +
        WRITE_OFF_OPTIONS.filter((o) => o.key !== 'notsure')
          .map((o) =>
            choice({
              name: 'writeOffs',
              value: o.key,
              label: o.label,
              checked: a.writeOffs === o.key,
              dataset: { answer: 'writeOffs' }
            })
          )
          .join('') +
        `</div></fieldset>` +
        (a.writeOffs === 'notsure' ? `<p class="note">Using a typical figure of £1,000 a year.</p>` : '')
      );

    case 'effort': {
      const billingHoursWeekly = senseCheckHours();
      return (
        `<p class="sense-check" id="sense-check">We estimate your team spends about ` +
        `<strong>${esc(num1.format(billingHoursWeekly))} hours a week</strong> on insurance billing, chasing and reconciling.</p>` +
        `<div class="field">` +
        `<label for="effort">Does that sound right?</label>` +
        `<input type="range" id="effort" min="50" max="200" step="10" value="${esc(a.effort)}" data-answer="effort" ` +
        `aria-describedby="effort-value">` +
        `<div class="slider-scale" aria-hidden="true"><span>Much less</span><span>About right</span><span>Much more</span></div>` +
        `<p class="field__hint" id="effort-value">Currently set to ${esc(a.effort)}% of our estimate.</p>` +
        `</div>`
      );
    }

    default:
      return '';
  }
}

/** Weekly billing-group hours, used live by the Q10 sense check. */
function senseCheckHours() {
  const model = buildModel(state.answers);
  const results = compute(model);
  return (results.current.byGroup.B.minutes / 60) * (CONSTANTS.monthsPerYear / CONSTANTS.weeksPerYear);
}

function renderSurvey() {
  const index = state.step;
  const q = QUESTIONS[index];
  const isLast = index === QUESTIONS.length - 1;
  const percentDone = ((index + 1) / QUESTIONS.length) * 100;

  return (
    `<div class="progress">` +
    `<div class="progress__label"><span id="progress-text">Question ${index + 1} of ${QUESTIONS.length}</span></div>` +
    `<div class="progress__track" role="progressbar" aria-valuenow="${index + 1}" aria-valuemin="1" aria-valuemax="${QUESTIONS.length}" aria-labelledby="progress-text">` +
    `<div class="progress__bar" style="width:${percentDone}%"></div></div></div>` +
    `<div class="card">` +
    `<h2 id="question-title">${esc(q.title)}</h2>` +
    `<p class="question__helper">${esc(q.helper)}</p>` +
    `<div id="question-body">${renderQuestion(index)}</div>` +
    `<p class="error" id="survey-error" role="alert">${esc(state.error)}</p>` +
    `<div class="button-row button-row--split">` +
    `<div class="button-row">` +
    `<button type="button" class="btn btn--quiet" data-action="back"${index === 0 ? ' disabled' : ''}>Back</button>` +
    (q.notSure ? `<button type="button" class="btn btn--secondary" data-action="not-sure">Not sure</button>` : '') +
    `</div>` +
    `<button type="button" class="btn" data-action="next">${isLast ? 'See my results' : 'Next'}</button>` +
    `</div></div>` +
    `<div class="button-row no-print">` +
    `<button type="button" class="btn btn--quiet" data-action="reset">Reset</button>` +
    `<button type="button" class="btn btn--quiet" data-action="clear">Clear example data</button>` +
    `<button type="button" class="btn btn--quiet" data-action="save">Save</button>` +
    `<span class="status" role="status">${esc(state.status)}</span>` +
    `</div>`
  );
}

/* ---------- results ---------- */

function renderResults() {
  const model = state.model;
  const r = compute(model);

  const totalCost = roundedDelta(r.current.totals.cost, r.effra.totals.cost, 0);
  const daysDelta = roundedDelta(r.current.avgDaysToPay, r.effra.avgDaysToPay, 0);

  return (
    renderHeader() +
    renderSummary(r, totalCost, daysDelta) +
    renderEffraCard(r, daysDelta) +
    renderReleasedTime(r) +
    renderCurrentProcess(r) +
    renderBreakdownCharts(r) +
    renderAssumptions() +
    (r.excludedActivities > 0
      ? `<p class="note">${r.excludedActivities} ${r.excludedActivities === 1 ? 'activity has' : 'activities have'} no one assigned, so ${r.excludedActivities === 1 ? 'it is' : 'they are'} left out of these figures.</p>`
      : '')
  );
}

function renderHeader() {
  return (
    `<div class="button-row button-row--split" style="margin-bottom:1rem">` +
    `<h1 style="margin:0">Your results</h1>` +
    `<button type="button" class="btn btn--secondary no-print" data-action="edit-answers">Edit answers</button>` +
    `</div>`
  );
}

function renderSummary(r, totalCost, daysDelta) {
  const staffHours = r.current.totals.minutes / 60;
  const billingHours = r.headline.billingHoursReleasedMonthly;
  return (
    `<div class="card">` +
    `<p class="summary-text">Your clinic spends about <strong>${esc(money(totalCost.current))}</strong> and ` +
    `<strong>${esc(hours(staffHours))}</strong> of staff time a month administering insured work. ` +
    `With Effra, insurers would pay you about <strong>${esc(days(daysDelta.difference))}</strong> sooner, and ` +
    `<strong>${esc(hours1(billingHours))}</strong> of billing and payment work a month would be done for you.</p>` +
    `</div>`
  );
}

function renderEffraCard(r, daysDelta) {
  const h = r.headline;
  const releasedHours = h.releasedHoursTotal;

  const tiles =
    tile({
      label: 'Cash released by faster payment',
      value: money(h.cashReleased),
      note: 'One-off, as the payment backlog clears',
      success: h.cashReleased > 0,
      negative: h.cashReleased < 0
    }) +
    tile({
      label: 'Write-offs recovered',
      value: money(h.writeOffsRecovered),
      note: 'Per year',
      success: h.writeOffsRecovered > 0,
      negative: h.writeOffsRecovered < 0
    }) +
    tile({
      label: 'Aged debt reduced',
      value: money(h.agedDebtReduced),
      note: 'One-off balance',
      success: h.agedDebtReduced > 0,
      negative: h.agedDebtReduced < 0
    }) +
    tile({
      label: 'Admin time released',
      value: `${num0.format(releasedHours)} hrs/yr`,
      note: `Worth ${money(h.capacityValue)}`,
      success: releasedHours > 0,
      negative: releasedHours < 0,
      tip: 'timeReleased'
    });

  const daysChart = groupedBarChart({
    title: 'Days to payment by insurer',
    categories: r.perInsurer.map((i) => {
      const d = roundedDelta(i.currentDays, i.effraDays, 0);
      return { label: i.label, current: d.current, effra: d.effra };
    }),
    format: days
  });

  const billing = roundedDelta(r.current.byGroup.B.cost, r.effra.byGroup.B.cost, 0);
  const front = roundedDelta(r.current.byGroup.F.cost, r.effra.byGroup.F.cost, 0);
  const costChart = groupedBarChart({
    title: 'Admin cost a month',
    categories: [
      { label: GROUP_LABELS.B, current: billing.current, effra: billing.effra },
      { label: GROUP_LABELS.F, current: front.current, effra: front.effra },
      { label: 'Total', current: billing.current + front.current, effra: billing.effra + front.effra }
    ],
    format: money
  });

  return (
    `<div class="card card--success">` +
    `<h2>With Effra</h2>` +
    `<div class="tiles">${tiles}</div>` +
    daysChart +
    costChart +
    `</div>`
  );
}

function renderReleasedTime(r) {
  const model = state.model;
  const blocks = model.roles
    .map((role) => {
      const worked = r.current.byRole[role.key];
      if (!worked || worked.minutes <= 0) return '';
      const released = r.released[role.key];
      const costModel = r.current.roleCosts[role.key];
      const choice_ = model.timeChoices[role.key] || { mode: 'keep', hoursCut: '' };

      if (!released || released.hoursReleased <= 0.01) {
        const remaining = r.effra.activities
          .filter((a) => a.role === role.key && a.cost > 0)
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 2)
          .map((a) => a.label.toLowerCase());
        const list = remaining.length ? remaining.join(' and ') : 'their insurance admin';
        return (
          `<div class="role-block"><div class="role-block__head"><h4>${esc(role.label)}</h4></div>` +
          `<p class="role-block__none">No time released. Their insurance tasks, such as ${esc(list)}, aren’t changed by Effra.</p>` +
          `</div>`
        );
      }

      const name = `choice-${role.key}`;
      const reduceOpen = choice_.mode === 'reduce';
      return (
        `<div class="role-block">` +
        `<div class="role-block__head"><h4>${esc(role.label)}</h4>` +
        `<span class="role-block__hours">${esc(num0.format(released.hoursReleased))} hrs/yr released</span></div>` +
        `<fieldset><legend class="visually-hidden">What ${esc(role.label)} does with the released time</legend>` +
        `<div class="choice-list choice-list--inline">` +
        choice({ name, value: 'keep', label: 'Keep for other work', checked: choice_.mode !== 'reduce' && choice_.mode !== 'remove', dataset: { choice: role.key } }) +
        choice({ name, value: 'reduce', label: 'Reduce paid hours', checked: choice_.mode === 'reduce', dataset: { choice: role.key } }) +
        choice({ name, value: 'remove', label: 'Remove this role', checked: choice_.mode === 'remove', dataset: { choice: role.key } }) +
        `</div></fieldset>` +
        (reduceOpen
          ? field({
              id: `hourscut-${role.key}`,
              label: 'Paid hours cut per week',
              value: choice_.hoursCut === undefined ? '' : choice_.hoursCut,
              dataset: { hourscut: role.key }
            })
          : '') +
        (choice_.mode === 'remove'
          ? `<p class="role-block__helper">This role’s hours go to zero, for example by not replacing someone when they leave. ` +
            `Removes ${esc(num0.format(costModel.contractedHours))} working hours and ${esc(money(costModel.employmentCost))} of cost a year.</p>`
          : '') +
        `</div>`
      );
    })
    .join('');

  const excess = r.cash.excess > 0
    ? `<p class="cash-excess">${esc(money(r.cash.excess))} more comes from the staffing change itself, not from Effra.</p>`
    : '';

  return (
    `<div class="card">` +
    `<h2>What will you do with the released time?</h2>` +
    `<p class="card__lead">Only time that reduces paid hours counts as a cash saving.</p>` +
    blocks +
    `<p class="cash-total">Cash saving credited to Effra: ${esc(money(r.cash.credited))}/yr</p>` +
    excess +
    `</div>`
  );
}

function renderCurrentProcess(r) {
  const tiles =
    tile({ label: 'Admin cost a month', value: money(r.current.totals.cost) }) +
    tile({ label: 'Staff hours a month', value: hours1(r.current.totals.minutes / 60) }) +
    tile({ label: 'Cost per claim', value: moneyPrecise(r.ratios.costPerClaim) }) +
    tile({ label: 'Cost per appointment', value: moneyPrecise(r.ratios.costPerAppointment) }) +
    tile({ label: '% of insured revenue', value: percent(r.ratios.pctOfRevenue) }) +
    tile({
      label: 'Rework rate',
      value: percent(r.ratios.reworkRate),
      note: `With Effra: ${percent(r.ratios.effraReworkRate)}`
    });

  return `<div class="card"><h2>Your current process</h2><div class="tiles">${tiles}</div></div>`;
}

function renderBreakdownCharts(r) {
  const byInsurer = state.model.insurers.map((i) => ({
    label: i.label,
    value: r.current.byInsurer[i.key] ? r.current.byInsurer[i.key].cost : 0
  }));

  const byActivity = r.current.activities
    .slice()
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 7)
    .map((a) => ({ label: a.label, value: a.cost }));

  const byRole = state.model.roles
    .filter((role) => r.current.byRole[role.key] && r.current.byRole[role.key].cost > 0)
    .map((role) => ({ label: role.label, value: r.current.byRole[role.key].cost }));

  return (
    `<div class="card"><h2>Where the cost sits</h2>` +
    horizontalBarChart({ title: 'Cost a month by insurer', items: byInsurer, format: money, valueHeading: 'Cost a month' }) +
    horizontalBarChart({ title: 'Cost a month by activity (top 7)', items: byActivity, format: money, valueHeading: 'Cost a month' }) +
    horizontalBarChart({ title: 'Cost a month by staff role', items: byRole, format: money, valueHeading: 'Cost a month' }) +
    `</div>`
  );
}

function renderAssumptions() {
  return `<details><summary>Assumptions</summary><p>${esc(ASSUMPTIONS_TEXT)}</p></details>`;
}

/* ---------- detailed assumptions panel ---------- */

function renderDetailsPanel() {
  const model = state.model;

  const roleRows = model.roles
    .map((role, index) => {
      const cost = roleCost(role);
      return (
        `<tr>` +
        `<td data-label="Role"><label class="visually-hidden" for="d-role-name-${index}">Role name</label>` +
        `<input id="d-role-name-${index}" type="text" value="${esc(role.label)}" data-role-field="label" data-role-index="${index}"></td>` +
        `<td data-label="Salary a year"><label class="visually-hidden" for="d-role-salary-${index}">Salary for ${esc(role.label)}</label>` +
        `<input id="d-role-salary-${index}" type="number" inputmode="decimal" min="0" step="any" value="${esc(role.salary)}" data-role-field="salary" data-role-index="${index}">` +
        `<p class="error" id="d-role-salary-${index}-error" aria-live="polite"></p></td>` +
        `<td data-label="Hours a week"><label class="visually-hidden" for="d-role-hours-${index}">Weekly hours for ${esc(role.label)}</label>` +
        `<input id="d-role-hours-${index}" type="number" inputmode="decimal" min="0" step="any" value="${esc(role.weeklyHours)}" data-role-field="weeklyHours" data-role-index="${index}">` +
        `<p class="error" id="d-role-hours-${index}-error" aria-live="polite"></p></td>` +
        `<td data-label="Hourly override"><label class="visually-hidden" for="d-role-override-${index}">Hourly override for ${esc(role.label)}</label>` +
        `<input id="d-role-override-${index}" type="number" inputmode="decimal" min="0" step="any" value="${role.hourlyOverride === null ? '' : esc(role.hourlyOverride)}" data-role-field="hourlyOverride" data-role-index="${index}">` +
        `<p class="error" id="d-role-override-${index}-error" aria-live="polite"></p></td>` +
        `<td data-label="True hourly cost"><span id="d-role-hourly-${index}">${esc(moneyPrecise(cost.hourlyCost))}</span>` +
        (cost.valid ? '' : `<p class="error">Productive hours must be above zero.</p>`) +
        `</td></tr>`
      );
    })
    .join('');

  const rolesTable = scrollable('Roles',
    `<table class="data-table"><caption>Roles</caption><thead><tr>` +
    `<th scope="col">Role</th><th scope="col">Salary a year</th><th scope="col">Hours a week</th>` +
    `<th scope="col">${tooltip('hourlyOverride', 'Hourly override')}</th><th scope="col">True hourly cost</th>` +
    `</tr></thead><tbody>${roleRows}</tbody></table>`);

  const insurerRows = model.insurers
    .map((insurer, index) => {
      const cells = [
        ['appointments', 'Appointments', insurer.appointments, null],
        ['courses', 'Courses', insurer.courses, null],
        ['invoices', 'Invoices', insurer.invoices, null],
        ['revenue', 'Revenue a month', insurer.revenue, null],
        ['rejectionPct', 'Rejected %', insurer.rejectionPct, 100],
        ['daysToPay', 'Days to pay', insurer.daysToPay, null],
        ['writeOffsMonthly', 'Write-offs a month', insurer.writeOffsMonthly, null],
        ['agedDebt', 'Aged debt', insurer.agedDebt, null]
      ]
        .map(([fieldName, label, value, max]) => {
          const id = `d-ins-${index}-${fieldName}`;
          return (
            `<td data-label="${esc(label)}">` +
            `<label class="visually-hidden" for="${id}">${esc(label)} for ${esc(insurer.label)}</label>` +
            `<input id="${id}" type="number" inputmode="decimal" min="0" step="any" value="${esc(round4(value))}" ` +
            `data-insurer-field="${fieldName}" data-insurer-index="${index}"${max ? ` data-max="${max}"` : ''}>` +
            `<p class="error" id="${id}-error" aria-live="polite"></p></td>`
          );
        })
        .join('');
      return `<tr><th scope="row" data-label="Insurer">${esc(insurer.label)}</th>${cells}</tr>`;
    })
    .join('');

  const insurersTable = scrollable('Per insurer',
    `<table class="data-table"><caption>Per insurer</caption><thead><tr>` +
    `<th scope="col">Insurer</th><th scope="col">Appointments</th>` +
    `<th scope="col">${tooltip('courses', 'Courses')}</th><th scope="col">Invoices</th><th scope="col">Revenue a month</th>` +
    `<th scope="col">${tooltip('rejectedPct', 'Rejected %')}</th><th scope="col">${tooltip('daysToPay', 'Days to pay')}</th>` +
    `<th scope="col">${tooltip('writeOffs', 'Write-offs a month')}</th><th scope="col">${tooltip('agedDebt', 'Aged debt')}</th>` +
    `</tr></thead><tbody>${insurerRows}</tbody></table>`);

  const activityTable = (group) => {
    const rows = model.activities
      .map((activity, index) => ({ activity, index }))
      .filter((entry) => entry.activity.group === group)
      .map(({ activity, index }) => {
        const isBatch = activity.type === 'batch';
        const roleOptions =
          `<option value="">— no one —</option>` +
          model.roles
            .map((role) => `<option value="${esc(role.key)}"${role.key === activity.role ? ' selected' : ''}>${esc(role.label)}</option>`)
            .join('');
        const idBase = `d-act-${index}`;
        return (
          `<tr><th scope="row" data-label="Activity">${esc(activity.label)}</th>` +
          `<td data-label="Who"><label class="visually-hidden" for="${idBase}-role">Who does ${esc(activity.label)}</label>` +
          `<select id="${idBase}-role" data-activity-field="role" data-activity-index="${index}">${roleOptions}</select></td>` +
          `<td data-label="Basis">${esc(isBatch ? 'Batches a month' : BASIS_LABELS[activity.basis] || '')}</td>` +
          `<td data-label="Incidence %">` +
          (isBatch
            ? '<span aria-hidden="true">—</span>'
            : `<label class="visually-hidden" for="${idBase}-inc">Incidence % for ${esc(activity.label)}</label>` +
              `<input id="${idBase}-inc" type="number" inputmode="decimal" min="0" max="100" step="any" value="${esc(round4(activity.incidence))}" data-activity-field="incidence" data-activity-index="${index}" data-max="100">` +
              `<p class="error" id="${idBase}-inc-error" aria-live="polite"></p>`) +
          `</td>` +
          `<td data-label="${isBatch ? 'Batches' : 'Follow-ups'}">` +
          `<label class="visually-hidden" for="${idBase}-rep">${isBatch ? 'Batches' : 'Follow-ups'} for ${esc(activity.label)}</label>` +
          `<input id="${idBase}-rep" type="number" inputmode="decimal" min="0" step="any" value="${esc(round4(isBatch ? activity.batches : activity.followUps))}" data-activity-field="${isBatch ? 'batches' : 'followUps'}" data-activity-index="${index}">` +
          `<p class="error" id="${idBase}-rep-error" aria-live="polite"></p></td>` +
          `<td data-label="Minutes"><label class="visually-hidden" for="${idBase}-min">Minutes for ${esc(activity.label)}</label>` +
          `<input id="${idBase}-min" type="number" inputmode="decimal" min="0" step="any" value="${esc(round4(activity.minutes))}" data-activity-field="minutes" data-activity-index="${index}">` +
          `<p class="error" id="${idBase}-min-error" aria-live="polite"></p></td></tr>`
        );
      })
      .join('');

    return scrollable(GROUP_LABELS[group],
      `<table class="data-table"><caption>${esc(GROUP_LABELS[group])}</caption><thead><tr>` +
      `<th scope="col">Activity</th><th scope="col">Who</th><th scope="col">Basis</th>` +
      `<th scope="col">${tooltip('incidence', 'Incidence %', group)}</th><th scope="col">${tooltip('followUps', 'Follow-ups', group)}</th>` +
      `<th scope="col">Minutes</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  };

  return (
    `<details id="details-panel" class="no-print"${state.detailsOpen ? ' open' : ''}>` +
    `<summary>Edit detailed assumptions</summary>` +
    `<p class="card__lead">Pre-filled from your answers. Changing your answers resets these edits.</p>` +
    rolesTable +
    insurersTable +
    activityTable('B') +
    activityTable('F') +
    `</details>`
  );
}

/** Wide tables scroll inside their own region rather than the whole page. */
function scrollable(label, tableHtml) {
  return `<div class="table-scroll" role="region" tabindex="0" aria-label="${esc(label)}">${tableHtml}</div>`;
}

function round4(value) {
  if (value === null || value === undefined || value === '') return '';
  return Math.round(Number(value) * 10000) / 10000;
}

/* ---------- top-level render ---------- */

function render() {
  const survey = document.getElementById('survey');
  const results = document.getElementById('results');

  if (state.view === 'survey') {
    survey.hidden = false;
    results.hidden = true;
    survey.innerHTML = renderSurvey();
  } else {
    survey.hidden = true;
    results.hidden = false;
    document.getElementById('results-output').innerHTML = renderResults();
    document.getElementById('details-host').innerHTML = renderDetailsPanel();
  }
  reportHeight();
}

/** Re-render only the results output, leaving the detailed panel's DOM alone. */
function renderOutputOnly() {
  document.getElementById('results-output').innerHTML = renderResults();
  reportHeight();
}

function withFocusPreserved(fn) {
  const active = document.activeElement;
  const id = active && active.id ? active.id : null;
  let caret = null;
  if (active && active.type === 'text') {
    try { caret = active.selectionStart; } catch (e) { caret = null; }
  }
  fn();
  if (!id) return;
  const next = document.getElementById(id);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (caret !== null && next.setSelectionRange) {
    try { next.setSelectionRange(caret, caret); } catch (e) { /* not a text input */ }
  }
}

/* ---------- validation of individual inputs ---------- */

function readNumber(input) {
  const raw = input.value;
  const errorEl = document.getElementById(`${input.id}-error`);
  const setError = (message) => {
    if (errorEl) errorEl.textContent = message;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (errorEl) input.setAttribute('aria-describedby', errorEl.id);
  };

  if (raw === '') {
    setError('');
    return { ok: false, empty: true, value: 0 };
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    setError('Enter a number of 0 or more.');
    return { ok: false, empty: false, value: 0 };
  }
  const max = input.dataset.max ? Number(input.dataset.max) : null;
  if (max !== null && value > max) {
    setError('Percentages can’t be above 100%.');
    return { ok: false, empty: false, value };
  }
  setError('');
  return { ok: true, empty: false, value };
}

/* ---------- events ---------- */

function onClick(event) {
  const tipBtn = event.target.closest('[data-tip]');
  if (tipBtn) {
    toggleTip(tipBtn.dataset.tip);
    withFocusPreserved(render);
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button) return;

  switch (button.dataset.action) {
    case 'next':
      goNext();
      break;
    case 'back':
      if (state.step > 0) {
        state.step -= 1;
        state.error = '';
        render();
      }
      break;
    case 'not-sure':
      applyNotSure(state.answers, QUESTIONS[state.step].id);
      state.error = '';
      rebuildModel();
      goNext(true);
      break;
    case 'edit-answers':
      state.view = 'survey';
      state.step = 0;
      state.error = '';
      render();
      break;
    case 'reset':
      state.answers = demoAnswers();
      state.step = 0;
      state.view = 'survey';
      state.error = '';
      state.status = 'Example answers restored.';
      rebuildModel();
      render();
      break;
    case 'clear':
      state.answers = blankAnswers();
      state.step = 0;
      state.view = 'survey';
      state.error = '';
      state.status = 'Example data cleared.';
      rebuildModel();
      render();
      break;
    case 'save':
      save();
      break;
    case 'print':
      window.print();
      break;
    case 'csv':
      exportCsv();
      break;
    default:
      break;
  }
}

function goNext(skipValidation = false) {
  const q = QUESTIONS[state.step];
  if (!skipValidation) {
    const error = validateQuestion(q.id, state.answers);
    if (error) {
      state.error = error;
      render();
      const errorEl = document.getElementById('survey-error');
      if (errorEl) errorEl.scrollIntoView({ block: 'nearest' });
      return;
    }
  }
  state.error = '';
  if (state.step < QUESTIONS.length - 1) {
    state.step += 1;
    render();
  } else {
    rebuildModel();
    state.view = 'results';
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function onKeydown(event) {
  if (event.key === 'Escape' && state.openTips.length) {
    state.openTips = [];
    withFocusPreserved(render);
  }
}

/** Survey answer changes. */
function onSurveyInput(event) {
  const input = event.target;
  const a = state.answers;
  const key = input.dataset.answer;

  if (input.dataset.rolesetting) {
    const role = input.dataset.role;
    if (!a.roleSettings[role]) a.roleSettings[role] = {};
    a.roleSettings[role][input.dataset.rolesetting] = input.value;
    readNumber(input);
    return;
  }
  if (!key) return;

  switch (key) {
    case 'insurers': {
      const value = input.value;
      if (input.checked) {
        if (!a.insurers.includes(value)) a.insurers.push(value);
      } else {
        a.insurers = a.insurers.filter((k) => k !== value);
        delete a.appointments[value];
        delete a.daysToPay[value];
      }
      withFocusPreserved(render);
      return;
    }
    case 'appointments':
      a.appointments[input.dataset.insurer] = input.value;
      readNumber(input);
      return;
    case 'fee':
      a.fee = input.value;
      readNumber(input);
      return;
    case 'billingRoles': {
      const value = input.value;
      if (input.checked) {
        if (!a.billingRoles.includes(value)) a.billingRoles.push(value);
      } else {
        a.billingRoles = a.billingRoles.filter((k) => k !== value);
        if (a.exceptionRole === value) a.exceptionRole = '';
      }
      if (a.billingRoles.length === 1) a.exceptionRole = a.billingRoles[0];
      withFocusPreserved(render);
      return;
    }
    case 'exceptionRole':
      a.exceptionRole = input.value;
      withFocusPreserved(render);
      return;
    case 'frontRole':
      a.frontRole = input.value;
      withFocusPreserved(render);
      return;
    case 'daysToPay':
      a.daysToPay[input.dataset.insurer] = input.value;
      withFocusPreserved(render);
      return;
    case 'rejections':
      a.rejections = input.value;
      withFocusPreserved(render);
      return;
    case 'agedDebt':
      a.agedDebt = input.value;
      a.agedDebtNotSure = false;
      readNumber(input);
      return;
    case 'writeOffs':
      a.writeOffs = input.value;
      withFocusPreserved(render);
      return;
    case 'effort': {
      a.effort = Number(input.value);
      const sense = document.getElementById('sense-check');
      const valueLabel = document.getElementById('effort-value');
      if (sense) {
        sense.innerHTML =
          `We estimate your team spends about <strong>${esc(num1.format(senseCheckHours()))} hours a week</strong> ` +
          `on insurance billing, chasing and reconciling.`;
      }
      if (valueLabel) valueLabel.textContent = `Currently set to ${a.effort}% of our estimate.`;
      return;
    }
    default:
      return;
  }
}

/** Results-page changes: released-time choices and the detailed panel. */
function onResultsInput(event) {
  const input = event.target;
  const model = state.model;

  if (input.dataset.choice) {
    const roleKey = input.dataset.choice;
    const existing = model.timeChoices[roleKey] || {};
    model.timeChoices[roleKey] = { mode: input.value, hoursCut: existing.hoursCut || '' };
    state.answers.timeChoices = model.timeChoices;
    withFocusPreserved(renderOutputOnly);
    return;
  }

  if (input.dataset.hourscut) {
    const roleKey = input.dataset.hourscut;
    const parsed = readNumber(input);
    if (!parsed.ok && !parsed.empty) return;
    const existing = model.timeChoices[roleKey] || { mode: 'reduce' };
    model.timeChoices[roleKey] = { ...existing, hoursCut: parsed.empty ? '' : parsed.value };
    state.answers.timeChoices = model.timeChoices;
    withFocusPreserved(renderOutputOnly);
    return;
  }

  if (input.dataset.roleIndex !== undefined && input.dataset.roleField) {
    const role = model.roles[Number(input.dataset.roleIndex)];
    const fieldName = input.dataset.roleField;
    if (fieldName === 'label') {
      role.label = input.value;
    } else if (fieldName === 'hourlyOverride') {
      const parsed = readNumber(input);
      if (!parsed.ok && !parsed.empty) return;
      role.hourlyOverride = parsed.empty ? null : parsed.value;
    } else {
      const parsed = readNumber(input);
      if (!parsed.ok) return;
      role[fieldName] = parsed.value;
    }
    const liveCost = document.getElementById(`d-role-hourly-${input.dataset.roleIndex}`);
    if (liveCost) liveCost.textContent = moneyPrecise(roleCost(role).hourlyCost);
    renderOutputOnly();
    return;
  }

  if (input.dataset.insurerIndex !== undefined && input.dataset.insurerField) {
    const parsed = readNumber(input);
    if (!parsed.ok) return;
    model.insurers[Number(input.dataset.insurerIndex)][input.dataset.insurerField] = parsed.value;
    renderOutputOnly();
    return;
  }

  if (input.dataset.activityIndex !== undefined && input.dataset.activityField) {
    const activity = model.activities[Number(input.dataset.activityIndex)];
    const fieldName = input.dataset.activityField;
    if (fieldName === 'role') {
      activity.role = input.value;
    } else {
      const parsed = readNumber(input);
      if (!parsed.ok) return;
      activity[fieldName] = parsed.value;
    }
    renderOutputOnly();
  }
}

/* ---------- storage ---------- */

function setStatus(message) {
  state.status = message;
  for (const el of document.querySelectorAll('.status')) el.textContent = message;
}

function save() {
  try {
    const payload = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      answers: state.answers,
      model: state.model,
      view: state.view,
      step: state.step
    });
    window.localStorage.setItem(STORAGE_KEY, payload);
    setStatus('Saved in this browser.');
  } catch (error) {
    setStatus('Saving isn’t available in this browser');
  }
}

function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !parsed.answers) return false;
    state.answers = parsed.answers;
    state.model = parsed.model || buildModel(parsed.answers);
    state.view = parsed.view === 'results' ? 'results' : 'survey';
    state.step = Number.isInteger(parsed.step) ? Math.min(parsed.step, QUESTIONS.length - 1) : 0;
    return true;
  } catch (error) {
    return false;
  }
}

/* ---------- CSV ---------- */

function csvCell(value) {
  const text = String(value === null || value === undefined ? '' : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  const model = state.model;
  const r = compute(model);
  const rows = [
    ['Section', 'Item', 'Detail', 'Value'],
    ['Answers', 'Insurers', '', (state.answers.insurers || []).map(insurerLabel).join('; ')],
    ['Answers', 'Average fee per session', '', model.fee]
  ];

  for (const insurer of model.insurers) {
    rows.push(['Answers', 'Appointments a month', insurer.label, insurer.appointments]);
    rows.push(['Answers', 'Days to pay', insurer.label, insurer.daysToPay]);
  }
  rows.push(['Answers', 'Rejection rate %', '', model.insurers.length ? model.insurers[0].rejectionPct : '']);
  rows.push(['Answers', 'Sense-check multiplier %', '', Math.round(model.effort * 100)]);

  for (const role of model.roles) {
    const cost = roleCost(role);
    rows.push(['Roles', role.label, 'Salary a year', cost.salary]);
    rows.push(['Roles', role.label, 'Hours a week', cost.weeklyHours]);
    rows.push(['Roles', role.label, 'True hourly cost', round4(cost.hourlyCost)]);
    rows.push(['Roles', role.label, 'Employment cost a year', round4(cost.employmentCost)]);
  }

  rows.push(['Current process', 'Admin cost a month', '', round4(r.current.totals.cost)]);
  rows.push(['Current process', 'Staff hours a month', '', round4(r.current.totals.minutes / 60)]);
  rows.push(['Current process', 'Billing and payments hours a month', '', round4(r.current.byGroup.B.minutes / 60)]);
  rows.push(['Current process', 'Front-end and clinical hours a month', '', round4(r.current.byGroup.F.minutes / 60)]);
  rows.push(['Current process', 'Cost per claim', '', round4(r.ratios.costPerClaim)]);
  rows.push(['Current process', 'Cost per appointment', '', round4(r.ratios.costPerAppointment)]);
  rows.push(['Current process', '% of insured revenue', '', round4(r.ratios.pctOfRevenue * 100)]);
  rows.push(['Current process', 'Rework rate %', '', round4(r.ratios.reworkRate * 100)]);
  rows.push(['Current process', 'Average days to pay', '', round4(r.current.avgDaysToPay)]);
  rows.push(['Current process', 'Aged debt balance', '', round4(r.current.agedDebt)]);

  for (const activity of r.current.activities) {
    rows.push(['Current activities', activity.label, 'Minutes a month', round4(activity.minutes)]);
    rows.push(['Current activities', activity.label, 'Cost a month', round4(activity.cost)]);
  }

  rows.push(['With Effra', 'Admin cost a month', '', round4(r.effra.totals.cost)]);
  rows.push(['With Effra', 'Staff hours a month', '', round4(r.effra.totals.minutes / 60)]);
  rows.push(['With Effra', 'Average days to pay', '', round4(r.effra.avgDaysToPay)]);
  rows.push(['With Effra', 'Rework rate %', '', round4(r.ratios.effraReworkRate * 100)]);
  rows.push(['With Effra', 'Cash released by faster payment (one-off)', '', round4(r.headline.cashReleased)]);
  rows.push(['With Effra', 'Write-offs recovered a year', '', round4(r.headline.writeOffsRecovered)]);
  rows.push(['With Effra', 'Aged debt reduced (one-off)', '', round4(r.headline.agedDebtReduced)]);
  rows.push(['With Effra', 'Admin hours released a year', '', round4(r.headline.releasedHoursTotal)]);
  rows.push(['With Effra', 'Value of released time a year', '', round4(r.headline.capacityValue)]);
  rows.push(['With Effra', 'Cash saving credited a year', '', round4(r.cash.credited)]);
  rows.push(['With Effra', 'Excess from the staffing change', '', round4(r.cash.excess)]);

  const csv = '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pmi-admin-cost-calculator.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatus('CSV downloaded.');
  } catch (error) {
    setStatus('Downloading isn’t available in this browser');
  }
}

/* ---------- iframe height ---------- */

let lastHeight = 0;
function reportHeight() {
  if (window.parent === window) return;
  // Measure the body box, not documentElement.scrollHeight: the latter is
  // bounded below by the iframe's own height, so once the host grows the frame
  // the reported height can only ever ratchet upwards and never shrink back.
  const box = document.body.getBoundingClientRect();
  const styles = window.getComputedStyle(document.body);
  const margins = (parseFloat(styles.marginTop) || 0) + (parseFloat(styles.marginBottom) || 0);
  const height = Math.ceil(box.height + margins);
  if (height === lastHeight) return;
  lastHeight = height;
  try {
    window.parent.postMessage({ type: 'pmi-calc-height', height }, '*');
  } catch (error) {
    /* embedding is optional */
  }
}

/* ---------- boot ---------- */

export function init() {
  if (!load()) rebuildModel();
  if (!state.model) rebuildModel();

  const app = document.querySelector('.app');
  app.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
  app.addEventListener('input', (event) => {
    if (state.view === 'survey') onSurveyInput(event);
    else onResultsInput(event);
  });
  app.addEventListener('change', (event) => {
    if (event.target.tagName === 'SELECT' && state.view === 'results') onResultsInput(event);
  });
  document.getElementById('details-host').addEventListener('toggle', (event) => {
    if (event.target.id === 'details-panel') state.detailsOpen = event.target.open;
  }, true);

  render();

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(reportHeight).observe(document.body);
  }
  window.addEventListener('load', reportHeight);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

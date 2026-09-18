/* survey.js — question definitions, demo/blank answers and validation. No DOM. */

import { INSURERS, ROLE_DEFAULTS, DEFAULT_BILLING_ROLE_KEY } from './defaults.js';
import { toNumber, assignRoleSlots } from './calc.js';

export const QUESTIONS = [
  { id: 'insurers', title: 'Which insurers do you work with?', helper: 'Choose all that apply.', notSure: false },
  { id: 'appointments', title: 'Roughly how many insured appointments a month?', helper: 'A rough monthly figure for each insurer is fine.', notSure: false },
  { id: 'fee', title: 'What’s your average fee per insured session?', helper: 'Include both the insurer and patient portions.', notSure: true },
  { id: 'billingRoles', title: 'Who handles insurance billing and chasing?', helper: 'Choose everyone involved. Typical salary and hours are filled in; change them if they’re off.', notSure: true },
  { id: 'frontRole', title: 'Who handles authorisations and new-patient admin?', helper: 'Policy details, authorisation checks and session tracking.', notSure: true },
  { id: 'daysToPay', title: 'How long do insurers usually take to pay you?', helper: 'From the appointment to the money reaching your bank.', notSure: false },
  { id: 'rejections', title: 'How often are claims rejected or sent back?', helper: 'Across all your insurers.', notSure: true },
  { id: 'agedDebt', title: 'How much do insurers owe you that’s over 30 days late?', helper: 'A rough total across all insurers.', notSure: true },
  { id: 'writeOffs', title: 'Roughly how much insured income do you write off a year?', helper: 'Money you’ve given up collecting from insurers or patients.', notSure: true },
  { id: 'effort', title: 'Does this sound right?', helper: 'Drag the slider if our estimate looks too high or too low.', notSure: false }
];

export const DEFAULT_FEE = 70;

export function demoAnswers() {
  return {
    insurers: ['bupa', 'axa', 'vitality'],
    appointments: { bupa: 60, axa: 40, vitality: 25 },
    fee: 70,
    billingRoles: ['rec', 'pm'],
    exceptionRole: 'pm',
    frontRole: 'rec',
    roleSettings: {},
    daysToPay: { bupa: '1to2m', axa: '1to2m', vitality: '2to4w' },
    rejections: 'sometimes',
    agedDebt: '',
    agedDebtNotSure: true,
    writeOffs: '1kto5k',
    effort: 100,
    timeChoices: {}
  };
}

export function blankAnswers() {
  return {
    insurers: [],
    appointments: {},
    fee: '',
    billingRoles: [],
    exceptionRole: '',
    frontRole: '',
    roleSettings: {},
    daysToPay: {},
    rejections: '',
    agedDebt: '',
    agedDebtNotSure: false,
    writeOffs: '',
    effort: 100,
    timeChoices: {}
  };
}

/** Apply a question's "Not sure" answer in place. */
export function applyNotSure(answers, questionId) {
  switch (questionId) {
    case 'fee':
      answers.fee = DEFAULT_FEE;
      break;
    case 'billingRoles':
      answers.billingRoles = [DEFAULT_BILLING_ROLE_KEY];
      answers.exceptionRole = DEFAULT_BILLING_ROLE_KEY;
      break;
    case 'frontRole':
      answers.frontRole = assignRoleSlots(answers).routine;
      break;
    case 'rejections':
      answers.rejections = 'notsure';
      break;
    case 'agedDebt':
      answers.agedDebt = '';
      answers.agedDebtNotSure = true;
      break;
    case 'writeOffs':
      answers.writeOffs = 'notsure';
      break;
    default:
      break;
  }
  return answers;
}

const NUMBER_ERROR = 'Enter a number of 0 or more.';

function isValidNumber(value) {
  if (value === '' || value === null || value === undefined) return false;
  const n = Number(String(value).replace(/[\s,£]/g, ''));
  return Number.isFinite(n) && n >= 0;
}

/** Validate one question. Returns null when valid, otherwise a message. */
export function validateQuestion(questionId, answers) {
  switch (questionId) {
    case 'insurers':
      return (answers.insurers || []).length ? null : 'Choose at least one insurer.';
    case 'appointments': {
      const selected = answers.insurers || [];
      for (const key of selected) {
        const raw = (answers.appointments || {})[key];
        if (raw !== '' && raw !== null && raw !== undefined && !isValidNumber(raw)) return NUMBER_ERROR;
      }
      const total = selected.reduce((sum, key) => sum + toNumber((answers.appointments || {})[key], 0), 0);
      return total > 0 ? null : 'Enter an appointment count above zero for at least one insurer.';
    }
    case 'fee':
      return isValidNumber(answers.fee) ? null : NUMBER_ERROR;
    case 'billingRoles': {
      if (!(answers.billingRoles || []).length) return 'Choose at least one person.';
      const salaryError = validateRoleSettings(answers, answers.billingRoles);
      if (salaryError) return salaryError;
      if (answers.billingRoles.length > 1 && !answers.billingRoles.includes(answers.exceptionRole)) {
        return 'Choose who does most of the chasing and fixing problems.';
      }
      return null;
    }
    case 'frontRole': {
      if (!answers.frontRole) return 'Choose one person.';
      return validateRoleSettings(answers, [answers.frontRole]);
    }
    case 'daysToPay': {
      for (const key of answers.insurers || []) {
        if (!(answers.daysToPay || {})[key]) return 'Choose an answer for every insurer.';
      }
      return null;
    }
    case 'rejections':
      return answers.rejections ? null : 'Choose an answer.';
    case 'agedDebt':
      if (answers.agedDebtNotSure) return null;
      return isValidNumber(answers.agedDebt) ? null : NUMBER_ERROR;
    case 'writeOffs':
      return answers.writeOffs ? null : 'Choose an answer.';
    case 'effort':
      return null;
    default:
      return null;
  }
}

function validateRoleSettings(answers, roleKeys) {
  const settings = answers.roleSettings || {};
  for (const key of roleKeys) {
    const custom = settings[key];
    if (!custom) continue;
    if (custom.salary !== undefined && custom.salary !== '' && !isValidNumber(custom.salary)) return NUMBER_ERROR;
    if (custom.weeklyHours !== undefined && custom.weeklyHours !== '' && !isValidNumber(custom.weeklyHours)) return NUMBER_ERROR;
    const base = ROLE_DEFAULTS.find((r) => r.key === key);
    const hours = custom.weeklyHours !== undefined && custom.weeklyHours !== ''
      ? toNumber(custom.weeklyHours, 0)
      : (base ? base.weeklyHours : 0);
    if (hours <= 0) return 'Enter weekly hours above zero.';
  }
  return null;
}

/** Ordered role list for Q5: roles already chosen in Q4 first. */
export function frontRoleOptions(answers) {
  const chosen = answers.billingRoles || [];
  const first = ROLE_DEFAULTS.filter((r) => chosen.includes(r.key));
  const rest = ROLE_DEFAULTS.filter((r) => !chosen.includes(r.key));
  return [...first, ...rest];
}

export { INSURERS, ROLE_DEFAULTS };

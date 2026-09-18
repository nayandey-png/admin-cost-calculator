/* defaults.js — role defaults, activity defaults, survey mappings, Effra benchmarks.
   Pure data plus a couple of tiny lookup helpers. No DOM. */

export const CONSTANTS = {
  niRate: 0.15,
  niThreshold: 5000,
  pensionRate: 0.03,
  pensionLower: 6240,
  pensionUpper: 50270,
  weeksPerYear: 52,
  leaveWeeks: 5.6,
  sicknessRate: 0.02,
  sessionsPerCourse: 5,
  monthsPerYear: 12,
  daysPerYear: 365
};

export const ROLE_DEFAULTS = [
  { key: 'rec', label: 'Receptionist', salary: 24500, weeklyHours: 37.5, hourlyOverride: null },
  { key: 'adm', label: 'Admin or finance assistant', salary: 27000, weeklyHours: 37.5, hourlyOverride: null },
  { key: 'pm', label: 'Practice manager', salary: 36000, weeklyHours: 37.5, hourlyOverride: null },
  { key: 'own', label: 'Clinic owner', salary: 0, weeklyHours: 40, hourlyOverride: 60 },
  { key: 'cli', label: 'Clinician', salary: 40000, weeklyHours: 37.5, hourlyOverride: null }
];

export const CLINICIAN_ROLE_KEY = 'cli';
export const DEFAULT_BILLING_ROLE_KEY = 'rec';

export function roleDefault(key) {
  return ROLE_DEFAULTS.find((r) => r.key === key) || null;
}

export const INSURERS = [
  { key: 'bupa', label: 'Bupa' },
  { key: 'axa', label: 'AXA Health' },
  { key: 'aviva', label: 'Aviva' },
  { key: 'vitality', label: 'Vitality' },
  { key: 'wpa', label: 'WPA' },
  { key: 'other', label: 'Other' }
];

export function insurerLabel(key) {
  const found = INSURERS.find((i) => i.key === key);
  return found ? found.label : key;
}

/* ---------- Survey answer mappings (section 3.1) ---------- */

export const DAYS_TO_PAY_OPTIONS = [
  { key: 'under2w', label: 'Under 2 weeks', days: 10 },
  { key: '2to4w', label: '2–4 weeks', days: 21 },
  { key: '1to2m', label: '1–2 months', days: 45 },
  { key: 'over2m', label: 'Over 2 months', days: 75 },
  { key: 'notsure', label: 'Not sure', days: 30 }
];

export const REJECTION_OPTIONS = [
  { key: 'rarely', label: 'Rarely', pct: 2 },
  { key: 'sometimes', label: 'Sometimes', pct: 5 },
  { key: 'often', label: 'Often', pct: 10 },
  { key: 'veryoften', label: 'Very often', pct: 20 },
  { key: 'notsure', label: 'Not sure', pct: 5 }
];

export const WRITE_OFF_OPTIONS = [
  { key: 'none', label: 'None', annual: 0 },
  { key: 'under1k', label: 'Under £1k', annual: 500 },
  { key: '1kto5k', label: '£1k–£5k', annual: 3000 },
  { key: 'over5k', label: 'Over £5k', annual: 7500 },
  { key: 'notsure', label: 'Not sure', annual: 1000 }
];

export function daysToPayFor(key) {
  const o = DAYS_TO_PAY_OPTIONS.find((x) => x.key === key);
  return o ? o.days : 30;
}

export function rejectionPctFor(key) {
  const o = REJECTION_OPTIONS.find((x) => x.key === key);
  return o ? o.pct : 5;
}

export function writeOffsAnnualFor(key) {
  const o = WRITE_OFF_OPTIONS.find((x) => x.key === key);
  return o ? o.annual : 1000;
}

/* ---------- Activity defaults (section 3.3) ----------
   group:    'B' billing and payments | 'F' front-end and clinical
   roleSlot: 'front' | 'routine' | 'exception' | 'clinician'
   kind:     'R' routine | 'E' exception
   type:     'rate' | 'batch'
   basis:    'courses' | 'appointments' | 'invoices' | 'rejected'            */

export const ACTIVITY_DEFAULTS = [
  { id: 'details', label: 'Collecting patient and policy details', group: 'F', roleSlot: 'front', kind: 'R', type: 'rate', basis: 'courses', incidence: 100, followUps: 1, minutes: 8 },
  { id: 'auth', label: 'Checking authorisation', group: 'F', roleSlot: 'front', kind: 'R', type: 'rate', basis: 'courses', incidence: 100, followUps: 1, minutes: 10 },
  { id: 'recognition', label: 'Checking clinician and clinic recognition', group: 'F', roleSlot: 'front', kind: 'R', type: 'rate', basis: 'courses', incidence: 20, followUps: 1, minutes: 5 },
  { id: 'sessions', label: 'Monitoring authorised sessions', group: 'F', roleSlot: 'front', kind: 'R', type: 'rate', basis: 'appointments', incidence: 100, followUps: 1, minutes: 1 },
  { id: 'reports', label: 'Preparing clinical reports', group: 'F', roleSlot: 'clinician', kind: 'R', type: 'rate', basis: 'courses', incidence: 60, followUps: 1, minutes: 20 },
  { id: 'reauth', label: 'Requesting further authorisation', group: 'F', roleSlot: 'front', kind: 'R', type: 'rate', basis: 'courses', incidence: 40, followUps: 1, minutes: 10 },

  { id: 'prepinv', label: 'Preparing invoices', group: 'B', roleSlot: 'routine', kind: 'R', type: 'rate', basis: 'invoices', incidence: 100, followUps: 1, minutes: 0.3 },
  { id: 'submit', label: 'Submitting claims', group: 'B', roleSlot: 'routine', kind: 'R', type: 'rate', basis: 'invoices', incidence: 100, followUps: 1, minutes: 0.25 },
  { id: 'received', label: 'Checking whether claims were received', group: 'B', roleSlot: 'routine', kind: 'R', type: 'rate', basis: 'invoices', incidence: 5, followUps: 1, minutes: 1 },
  { id: 'correct', label: 'Correcting rejected claims', group: 'B', roleSlot: 'exception', kind: 'E', type: 'rate', basis: 'rejected', incidence: 100, followUps: 1, minutes: 8 },
  { id: 'resubmit', label: 'Resubmitting claims', group: 'B', roleSlot: 'exception', kind: 'E', type: 'rate', basis: 'rejected', incidence: 100, followUps: 1, minutes: 3 },
  { id: 'shortfalls', label: 'Investigating shortfalls', group: 'B', roleSlot: 'exception', kind: 'E', type: 'rate', basis: 'invoices', incidence: 4, followUps: 1, minutes: 5 },
  { id: 'disputes', label: 'Raising insurer disputes', group: 'B', roleSlot: 'exception', kind: 'E', type: 'rate', basis: 'rejected', incidence: 20, followUps: 1, minutes: 10 },
  { id: 'remittances', label: 'Obtaining and reading remittances', group: 'B', roleSlot: 'routine', kind: 'R', type: 'batch', batches: 4, minutes: 15 },
  { id: 'posting', label: 'Posting insurer payments', group: 'B', roleSlot: 'routine', kind: 'R', type: 'rate', basis: 'invoices', incidence: 100, followUps: 1, minutes: 0.5 },
  { id: 'ageddebt', label: 'Chasing aged insurer debt', group: 'B', roleSlot: 'exception', kind: 'E', type: 'rate', basis: 'invoices', incidence: 10, followUps: 1, minutes: 5 },
  { id: 'excesses', label: 'Identifying patient excesses', group: 'B', roleSlot: 'routine', kind: 'R', type: 'rate', basis: 'courses', incidence: 100, followUps: 1, minutes: 1 },
  { id: 'patinv', label: 'Sending patient invoices', group: 'B', roleSlot: 'routine', kind: 'R', type: 'rate', basis: 'courses', incidence: 100, followUps: 1, minutes: 1 },
  { id: 'patchase', label: 'Chasing patient balances', group: 'B', roleSlot: 'exception', kind: 'E', type: 'rate', basis: 'courses', incidence: 50, followUps: 2, minutes: 4 },
  { id: 'reconcile', label: 'Reconciling payments to the bank', group: 'B', roleSlot: 'routine', kind: 'R', type: 'batch', batches: 4, minutes: 15 }
];

export const GROUP_LABELS = {
  B: 'Billing and payments',
  F: 'Front-end and clinical admin'
};

export const BASIS_LABELS = {
  courses: 'Courses',
  appointments: 'Appointments',
  invoices: 'Invoices',
  rejected: 'Rejected claims'
};

/* ---------- Effra benchmarks (section 6) — fixed, never user-editable ---------- */

export const EFFRA_FALLBACK = { rejectionPct: 0.3, rejectionLabel: '0.3%', daysToPay: 4 };

export const EFFRA_INSURER_BENCHMARKS = {
  bupa: { rejectionPct: 5, rejectionLabel: 'under 5%', daysToPay: 15 },
  axa: { rejectionPct: 0.1, rejectionLabel: 'under 0.1%', daysToPay: 19 },
  vitality: { rejectionPct: 0.3, rejectionLabel: '0.3%', daysToPay: 4 }
};

export const EFFRA_AGED_DEBT_FACTOR = 0.1;
export const EFFRA_WRITE_OFFS_MONTHLY = 0;
export const EFFRA_EXCEPTION_MINUTES = 5;
export const EFFRA_EXCEPTION_LABEL = 'Reviewing Effra exceptions';

export function effraBenchmark(insurerKey) {
  return EFFRA_INSURER_BENCHMARKS[insurerKey] || EFFRA_FALLBACK;
}

export const ASSUMPTIONS_TEXT =
  "The Effra scenario uses average outcomes across 1000+ practitioners using Effra: rejection rates, payment times, write-offs and aged debt by insurer. Aviva, WPA and other insurers use Effra's Vitality results, as there's no insurer-specific data yet. Billing and payment tasks are automated, with about 5 minutes a month left for reviewing exceptions. Front-end and clinical admin is unchanged. Assumes around 5 sessions per insured course of treatment, based on Effra clinics. Hourly cost = (salary + employer NI + pension) ÷ productive hours; leave is 5.6 weeks pro rata including bank holidays and sickness is 2% of contracted hours. Released time isn't a cash saving unless paid hours are reduced; credited cash is capped at the value of released time.";

export const TOOLTIPS = {
  courses: 'One patient’s treatment under one insurer authorisation. For example, six authorised knee physio sessions count as one course.',
  hourlyOverride: 'Use this for owners paid by dividend, or to value a clinician’s time at what they’d earn treating patients.',
  rejectedPct: 'The share of claims an insurer rejects or sends back for correction before paying.',
  daysToPay: 'The average number of days between an appointment and the insurer’s payment reaching your bank.',
  writeOffs: 'Insured income you’ve given up collecting, from either the insurer or the patient.',
  agedDebt: 'Money insurers currently owe you that’s more than 30 days overdue.',
  incidence: 'How often this task is needed. For example, 20% means one in five claims or patients needs it.',
  followUps: 'How many times the task is usually repeated, such as chasing a debt twice.',
  timeReleased: 'Staff time freed up. It only becomes a cash saving if you reduce paid hours or remove a role.'
};

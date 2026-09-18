/* calc.js — pure calculation engine. No DOM, no globals, no stored derived data.
   buildModel(answers) -> model      compute(model) -> results                  */

import {
  CONSTANTS,
  ROLE_DEFAULTS,
  roleDefault,
  CLINICIAN_ROLE_KEY,
  DEFAULT_BILLING_ROLE_KEY,
  INSURERS,
  insurerLabel,
  ACTIVITY_DEFAULTS,
  daysToPayFor,
  rejectionPctFor,
  writeOffsAnnualFor,
  effraBenchmark,
  EFFRA_AGED_DEBT_FACTOR,
  EFFRA_WRITE_OFFS_MONTHLY,
  EFFRA_EXCEPTION_MINUTES,
  EFFRA_EXCEPTION_LABEL
} from './defaults.js';

/* ---------- small numeric helpers ---------- */

export function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[\s,£]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[\s,£]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function unique(list) {
  const out = [];
  for (const item of list) if (item && !out.includes(item)) out.push(item);
  return out;
}

/**
 * Round a pair so that the displayed figures always add up: the difference is
 * computed at full precision first, then the second figure is derived from the
 * rounded first figure minus the rounded difference.
 */
export function roundedDelta(current, effra, decimals = 0) {
  const f = Math.pow(10, decimals);
  const currentUnits = Math.round(current * f);
  const differenceUnits = Math.round((current - effra) * f);
  const effraUnits = currentUnits - differenceUnits;
  return {
    current: currentUnits / f,
    effra: effraUnits / f,
    difference: differenceUnits / f
  };
}

/* ---------- staff cost model (section 4) ---------- */

export function roleCost(role, constants = CONSTANTS) {
  const salary = Math.max(0, toNumber(role.salary, 0));
  const weeklyHours = toNumber(role.weeklyHours, 0);
  const override = optionalNumber(role.hourlyOverride);

  const employerNI = constants.niRate * Math.max(0, salary - constants.niThreshold);
  const pension =
    constants.pensionRate *
    Math.max(0, Math.min(salary, constants.pensionUpper) - constants.pensionLower);

  const contractedHours = weeklyHours * constants.weeksPerYear;
  const leaveHours = constants.leaveWeeks * weeklyHours;
  const sickHours = constants.sicknessRate * contractedHours;
  const productiveHours = contractedHours - leaveHours - sickHours;
  const valid = productiveHours > 0;

  let employmentCost = salary + employerNI + pension;
  let hourlyCost;
  if (override !== null && override >= 0) {
    hourlyCost = override;
    // Value the role's whole year at the notional rate, for the cash-saving maths.
    employmentCost = override * productiveHours;
  } else {
    hourlyCost = valid ? employmentCost / productiveHours : 0;
  }

  return {
    key: role.key,
    label: role.label,
    salary,
    weeklyHours,
    hourlyOverride: override,
    employerNI,
    pension,
    employmentCost,
    contractedHours,
    leaveHours,
    sickHours,
    productiveHours,
    hourlyCost,
    costPerMinute: hourlyCost / 60,
    valid
  };
}

/* ---------- role slot assignment (section 3.2) ---------- */

export function assignRoleSlots(answers) {
  const billing = unique(answers.billingRoles && answers.billingRoles.length
    ? answers.billingRoles
    : [DEFAULT_BILLING_ROLE_KEY]);

  let exception;
  if (billing.length === 1) {
    exception = billing[0];
  } else if (answers.exceptionRole && billing.includes(answers.exceptionRole)) {
    exception = answers.exceptionRole;
  } else {
    exception = billing[0];
  }

  const routine = billing.find((key) => key !== exception) || exception;
  const front = answers.frontRole && roleDefault(answers.frontRole) ? answers.frontRole : routine;

  return { routine, exception, front, clinician: CLINICIAN_ROLE_KEY };
}

/* ---------- answers -> model (section 3) ---------- */

export function buildModel(answers) {
  const fee = Math.max(0, toNumber(answers.fee, 70));
  const effort = toNumber(answers.effort, 100) / 100;
  const slots = assignRoleSlots(answers);

  // One role object per role type, so picking a Q4 role at Q5 never duplicates it.
  const roleKeys = unique([...(answers.billingRoles || []), slots.front, slots.clinician]);
  if (!roleKeys.length) roleKeys.push(DEFAULT_BILLING_ROLE_KEY, CLINICIAN_ROLE_KEY);

  const settings = answers.roleSettings || {};
  const roles = roleKeys.map((key) => {
    const base = roleDefault(key) || { key, label: key, salary: 0, weeklyHours: 37.5, hourlyOverride: null };
    const custom = settings[key] || {};
    return {
      key,
      label: custom.label !== undefined && custom.label !== '' ? custom.label : base.label,
      salary: custom.salary !== undefined && custom.salary !== '' ? toNumber(custom.salary, base.salary) : base.salary,
      weeklyHours:
        custom.weeklyHours !== undefined && custom.weeklyHours !== ''
          ? toNumber(custom.weeklyHours, base.weeklyHours)
          : base.weeklyHours,
      hourlyOverride:
        custom.hourlyOverride !== undefined ? optionalNumber(custom.hourlyOverride) : base.hourlyOverride
    };
  });

  const selected = (answers.insurers || []).filter((key) => INSURERS.some((i) => i.key === key));
  const appointmentsByKey = answers.appointments || {};
  const rejectionPct = rejectionPctFor(answers.rejections);
  const writeOffsAnnual = writeOffsAnnualFor(answers.writeOffs);
  const agedDebtKnown = answers.agedDebtNotSure !== true && answers.agedDebt !== '' && answers.agedDebt !== null && answers.agedDebt !== undefined;
  const agedDebtTotal = Math.max(0, toNumber(answers.agedDebt, 0));

  const draft = selected.map((key) => {
    const appointments = Math.max(0, toNumber(appointmentsByKey[key], 0));
    return {
      key,
      label: insurerLabel(key),
      appointments,
      invoices: appointments,
      courses: appointments / CONSTANTS.sessionsPerCourse,
      revenue: appointments * fee,
      rejectionPct,
      daysToPay: daysToPayFor((answers.daysToPay || {})[key])
    };
  });

  const totalRevenue = draft.reduce((sum, i) => sum + i.revenue, 0);

  const insurers = draft.map((insurer) => {
    const share = totalRevenue > 0 ? insurer.revenue / totalRevenue : 0;
    const agedDebt = agedDebtKnown
      ? agedDebtTotal * share
      : (insurer.revenue * Math.max(0, insurer.daysToPay - 30)) / 30;
    return {
      ...insurer,
      writeOffsMonthly: (writeOffsAnnual / CONSTANTS.monthsPerYear) * share,
      agedDebt
    };
  });

  // Billing-group minutes carry the sense-check multiplier; front-end minutes don't.
  const activities = ACTIVITY_DEFAULTS.map((activity) => {
    const scale = activity.group === 'B' ? effort : 1;
    return {
      id: activity.id,
      label: activity.label,
      group: activity.group,
      kind: activity.kind,
      type: activity.type,
      basis: activity.basis || null,
      incidence: activity.incidence !== undefined ? activity.incidence : null,
      followUps: activity.followUps !== undefined ? activity.followUps : null,
      batches: activity.batches !== undefined ? activity.batches : null,
      minutes: activity.minutes * scale,
      role: slots[activity.roleSlot] || null
    };
  });

  return {
    schemaVersion: 1,
    fee,
    effort,
    slots,
    roles,
    insurers,
    activities,
    timeChoices: answers.timeChoices || {}
  };
}

/* ---------- activity costing (section 5) ---------- */

function baseVolume(insurer, basis) {
  switch (basis) {
    case 'courses':
      return insurer.courses;
    case 'appointments':
      return insurer.appointments;
    case 'invoices':
      return insurer.invoices;
    case 'rejected':
      return (insurer.invoices * insurer.rejectionPct) / 100;
    default:
      return 0;
  }
}

function emptyBucket() {
  return { minutes: 0, cost: 0 };
}

function addTo(map, key, minutes, cost) {
  if (!map[key]) map[key] = emptyBucket();
  map[key].minutes += minutes;
  map[key].cost += cost;
}

/**
 * Run one scenario. `activities` may contain rate rows, batch rows and fixed
 * rows (a flat monthly total, used for the Effra exception review).
 */
function runScenario(roles, insurers, activities) {
  const costs = {};
  for (const role of roles) costs[role.key] = roleCost(role);

  const totalInvoices = insurers.reduce((sum, i) => sum + i.invoices, 0);

  const byRole = {};
  const byInsurer = {};
  const byGroup = { B: emptyBucket(), F: emptyBucket() };
  for (const insurer of insurers) byInsurer[insurer.key] = emptyBucket();

  let excludedActivities = 0;
  const rows = [];
  let totalMinutes = 0;
  let totalCost = 0;

  for (const activity of activities) {
    const role = costs[activity.role];
    if (!activity.role || !role || !role.valid) {
      if (activity.role === null || activity.role === '' || !role) excludedActivities += 1;
      continue;
    }
    const perMinute = role.costPerMinute;
    const perInsurer = {};
    let minutes = 0;

    if (activity.type === 'rate') {
      for (const insurer of insurers) {
        const volume =
          baseVolume(insurer, activity.basis) *
          (activity.incidence / 100) *
          activity.followUps *
          activity.minutes;
        perInsurer[insurer.key] = volume;
        minutes += volume;
      }
    } else {
      // Batch and fixed rows happen once for the whole clinic, then get
      // allocated to insurers by invoice share for the per-insurer chart only.
      minutes = activity.type === 'batch' ? activity.batches * activity.minutes : activity.minutes;
      let allocated = 0;
      insurers.forEach((insurer, index) => {
        let share;
        if (index === insurers.length - 1) {
          share = minutes - allocated; // remainder, so the split is exact
        } else {
          share = totalInvoices > 0 ? (minutes * insurer.invoices) / totalInvoices : minutes / insurers.length;
          allocated += share;
        }
        perInsurer[insurer.key] = share;
      });
    }

    const cost = minutes * perMinute;
    totalMinutes += minutes;
    totalCost += cost;
    addTo(byRole, activity.role, minutes, cost);
    addTo(byGroup, activity.group, minutes, cost);
    for (const insurer of insurers) {
      addTo(byInsurer, insurer.key, perInsurer[insurer.key], perInsurer[insurer.key] * perMinute);
    }

    rows.push({
      id: activity.id,
      label: activity.label,
      group: activity.group,
      role: activity.role,
      minutes,
      cost,
      byInsurer: perInsurer
    });
  }

  const revenue = insurers.reduce((sum, i) => sum + i.revenue, 0);
  const invoices = insurers.reduce((sum, i) => sum + i.invoices, 0);
  const appointments = insurers.reduce((sum, i) => sum + i.appointments, 0);
  const rejectedClaims = insurers.reduce((sum, i) => sum + (i.invoices * i.rejectionPct) / 100, 0);
  const weightedDays = insurers.reduce((sum, i) => sum + i.revenue * i.daysToPay, 0);

  return {
    roleCosts: costs,
    activities: rows,
    byRole,
    byInsurer,
    byGroup,
    excludedActivities,
    totals: { minutes: totalMinutes, cost: totalCost },
    revenue,
    invoices,
    appointments,
    rejectedClaims,
    avgDaysToPay: revenue > 0 ? weightedDays / revenue : 0,
    writeOffsMonthly: insurers.reduce((sum, i) => sum + i.writeOffsMonthly, 0),
    agedDebt: insurers.reduce((sum, i) => sum + i.agedDebt, 0)
  };
}

/* ---------- Effra scenario (section 6) ---------- */

export function effraInsurers(insurers) {
  return insurers.map((insurer) => {
    const benchmark = effraBenchmark(insurer.key);
    return {
      ...insurer,
      rejectionPct: benchmark.rejectionPct,
      rejectionLabel: benchmark.rejectionLabel,
      daysToPay: benchmark.daysToPay,
      writeOffsMonthly: EFFRA_WRITE_OFFS_MONTHLY,
      agedDebt: insurer.agedDebt * EFFRA_AGED_DEBT_FACTOR
    };
  });
}

export function effraActivities(activities, exceptionRole) {
  const front = activities
    .filter((a) => a.group === 'F')
    .map((a) => ({ ...a }));
  front.push({
    id: 'effra-exceptions',
    label: EFFRA_EXCEPTION_LABEL,
    group: 'B',
    kind: 'E',
    type: 'fixed',
    basis: null,
    incidence: null,
    followUps: null,
    batches: null,
    minutes: EFFRA_EXCEPTION_MINUTES,
    role: exceptionRole
  });
  return front;
}

/* ---------- released time -> cash (section 7.1) ---------- */

export function cashForChoice(choice, roleCostModel) {
  if (!choice || choice.mode === 'keep' || !roleCostModel) return 0;
  if (choice.mode === 'remove') return roleCostModel.employmentCost;
  if (choice.mode === 'reduce') {
    const hoursCut = Math.max(0, toNumber(choice.hoursCut, 0));
    if (roleCostModel.contractedHours <= 0) return 0;
    return (hoursCut * CONSTANTS.weeksPerYear * roleCostModel.employmentCost) / roleCostModel.contractedHours;
  }
  return 0;
}

/* ---------- compute (section 7) ---------- */

export function compute(model) {
  const F = CONSTANTS.monthsPerYear;
  const current = runScenario(model.roles, model.insurers, model.activities);
  const effra = runScenario(
    model.roles,
    effraInsurers(model.insurers),
    effraActivities(model.activities, model.slots.exception)
  );

  const capacityValue = (current.totals.cost - effra.totals.cost) * F;

  const releasedByRole = {};
  let releasedHoursTotal = 0;
  for (const role of model.roles) {
    const currentMinutes = current.byRole[role.key] ? current.byRole[role.key].minutes : 0;
    const effraMinutes = effra.byRole[role.key] ? effra.byRole[role.key].minutes : 0;
    const hours = ((currentMinutes - effraMinutes) / 60) * F;
    releasedByRole[role.key] = {
      currentMinutes,
      effraMinutes,
      hoursReleased: hours,
      valueReleased:
        ((current.byRole[role.key] ? current.byRole[role.key].cost : 0) -
          (effra.byRole[role.key] ? effra.byRole[role.key].cost : 0)) *
        F
    };
    releasedHoursTotal += hours;
  }

  const cashReleased =
    ((current.revenue * F) / CONSTANTS.daysPerYear) * (current.avgDaysToPay - effra.avgDaysToPay);

  // Released time turns into cash only where paid hours actually fall.
  let cashRequested = 0;
  const cashByRole = {};
  for (const role of model.roles) {
    const amount = cashForChoice(model.timeChoices[role.key], current.roleCosts[role.key]);
    cashByRole[role.key] = amount;
    cashRequested += amount;
  }
  const cashCredited = Math.min(cashRequested, Math.max(capacityValue, 0));
  const excess = cashRequested - cashCredited;

  const perInsurer = model.insurers.map((insurer, index) => {
    const benchmark = effraBenchmark(insurer.key);
    return {
      key: insurer.key,
      label: insurer.label,
      currentDays: insurer.daysToPay,
      effraDays: benchmark.daysToPay,
      currentRejectionPct: insurer.rejectionPct,
      effraRejectionLabel: benchmark.rejectionLabel,
      currentCost: current.byInsurer[insurer.key] ? current.byInsurer[insurer.key].cost : 0,
      effraCost: effra.byInsurer[insurer.key] ? effra.byInsurer[insurer.key].cost : 0,
      index
    };
  });

  return {
    current,
    effra,
    perInsurer,
    excludedActivities: current.excludedActivities,
    headline: {
      capacityValue,
      cashReleased,
      writeOffsRecovered: (current.writeOffsMonthly - effra.writeOffsMonthly) * F,
      agedDebtReduced: current.agedDebt - effra.agedDebt,
      releasedHoursTotal,
      daysSooner: current.avgDaysToPay - effra.avgDaysToPay,
      billingHoursReleasedMonthly: (current.byGroup.B.minutes - effra.byGroup.B.minutes) / 60
    },
    released: releasedByRole,
    cash: { byRole: cashByRole, requested: cashRequested, credited: cashCredited, excess },
    ratios: {
      costPerClaim: current.invoices > 0 ? current.totals.cost / current.invoices : 0,
      costPerAppointment: current.appointments > 0 ? current.totals.cost / current.appointments : 0,
      pctOfRevenue: current.revenue > 0 ? current.totals.cost / current.revenue : 0,
      reworkRate: current.invoices > 0 ? current.rejectedClaims / current.invoices : 0,
      effraReworkRate: effra.invoices > 0 ? effra.rejectedClaims / effra.invoices : 0
    }
  };
}

export { runScenario, ROLE_DEFAULTS, CONSTANTS };

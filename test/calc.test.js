import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildModel,
  compute,
  roleCost,
  assignRoleSlots,
  roundedDelta,
  cashForChoice,
  effraInsurers,
  runScenario,
  toNumber
} from '../src/calc.js';
import {
  CONSTANTS,
  daysToPayFor,
  rejectionPctFor,
  writeOffsAnnualFor,
  ACTIVITY_DEFAULTS,
  EFFRA_EXCEPTION_MINUTES
} from '../src/defaults.js';
import { demoAnswers, validateQuestion, blankAnswers, applyNotSure } from '../src/survey.js';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} !== ${expected} (±${tolerance})`);

/* 1. Hourly cost */

test('receptionist hourly cost is built from NI, pension and productive hours', () => {
  const r = roleCost({ key: 'rec', label: 'Receptionist', salary: 24500, weeklyHours: 37.5, hourlyOverride: null });
  close(r.employerNI, 2925);
  close(r.pension, 547.8, 1e-9);
  close(r.contractedHours, 1950);
  close(r.leaveHours, 210);
  close(r.sickHours, 39);
  close(r.productiveHours, 1701);
  close(r.employmentCost, 27972.8, 1e-9);
  close(r.hourlyCost, 27972.8 / 1701, 1e-9);
  assert.ok(Math.abs(r.hourlyCost - 16.44) < 0.01);
  close(r.costPerMinute, r.hourlyCost / 60, 1e-12);
});

test('an hourly override takes precedence and re-values the employment cost', () => {
  const owner = roleCost({ key: 'own', label: 'Clinic owner', salary: 0, weeklyHours: 40, hourlyOverride: 60 });
  close(owner.productiveHours, 40 * 52 - 5.6 * 40 - 0.02 * 40 * 52);
  close(owner.hourlyCost, 60);
  close(owner.employmentCost, 60 * owner.productiveHours, 1e-9);

  const overridden = roleCost({ key: 'rec', label: 'Receptionist', salary: 24500, weeklyHours: 37.5, hourlyOverride: 25 });
  close(overridden.hourlyCost, 25);
});

test('pension is capped at the qualifying earnings upper limit', () => {
  const high = roleCost({ key: 'x', label: 'High earner', salary: 80000, weeklyHours: 37.5, hourlyOverride: null });
  close(high.pension, 0.03 * (CONSTANTS.pensionUpper - CONSTANTS.pensionLower), 1e-9);
});

test('productive hours of zero or less marks the role invalid', () => {
  const broken = roleCost({ key: 'x', label: 'Broken', salary: 24500, weeklyHours: 0, hourlyOverride: null });
  assert.equal(broken.valid, false);
  close(broken.hourlyCost, 0);
});

/* 2. Leave is never also a cost */

test('leave changes pro rata with hours and never adds to employment cost', () => {
  const full = roleCost({ key: 'a', label: 'A', salary: 30000, weeklyHours: 37.5, hourlyOverride: null });
  const half = roleCost({ key: 'a', label: 'A', salary: 30000, weeklyHours: 18.75, hourlyOverride: null });

  close(full.leaveHours, 5.6 * 37.5);
  close(half.leaveHours, 5.6 * 18.75);
  close(half.leaveHours, full.leaveHours / 2);

  // Same salary, same employment cost: leave only moves the denominator.
  close(half.employmentCost, full.employmentCost, 1e-9);
  close(full.employmentCost, 30000 + 0.15 * 25000 + 0.03 * (30000 - 6240), 1e-9);
  close(half.hourlyCost, full.hourlyCost * 2, 1e-9);
});

/* 3. Survey mappings */

test('Q6, Q7 and Q9 map to the documented values with Not sure fallbacks', () => {
  assert.equal(daysToPayFor('under2w'), 10);
  assert.equal(daysToPayFor('2to4w'), 21);
  assert.equal(daysToPayFor('1to2m'), 45);
  assert.equal(daysToPayFor('over2m'), 75);
  assert.equal(daysToPayFor('notsure'), 30);
  assert.equal(daysToPayFor(undefined), 30);

  assert.equal(rejectionPctFor('rarely'), 2);
  assert.equal(rejectionPctFor('sometimes'), 5);
  assert.equal(rejectionPctFor('often'), 10);
  assert.equal(rejectionPctFor('veryoften'), 20);
  assert.equal(rejectionPctFor('notsure'), 5);
  assert.equal(rejectionPctFor(''), 5);

  assert.equal(writeOffsAnnualFor('none'), 0);
  assert.equal(writeOffsAnnualFor('under1k'), 500);
  assert.equal(writeOffsAnnualFor('1kto5k'), 3000);
  assert.equal(writeOffsAnnualFor('over5k'), 7500);
  assert.equal(writeOffsAnnualFor('notsure'), 1000);
  assert.equal(writeOffsAnnualFor(null), 1000);
});

/* 4. Aged debt estimate on "Not sure" */

test('aged debt on Not sure is revenue x max(0, days - 30) / 30 per insurer', () => {
  const model = buildModel(demoAnswers());
  for (const insurer of model.insurers) {
    close(insurer.agedDebt, (insurer.revenue * Math.max(0, insurer.daysToPay - 30)) / 30, 1e-9);
  }
  // Vitality is 21 days, so nothing is over 30 days late.
  close(model.insurers.find((i) => i.key === 'vitality').agedDebt, 0);
  close(model.insurers.find((i) => i.key === 'bupa').agedDebt, 60 * 70 * (45 - 30) / 30, 1e-9);
});

test('a stated aged debt total is split by revenue share', () => {
  const answers = { ...demoAnswers(), agedDebt: 10000, agedDebtNotSure: false };
  const model = buildModel(answers);
  const totalRevenue = model.insurers.reduce((s, i) => s + i.revenue, 0);
  close(model.insurers.reduce((s, i) => s + i.agedDebt, 0), 10000, 1e-9);
  for (const insurer of model.insurers) {
    close(insurer.agedDebt, 10000 * (insurer.revenue / totalRevenue), 1e-9);
  }
});

/* 5. Derived volumes */

test('courses, invoices and revenue derive from appointments and the fee', () => {
  const model = buildModel(demoAnswers());
  const bupa = model.insurers.find((i) => i.key === 'bupa');
  close(bupa.appointments, 60);
  close(bupa.invoices, 60);
  close(bupa.courses, 12);
  close(bupa.revenue, 4200);

  const axa = model.insurers.find((i) => i.key === 'axa');
  close(axa.courses, 8);
  close(axa.revenue, 2800);
});

/* 6. Q4 role assignment */

test('two billing roles split routine and exception work', () => {
  const answers = { ...demoAnswers(), billingRoles: ['rec', 'pm'], exceptionRole: 'pm' };
  const slots = assignRoleSlots(answers);
  assert.equal(slots.exception, 'pm');
  assert.equal(slots.routine, 'rec');

  const model = buildModel(answers);
  const routine = model.activities.filter((a) => a.group === 'B' && a.kind === 'R');
  const exception = model.activities.filter((a) => a.group === 'B' && a.kind === 'E');
  assert.ok(routine.length > 0 && exception.length > 0);
  assert.ok(routine.every((a) => a.role === 'rec'));
  assert.ok(exception.every((a) => a.role === 'pm'));
});

test('one billing role takes every billing task', () => {
  const answers = { ...demoAnswers(), billingRoles: ['adm'], exceptionRole: '', frontRole: 'adm' };
  const slots = assignRoleSlots(answers);
  assert.equal(slots.routine, 'adm');
  assert.equal(slots.exception, 'adm');

  const model = buildModel(answers);
  assert.ok(model.activities.filter((a) => a.group === 'B').every((a) => a.role === 'adm'));
});

/* 7. Q5 reuse creates no duplicate role */

test('picking a Q4 role at Q5 does not create a second role', () => {
  const model = buildModel({ ...demoAnswers(), frontRole: 'rec' });
  const keys = model.roles.map((r) => r.key);
  assert.deepEqual(keys, ['rec', 'pm', 'cli']);
  assert.equal(new Set(keys).size, keys.length);

  const withNewRole = buildModel({ ...demoAnswers(), frontRole: 'adm' });
  assert.deepEqual(withNewRole.roles.map((r) => r.key), ['rec', 'pm', 'adm', 'cli']);
});

/* 8. Slider */

test('the sense-check slider scales billing minutes only', () => {
  const base = buildModel({ ...demoAnswers(), effort: 100 });
  const high = buildModel({ ...demoAnswers(), effort: 150 });

  for (const activity of base.activities) {
    const other = high.activities.find((a) => a.id === activity.id);
    if (activity.group === 'B') close(other.minutes, activity.minutes * 1.5, 1e-9);
    else close(other.minutes, activity.minutes, 1e-12);
  }

  const baseResults = compute(base);
  const highResults = compute(high);
  close(highResults.current.byGroup.B.minutes, baseResults.current.byGroup.B.minutes * 1.5, 1e-9);
  close(highResults.current.byGroup.F.minutes, baseResults.current.byGroup.F.minutes, 1e-9);
});

/* 9. Effra scenario */

test('Effra zeroes billing work apart from five minutes of exception review', () => {
  const model = buildModel(demoAnswers());
  const results = compute(model);

  close(results.effra.byGroup.B.minutes, EFFRA_EXCEPTION_MINUTES);
  const exceptionRow = results.effra.activities.find((a) => a.id === 'effra-exceptions');
  assert.ok(exceptionRow);
  assert.equal(exceptionRow.role, model.slots.exception);
  close(exceptionRow.minutes, 5);
  assert.equal(results.effra.activities.filter((a) => a.group === 'B').length, 1);
});

test('Effra leaves front-end and clinical work untouched', () => {
  const results = compute(buildModel(demoAnswers()));
  close(results.effra.byGroup.F.minutes, results.current.byGroup.F.minutes, 1e-9);
  close(results.effra.byGroup.F.cost, results.current.byGroup.F.cost, 1e-9);
  for (const row of results.current.activities.filter((a) => a.group === 'F')) {
    const after = results.effra.activities.find((a) => a.id === row.id);
    close(after.minutes, row.minutes, 1e-9);
  }
});

test('insurers with no Effra data fall back to the Vitality figures', () => {
  const answers = {
    ...demoAnswers(),
    insurers: ['aviva', 'wpa', 'other', 'vitality'],
    appointments: { aviva: 10, wpa: 10, other: 10, vitality: 10 },
    daysToPay: { aviva: 'over2m', wpa: 'over2m', other: 'over2m', vitality: 'over2m' }
  };
  const after = effraInsurers(buildModel(answers).insurers);
  const vitality = after.find((i) => i.key === 'vitality');
  for (const key of ['aviva', 'wpa', 'other']) {
    const insurer = after.find((i) => i.key === key);
    close(insurer.daysToPay, vitality.daysToPay);
    close(insurer.rejectionPct, vitality.rejectionPct);
  }
  close(vitality.daysToPay, 4);
  close(vitality.rejectionPct, 0.3);
});

test('Effra write-offs are zero and aged debt is a tenth of the current balance', () => {
  const model = buildModel({ ...demoAnswers(), agedDebt: 9000, agedDebtNotSure: false });
  const results = compute(model);
  close(results.effra.writeOffsMonthly, 0);
  close(results.effra.agedDebt, results.current.agedDebt * 0.1, 1e-9);
  close(results.headline.agedDebtReduced, 9000 * 0.9, 1e-9);
});

test('Effra uses the upper-bound rejection rates behind the headline labels', () => {
  const after = effraInsurers(buildModel(demoAnswers()).insurers);
  close(after.find((i) => i.key === 'bupa').rejectionPct, 5);
  close(after.find((i) => i.key === 'axa').rejectionPct, 0.1);
  assert.equal(after.find((i) => i.key === 'bupa').rejectionLabel, 'under 5%');
});

/* 10. Weighting */

test('average days to pay is revenue weighted, not a plain mean', () => {
  const results = compute(buildModel(demoAnswers()));
  // Bupa 60x£70 at 45 days, AXA 40x£70 at 45 days, Vitality 25x£70 at 21 days.
  const expected = (4200 * 45 + 2800 * 45 + 1750 * 21) / (4200 + 2800 + 1750);
  close(results.current.avgDaysToPay, expected, 1e-9);
  assert.notEqual(Math.round(expected), Math.round((45 + 45 + 21) / 3));

  const effraExpected = (4200 * 15 + 2800 * 19 + 1750 * 4) / (4200 + 2800 + 1750);
  close(results.effra.avgDaysToPay, effraExpected, 1e-9);
});

/* 11. Annualisation */

test('flows are annualised and balances are not', () => {
  const model = buildModel(demoAnswers());
  const results = compute(model);

  close(
    results.headline.capacityValue,
    (results.current.totals.cost - results.effra.totals.cost) * 12,
    1e-9
  );
  close(
    results.headline.writeOffsRecovered,
    (results.current.writeOffsMonthly - results.effra.writeOffsMonthly) * 12,
    1e-9
  );
  // Write-offs: £3,000 a year, all recovered.
  close(results.headline.writeOffsRecovered, 3000, 1e-9);

  // Balances stay as balances.
  close(results.headline.agedDebtReduced, results.current.agedDebt - results.effra.agedDebt, 1e-12);
  close(
    results.headline.cashReleased,
    ((results.current.revenue * 12) / 365) * (results.current.avgDaysToPay - results.effra.avgDaysToPay),
    1e-9
  );
});

/* 12. Cash saving */

test('keep releases no cash, reduce is pro rata and remove is the full cost', () => {
  const rec = roleCost({ key: 'rec', label: 'Receptionist', salary: 24500, weeklyHours: 37.5, hourlyOverride: null });

  close(cashForChoice({ mode: 'keep' }, rec), 0);
  close(cashForChoice(undefined, rec), 0);
  close(cashForChoice({ mode: 'remove' }, rec), rec.employmentCost, 1e-12);
  close(cashForChoice({ mode: 'reduce', hoursCut: 5 }, rec), (5 * 52 * rec.employmentCost) / rec.contractedHours, 1e-9);
  close(cashForChoice({ mode: 'reduce', hoursCut: 5 }, rec), (5 / 37.5) * rec.employmentCost, 1e-9);
});

test('credited cash is capped at the capacity value and the excess is reported', () => {
  const model = buildModel({ ...demoAnswers(), timeChoices: { pm: { mode: 'remove' } } });
  const results = compute(model);
  const requested = results.current.roleCosts.pm.employmentCost;

  close(results.cash.requested, requested, 1e-9);
  assert.ok(requested > results.headline.capacityValue, 'removing a practice manager should exceed capacity');
  close(results.cash.credited, results.headline.capacityValue, 1e-9);
  close(results.cash.excess, requested - results.headline.capacityValue, 1e-9);
  close(results.cash.credited + results.cash.excess, results.cash.requested, 1e-9);
});

test('a small reduction is credited in full with no excess', () => {
  const model = buildModel({ ...demoAnswers(), timeChoices: { pm: { mode: 'reduce', hoursCut: 0.5 } } });
  const results = compute(model);
  assert.ok(results.cash.requested < results.headline.capacityValue);
  close(results.cash.credited, results.cash.requested, 1e-9);
  close(results.cash.excess, 0, 1e-9);
});

/* 13. Rounding */

test('displayed components of a difference always add up', () => {
  const results = compute(buildModel(demoAnswers()));
  const pairs = [
    [results.current.totals.cost, results.effra.totals.cost, 0],
    [results.current.byGroup.B.cost, results.effra.byGroup.B.cost, 0],
    [results.current.avgDaysToPay, results.effra.avgDaysToPay, 0],
    [results.current.totals.minutes / 60, results.effra.totals.minutes / 60, 1]
  ];
  for (const [current, effra, decimals] of pairs) {
    const r = roundedDelta(current, effra, decimals);
    close(r.current - r.effra, r.difference, 1e-9);
  }
  // Awkward halves still reconcile.
  const r = roundedDelta(100.5, 33.4, 0);
  close(r.current - r.effra, r.difference, 1e-9);
});

/* 14. Allocation */

test('batch cost sums exactly to the total across insurers', () => {
  const results = compute(buildModel(demoAnswers()));
  for (const row of results.current.activities) {
    const allocated = Object.values(row.byInsurer).reduce((s, v) => s + v, 0);
    close(allocated, row.minutes, 1e-9);
  }
  const insurerCost = Object.values(results.current.byInsurer).reduce((s, v) => s + v.cost, 0);
  close(insurerCost, results.current.totals.cost, 1e-9);

  const insurerMinutes = Object.values(results.current.byInsurer).reduce((s, v) => s + v.minutes, 0);
  close(insurerMinutes, results.current.totals.minutes, 1e-9);
});

test('role and group breakdowns reconcile to the totals', () => {
  const results = compute(buildModel(demoAnswers()));
  const roleCostSum = Object.values(results.current.byRole).reduce((s, v) => s + v.cost, 0);
  close(roleCostSum, results.current.totals.cost, 1e-9);
  close(results.current.byGroup.B.cost + results.current.byGroup.F.cost, results.current.totals.cost, 1e-9);
});

/* 15. Calibration */

test('demo answers land billing work near the ten hours a month benchmark', () => {
  const results = compute(buildModel(demoAnswers()));
  const billingHours = results.current.byGroup.B.minutes / 60;
  assert.ok(billingHours >= 8 && billingHours <= 12, `billing hours ${billingHours} outside 8-12`);
  close(results.current.byGroup.B.minutes, 576.25, 1e-9);
});

/* Extras: activity exclusion, validation and helpers */

test('an activity with no role is excluded and counted', () => {
  const model = buildModel(demoAnswers());
  model.activities.find((a) => a.id === 'submit').role = '';
  const results = compute(model);
  assert.equal(results.excludedActivities, 1);
  assert.ok(!results.current.activities.some((a) => a.id === 'submit'));
});

test('rejected claims drive the exception rows', () => {
  const model = buildModel(demoAnswers());
  const results = compute(model);
  close(results.current.rejectedClaims, 125 * 0.05, 1e-9);
  const correcting = results.current.activities.find((a) => a.id === 'correct');
  close(correcting.minutes, 125 * 0.05 * 8, 1e-9);
  const disputes = results.current.activities.find((a) => a.id === 'disputes');
  close(disputes.minutes, 125 * 0.05 * 0.2 * 10, 1e-9);
});

test('batch rows are counted once for the clinic, not once per insurer', () => {
  const model = buildModel(demoAnswers());
  const results = compute(model);
  for (const id of ['remittances', 'reconcile']) {
    close(results.current.activities.find((a) => a.id === id).minutes, 60, 1e-9);
  }
  const batchDefaults = ACTIVITY_DEFAULTS.filter((a) => a.type === 'batch');
  assert.equal(batchDefaults.length, 2);
});

test('validation rejects blanks, negatives and missing choices', () => {
  const blank = blankAnswers();
  assert.equal(validateQuestion('insurers', blank), 'Choose at least one insurer.');
  assert.equal(validateQuestion('fee', blank), 'Enter a number of 0 or more.');
  assert.equal(validateQuestion('fee', { fee: -5 }), 'Enter a number of 0 or more.');
  assert.equal(validateQuestion('fee', { fee: 70 }), null);

  const oneInsurer = { insurers: ['bupa'], appointments: { bupa: 0 } };
  assert.ok(validateQuestion('appointments', oneInsurer));
  assert.equal(validateQuestion('appointments', { insurers: ['bupa'], appointments: { bupa: 12 } }), null);
  assert.equal(validateQuestion('appointments', { insurers: ['bupa'], appointments: { bupa: 'abc' } }), 'Enter a number of 0 or more.');

  assert.ok(validateQuestion('billingRoles', { billingRoles: ['rec', 'pm'], exceptionRole: '' }));
  assert.equal(validateQuestion('billingRoles', { billingRoles: ['rec', 'pm'], exceptionRole: 'pm' }), null);
  assert.equal(validateQuestion('billingRoles', { billingRoles: ['rec'], exceptionRole: '' }), null);

  assert.ok(validateQuestion('daysToPay', { insurers: ['bupa', 'axa'], daysToPay: { bupa: '2to4w' } }));
  assert.equal(validateQuestion('agedDebt', { agedDebtNotSure: true }), null);
  assert.equal(validateQuestion('agedDebt', { agedDebtNotSure: false, agedDebt: '' }), 'Enter a number of 0 or more.');
});

test('Not sure answers fall back as documented', () => {
  const answers = blankAnswers();
  applyNotSure(answers, 'fee');
  assert.equal(answers.fee, 70);

  applyNotSure(answers, 'billingRoles');
  assert.deepEqual(answers.billingRoles, ['rec']);

  answers.billingRoles = ['adm', 'pm'];
  answers.exceptionRole = 'pm';
  applyNotSure(answers, 'frontRole');
  assert.equal(answers.frontRole, 'adm');

  applyNotSure(answers, 'rejections');
  assert.equal(answers.rejections, 'notsure');
  applyNotSure(answers, 'writeOffs');
  assert.equal(answers.writeOffs, 'notsure');
  applyNotSure(answers, 'agedDebt');
  assert.equal(answers.agedDebtNotSure, true);
});

test('toNumber copes with currency formatting and rubbish', () => {
  close(toNumber('£1,234', 0), 1234);
  close(toNumber('', 7), 7);
  close(toNumber('abc', 3), 3);
  close(toNumber(12.5, 0), 12.5);
});

test('runScenario is pure: computing twice never mutates the model', () => {
  const model = buildModel(demoAnswers());
  const snapshot = JSON.stringify(model);
  compute(model);
  compute(model);
  assert.equal(JSON.stringify(model), snapshot);
  const direct = runScenario(model.roles, model.insurers, model.activities);
  assert.ok(direct.totals.cost > 0);
});

test('released hours reconcile with the capacity value', () => {
  const model = buildModel(demoAnswers());
  const results = compute(model);
  const summed = Object.values(results.released).reduce((s, r) => s + r.hoursReleased, 0);
  close(summed, results.headline.releasedHoursTotal, 1e-9);
  close(
    results.headline.billingHoursReleasedMonthly,
    (results.current.byGroup.B.minutes - 5) / 60,
    1e-9
  );
});

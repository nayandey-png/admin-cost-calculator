# PMI admin cost calculator

An interactive calculator for owners and managers of UK physiotherapy, psychology and
other private clinics. It estimates what administering insured-patient work costs today,
then compares that with Effra's benchmarks.

**The deliverable is [`dist/calculator.html`](dist/calculator.html)** — one self-contained
file with no backend, no libraries, no web fonts, no CDNs and zero network requests after
load.

```
npm test      # 35 node:test unit tests against the calculation engine
npm run build # inlines src/ into dist/calculator.html
```

The build refuses to emit a file containing an external `<link>`, `<script src>`,
`@import` or remote `url()`, so the no-network guarantee can't regress silently.

## Layout

```
dist/calculator.html        the deliverable: one self-contained file
dist/framer/PMICalculator.tsx  generated Framer code component (same HTML, base64)

src/calc.js       pure engine: buildModel(answers) and compute(model)
src/defaults.js   role defaults, activity defaults, survey mappings, Effra benchmarks
src/survey.js     question definitions, demo/blank answers, validation
src/ui.js         rendering, events, tooltips, CSV, print
src/charts.js     CSS bar charts plus a visually hidden data table for each
src/styles.css    all colours as custom properties on :root
src/index.html    shell
test/calc.test.js unit tests
build.js          inliner
```

---

## The calculation model

The survey collects **monthly** volumes. Everything downstream is derived; nothing is
stored twice.

**1. Insurers.** Each selected insurer gets `appointments` (from the survey),
`invoices = appointments` (one invoice per session), `courses = appointments ÷ 5`
(the average insured course of treatment) and `revenue = appointments × fee`. The
rejection rate, days to pay and annual write-off band come from the survey's
multiple-choice answers. Write-offs and any stated aged-debt total are split across
insurers by revenue share; if aged debt is "Not sure" it is estimated per insurer as
`revenue × max(0, daysToPay − 30) ÷ 30`.

**2. Roles.** Four slots are filled from the answers: `exception` (whoever does the
chasing and fixing), `routine` (the other billing person, or the same one if only one
was chosen), `front` (authorisations and new-patient admin) and `clinician` (always
present, because clinical reports are assigned to it). Roles are identified by type,
so choosing a Q4 role again at Q5 reuses the same person rather than creating a
second salary.

**3. Staff cost.** Each role's true hourly cost is its full employment cost divided by
the hours it is actually available to work:

```
employerNI     = 15% × max(0, salary − 5,000)
pension        = 3% × max(0, min(salary, 50,270) − 6,240)
employmentCost = salary + employerNI + pension
contractedHrs  = weeklyHours × 52
leaveHrs       = 5.6 × weeklyHours          (statutory, pro rata, includes bank holidays)
sickHrs        = 2% × contractedHrs
productiveHrs  = contractedHrs − leaveHrs − sickHrs
hourlyCost     = override ?? employmentCost ÷ productiveHrs
costPerMin     = hourlyCost ÷ 60
```

Leave reduces the denominator; it is never added as a cost. An hourly override (for an
owner on dividends, or to value a clinician's time at what they'd earn treating
patients) replaces the rate, and the role's annual cost is re-derived as
`override × productiveHrs` so the cash-saving maths stays consistent. The Employment
Allowance is deliberately ignored: it is a fixed clinic-level allowance, so it doesn't
change the marginal cost of an admin hour.

**4. Activities.** Twenty tasks are split into two groups — **B**, billing and payments,
and **F**, front-end and clinical admin. Most are rate tasks driven by a volume:

```
rate:   minutes = baseVolume(basis) × incidence% × followUps × minutesPerOccurrence
batch:  minutes = batches × minutesPerBatch      (once for the clinic, not per insurer)
cost    = minutes × costPerMin(role)
```

`basis` is courses, appointments, invoices or rejected claims, where
`rejectedClaims = invoices × rejectionPct`. The Q10 sense-check slider scales
billing-group minutes only (150% → ×1.5); front-end minutes are untouched. With the
demo answers the billing group lands at 576.25 minutes a month — 9.6 hours, matching
Effra's "before Effra" benchmark of roughly 10.

**5. The Effra scenario.** Every billing activity drops to zero minutes and is replaced
by a single fixed task, "Reviewing Effra exceptions", at 5 minutes a month for the whole
clinic, assigned to the exception role. Front-end and clinical work is identical to the
current process, so it cancels out of every comparison. Insurer outcomes are replaced by
fixed benchmarks — rejection rates, days to pay, zero write-offs and aged debt at a tenth
of its current balance. Insurers with no Effra data yet (Aviva, WPA, Other) use the
Vitality figures. The calculation uses the upper bound of each published rejection rate,
so the tool never credits more than the label claims. None of this is user-editable.

**6. Results.** Monthly flows are annualised by ×12; balances are not.

```
capacityValue      = (currentCost − effraCost) × 12
releasedHrs(role)  = (currentMins(role) − effraMins(role)) ÷ 60 × 12
writeOffsRecovered = (currentWriteOffs − effraWriteOffs) × 12
avgDays            = Σ(revenue × days) ÷ Σ revenue                        (revenue weighted)
cashReleased       = (Σ revenue × 12 ÷ 365) × (currentAvgDays − effraAvgDays)   one-off
agedDebtReduced    = currentAgedDebt − effraAgedDebt                           one-off
reworkRate         = Σ rejectedClaims ÷ Σ invoices
```

**7. Released time versus cash.** Freeing up an hour is not the same as saving money, so
the two are tracked separately. Each role with released time gets a choice:

```
keep   → 0
reduce → hoursCutPerWeek × 52 × employmentCost ÷ contractedHrs
remove → employmentCost
cashCredited = min(Σ cash, max(capacityValue, 0))
excess       = Σ cash − cashCredited
```

Credited cash is capped at the value of the time Effra actually releases. Anything beyond
that comes from the staffing decision, not from Effra, and is reported on its own quiet
line rather than folded into the headline.

### No double counting

- **Leave versus productive hours.** Leave only ever shrinks `productiveHrs`. It never
  appears as a cost, so a clinic isn't charged for holiday twice.
- **Batch versus per-invoice work.** Reading remittances and reconciling the bank are
  clinic-level batch tasks counted once. Their per-insurer split exists only for the
  "cost by insurer" chart, and the last insurer takes the remainder so the split sums
  exactly to the total.
- **Rejection rate versus exception incidence.** `rejectedClaims` is the base volume.
  Tasks on that basis carry incidence 100% (correcting, resubmitting) or a sub-share of
  it (disputes, 20%). Exception tasks on the `invoices` basis — shortfalls at 4%, aged
  debt chasing at 10% — are independent failure modes, not the same claims again.
- **Balances versus flows.** Only monthly flows are annualised. Aged debt and cash
  released are one-off balances and are labelled as such.
- **Released capacity versus cash saving.** Cash is capped at `capacityValue`, so the
  same hour can't be counted as both freed capacity and a banked saving.

Internally everything runs at full precision. Rounding happens only at display, and where
two figures are shown either side of a difference the difference is rounded first and the
second figure derived from it — so the numbers on screen always add up.

---

## Embedding

Host `calculator.html` anywhere that serves static files, then embed it in an iframe.
Inline embedding is not supported: it breaks on Webflow's embed character limit and on
WordPress theme CSS.

```html
<iframe id="pmi-calc" src="https://HOST/calculator.html" title="PMI admin cost calculator"
        style="width:100%;border:0;min-height:900px" loading="lazy"></iframe>
<script>
window.addEventListener('message', e => {
  if (e.data && e.data.type === 'pmi-calc-height') {
    document.getElementById('pmi-calc').style.height = e.data.height + 'px';
  }
});
</script>
```

The calculator posts `{ type: 'pmi-calc-height', height }` to its parent on load and
whenever its body resizes, via `ResizeObserver`, so the iframe tracks the content instead
of scrolling internally. It measures the body box rather than `scrollHeight`, so the frame
shrinks again when the detailed-assumptions panel is collapsed — measuring `scrollHeight`
would ratchet the height upward and never come back down, because it is bounded below by
the iframe's own height.

Framer is different: it gets a code component instead, and needs no hosting at all. See
below.

### WordPress

1. Upload `calculator.html` somewhere on your domain (Media Library, or `/wp-content/uploads/`
   via SFTP). Note the URL.
2. Edit the page and add a **Custom HTML** block.
3. Paste the snippet above, replacing `https://HOST/calculator.html` with your URL.
4. Preview rather than trusting the editor: the block editor doesn't run the resize script.

If your security plugin strips `<script>` from post content, drop the script into the
theme via `wp_footer` instead and leave only the `<iframe>` in the block. Without it the
calculator still works — it just stays at `min-height` and scrolls inside the frame.

### Webflow

1. Upload `calculator.html` to your own host. Webflow's Assets panel doesn't serve HTML,
   so use S3, Netlify, Cloudflare Pages or similar.
2. Drag an **Embed** element onto the page.
3. Paste the snippet, replacing the URL.
4. Publish and test on the live site — the Designer canvas doesn't execute the script.

The snippet is well under Webflow's 50,000-character embed limit because only the iframe
tag is inline; the calculator itself is a separate file.

### Framer

Framer gets `dist/framer/PMICalculator.tsx`, a code component that carries the whole
calculator inside it. Nothing to host and no custom code in Site Settings — the component
owns its own resize listener.

1. **Assets** panel → **Code** → **Create code file**. Name it `PMICalculator.tsx`.
2. Delete the starter contents and paste all of `dist/framer/PMICalculator.tsx`.
3. Drag the component from the Assets panel onto the page.
4. Set its width to **Fill**. Leave the height alone — the component drives it.

The component is regenerated by `npm run build` from the same HTML that produces
`calculator.html`, so the two can't drift. Don't hand-edit it; edit `src/` and rebuild.

**How it works.** The HTML is embedded base64-encoded and decoded on mount, then rendered
into an `<iframe srcDoc={...}>`. There's deliberately no `sandbox` attribute: a srcdoc
iframe without one inherits the parent page's origin, which is what keeps Export CSV
working. A `message` listener accepts height updates only
when `event.source` matches the iframe's own `contentWindow`, so another embed on the same
page can't resize it.

**Initial height** is 585px, chosen to match question 1 rather than the results, because
that is what every visitor loads first. Measured settle heights on the first survey screen:

| Viewport | Settles at | Jump on load |
|---|---|---|
| 1280 | 585px | 0px, none |
| 768 | 610px | +25px, invisible |
| 390 | 883px | +298px, grow |
| 320 | 908px | +323px, grow |

So desktop and tablet load at essentially the right height. Phones start short and grow,
because the survey stacks taller at narrow widths — a grow reads as the page settling,
where a shrink reads as a glitch. After that every change is user-initiated: around
2913px on the results, 5080px with the detailed panel open, and back to 2913px when it is
collapsed. `@framerIntrinsicHeight` stays at 1400, which only sets the placeholder size on
Framer's canvas and has no effect at runtime.

If you change anything that alters the survey's height, re-measure and retune
`INITIAL_HEIGHT` in `build.js` — it is tuned to the first screen, not to a round number.

Base64 rather than an escaped template literal: the inlined calculator script is itself
full of template literals — 458 backticks and 210 `${` sequences — so escaping would mean
a global transform over 97 kB where one missed sequence produces silently corrupt markup
that only surfaces at runtime. Base64's alphabet can't collide with a string delimiter, an
interpolation or a closing script tag. It costs a third more bytes and one decode at mount.

**File size.** `PMICalculator.tsx` is **136 kB over 802 lines**, of which about 133 kB is
the base64 payload. That payload is split across roughly 740 lines of 180 characters
rather than one enormous line, which is what usually makes code editors stutter. Framer's
editor is a Monaco-style editor and a file this size is large but not extreme; I have not
been able to verify paste performance in Framer myself, so treat that as untested. If it
does struggle, fall back to hosting `calculator.html` and using an **Embed** element in URL
mode with this in Site Settings → General → Custom Code → End of `<body>`:

```html
<script>
window.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'pmi-calc-height') return;
  var frames = document.querySelectorAll('iframe');
  for (var i = 0; i < frames.length; i++) {
    if (frames[i].contentWindow === e.source) {
      frames[i].style.height = e.data.height + 'px';
      break;
    }
  }
});
</script>
```

That matches the iframe by `contentWindow` because Framer doesn't let you put an `id` on
the element it generates.

Either way, test on the **published** site. Framer's canvas doesn't run custom code, and
the code-component preview may not reflect final layout.

### Sandboxed iframes

If your CMS sandboxes iframes, the calculator needs:

```
sandbox="allow-scripts allow-downloads allow-modals"
```

`allow-scripts` to run, `allow-downloads` for CSV export, `allow-modals` for the print
dialogue.

---

## Testing checklist

### Calculations (`npm test` covers all of these)

- [ ] Hourly cost: receptionist on £24,500 over 37.5 hrs gives NI £2,925, pension £547.80,
      1,701 productive hours and ≈£16.44/hr. An hourly override wins.
- [ ] Leave isn't a cost: halving weekly hours halves leave hours and leaves employment
      cost unchanged.
- [ ] Survey mappings: every Q6, Q7 and Q9 option maps to its documented value, and each
      "Not sure" falls back correctly.
- [ ] Aged debt on "Not sure" equals `revenue × max(0, days − 30) ÷ 30` per insurer.
- [ ] Derived volumes: courses = appointments ÷ 5, invoices = appointments,
      revenue = appointments × fee.
- [ ] Q4 roles: with two roles, routine work goes to one and exception work to the other;
      with one role it takes everything.
- [ ] Q5 reuse: picking a Q4 role creates no duplicate role.
- [ ] Slider: at 150% billing minutes are ×1.5 and front-end minutes are unchanged.
- [ ] Effra scenario: all billing activities are zero plus exactly 5 minutes of exception
      review; front-end is unchanged; unlisted insurers use the Vitality figures;
      write-offs are zero and aged debt is ×0.1.
- [ ] Average days to pay is revenue-weighted, not a plain mean.
- [ ] Flows are ×12; balances are not annualised.
- [ ] Cash saving: keep gives 0, reduce is pro rata, remove gives the full employment
      cost, the total is capped at capacity value and the excess is reported.
- [ ] Rounding: the displayed components of any displayed difference add up exactly.
- [ ] Allocation: batch cost sums exactly to the total across insurers.
- [ ] Calibration: with the demo answers, billing-group time is 8–12 hours a month.

### Validation

- [ ] A negative number or text in any numeric field shows "Enter a number of 0 or more."
- [ ] A percentage above 100 shows "Percentages can't be above 100%."
- [ ] Q1 won't advance with no insurer selected.
- [ ] Q2 won't advance unless at least one insurer has an appointment count above zero.
- [ ] Q4 with two or more people won't advance until the chasing question is answered.
- [ ] Q6 won't advance until every insurer has an answer.
- [ ] Setting an activity's owner to "— no one —" excludes it and shows a note with the
      count.
- [ ] Errors appear inline, are linked with `aria-describedby` and don't advance the
      survey.

### Responsiveness and print

- [ ] 320px: no horizontal page scroll; tables are stacked cards.
- [ ] 768px: no horizontal page scroll; wide tables scroll inside their own region.
- [ ] 1280px: tiles sit four across; charts are readable.
- [ ] Print: survey and all controls are hidden, results only, cards don't break across
      pages, bars stay distinguishable in pure black and white (fill pattern plus a text
      label, never colour alone).

### Accessibility

- [ ] Keyboard-only: complete the survey, open tooltips, change released-time choices and
      edit the detailed panel without a mouse.
- [ ] Focus rings are visible on every interactive element.
- [ ] Tooltips open on Enter and Space, close on Escape, keep focus on their button and
      report state with `aria-expanded`.
- [ ] Screen reader: the progress bar announces position, every input has a real label,
      errors are announced via `aria-live`, and each chart has a matching data table.
- [ ] No duplicate element `id`s anywhere, including with the detailed panel open.
- [ ] Contrast: body text ≥ 4.5:1, large text and UI ≥ 3:1. Verified pairs include bar
      value labels, muted tile labels and the footer.
- [ ] 200% zoom (640 CSS px): no horizontal scroll, nothing clipped.
- [ ] `prefers-reduced-motion` suppresses the bar transitions.

### Privacy

- [ ] Open DevTools → Network, reload, complete the survey: exactly one request, for the
      document itself. No fonts, no analytics, no beacons.
- [ ] Nothing is written to `localStorage`, `sessionStorage` or cookies: answers live in
      memory only and are gone on reload.

### Embedding

- [ ] Plain `<iframe src>`: the frame grows to the results height, grows again when the
      detailed panel opens and shrinks back when it closes, with no inner scrollbar.
- [ ] Framer component: `npx tsc --noEmit --strict` on `PMICalculator.tsx` is clean, it
      has exactly one export and imports only from `react`.
- [ ] Framer component in a browser: the srcdoc frame reports `window.parent !== window`,
      inherits the page origin, auto-heights, and Export CSV still works.
- [ ] Framer component loads the survey at its real height with no visible shrink on
      desktop.
- [ ] `PMICalculator.tsx` decodes byte-for-byte back to `dist/calculator.html`, so the two
      builds can't drift.

---

Estimates for planning only. Not accounting, tax or employment advice.

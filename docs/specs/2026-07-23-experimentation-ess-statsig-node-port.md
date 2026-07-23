# Port statistics-service statsig calc into an audit-worker Node util

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Author** | Dereje Dilnesaw |
| **Created** | 2026-07-23 |
| **Ticket** | [SITES-47215](https://jira.corp.adobe.com/browse/SITES-47215) |
| **PR** | [#2809](https://github.com/adobe/spacecat-audit-worker/pull/2809) |

---

## Summary

`experimentation-ess-all` computes per-variant statistical significance by invoking a separate AWS Lambda (`spacecat-services--statistics-service`, type `statsig`). That cross-account invoke fails in production/dev with `AccessDeniedException: … not authorized to perform: lambda:InvokeFunction … because no resource-based policy allows it`, so p-values are silently dropped (swallowed in `addPValues`). This spec ports the statsig calculation into a self-contained Node util inside audit-worker, removing the cross-account Lambda dependency.

## Problem Statement

- `src/experimentation-ess/common.js` `addPValues` calls `invokeLambdaFunction` → `spacecat-services--statistics-service` (ARN in account `282898975672`); the audit-worker role (dev `682033462621` / prod `640168421876`) lacks cross-account invoke permission.
- The error is caught and logged (`Error calculating p-values: No result from lambda function`), so experiments persist **without** `p_value` / `power` / `statsig`.
- The Lambda is otherwise-unmaintained; the reference implementation lives in `adobe/spacecat-services-statistics` `src/statsig/handler.py`.

## Goals

- Compute `{ p_value, power, statsig }` per variant **in-process** in audit-worker, byte-for-byte compatible with the current `statsig` Lambda output (within floating-point tolerance).
- Remove the cross-account Lambda invoke (`invokeLambdaFunction`, `SPACECAT_STATISTICS_SERVICE_ARN`, `@aws-sdk/client-lambda`) from the ESS path.
- No new runtime dependency (hand-rolled numerics), fully unit-tested.
- Preserve the existing swallow-on-error contract so a stats failure never fails the audit.

## Reference implementation (to port)

`spacecat-services-statistics/src/statsig/handler.py` (`StatsigHandler`):

- `compute_statsig(experiment)` — requires `experiment.control` with `{metrics, views}`; returns `{error: 'No control group'}` if absent. For each non-`control` variant with `{views, metrics}`, computes vs control; missing → `{error: 'No views or metrics for variant'}`.
- `calculate_p_value_and_power(c0, n0, c1, n1, alpha=0.05)` where `c=metrics`, `n=views`, index 0 = control:
  - `p_value = proportions_ztest([c0, c1], [n0, n1], alternative='two-sided')` — pooled two-proportion z-test; `NaN → {error: 'p-value is NaN'}`; else `round(p_value, 10)`.
  - `effect_size = proportion_effectsize(c0/n0, c1/n1)` — Cohen's h = `2·asin(√p1) − 2·asin(√p2)`.
  - `power = GofChisquarePower().solve_power(effect_size, nobs=n0+n1, alpha=0.05)` — non-central chi-square, `df=1`.
  - returns `{ p_value, power: round(power*100, 2), statsig: str(p_value < alpha) }`.

Contract at the boundary (`lambda_function.py` → audit-worker `addPValues`): input `payload.rumData = { [expId]: { [variantName]: { views, metrics }, control: {views, metrics} } }`; output `result[expId][variantName] = { p_value, power, statsig } | { error }`. audit-worker reads `p_value`, `power`, and `statsig` (compared as `String.toLowerCase() === 'true'`).

## Technical Design

New util `src/experimentation-ess/statsig.js` exporting `computeStatsig(rumData)` that mirrors `compute_statsig` per experiment. `addPValues` calls it directly instead of `invokeLambdaFunction`.

Numerics (hand-rolled, no new dep):
1. **Standard normal CDF** via `erf` (rational approximation) → `p_value = 2·(1 − Φ(|z|))`, with pooled `z = (p1 − p2) / √(p·(1−p)·(1/n0 + 1/n1))`, `p = (c0+c1)/(n0+n1)`. `se == 0` (or NaN) → `{error: 'p-value is NaN'}` to match statsmodels' NaN case.
2. **Cohen's h**: `2·asin(√p1) − 2·asin(√p2)`.
3. **GoF chi-square power (df=1)**: `ncp = h²·N`, `crit = χ²₁,₀.₉₅ = 3.841458820694124` (constant — `alpha`/`df` are fixed), `power = ncx2.sf(crit; df=1, ncp)`.
   - Non-central χ² SF via Poisson-weighted central-χ² series: `ncx2.cdf(x; k, λ) = Σⱼ e^(−λ/2)(λ/2)ʲ/j! · P((k+2j)/2, x/2)`, `P` = regularized lower incomplete gamma (series + continued fraction, Numerical-Recipes `gammp`); truncate when the Poisson tail weight < 1e-12.

Rounding matches Python: `p_value` to 10 dp, `power` to 2 dp (`power*100`), `statsig = String(p_value < 0.05)`.

Cleanup: remove `invokeLambdaFunction`, `SPACECAT_STATISTICS_SERVICE_ARN`, and the `@aws-sdk/client-lambda` / `defaultProvider` imports from `common.js` if unused elsewhere.

## Alternatives Considered

- **Grant cross-account IAM** (resource-based policy on the statistics-service Lambda). Rejected: keeps a dependency on an unmaintained Lambda in another account, needs infra approval, and the team's stated direction is to own the calc in Space Cat.
- **Add a stats npm dependency** (jstat / @stdlib). Partially viable for `erf`/normal/gamma, but none provide `GofChisquarePower` / non-central χ², so the hard part is hand-rolled regardless; avoid a new dep for marginal benefit.

## Test Plan

- Unit tests (`test/audits/experimentation-ess-statsig.test.js`): reference vectors captured by **running the Python `StatsigHandler` locally** (statsmodels) over representative `rumData`; assert Node output matches `p_value` (±1e-6), `power` (±0.1), and `statsig` exactly.
- Edge cases: no control → `{error:'No control group'}`; variant missing views/metrics → per-variant `{error}`; zero-conversion / identical-rate → NaN path `{error}`; large N.
- Cross-check p-values against abtestguide.com (as the Python comment does).
- Regression: `addPValues` no longer references the Lambda client; a stats error still leaves the audit successful (swallow preserved).

## Success Criteria

- `experimentation-ess-all` populates `p_value`/`power`/`statsig` with no `AccessDeniedException` in logs.
- Node util output matches the Python reference within tolerance on all test vectors.
- No `@aws-sdk/client-lambda` usage remains in the ESS path; 100% coverage on the new util.

/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * In-process port of the `statsig` calculation previously served by the
 * spacecat-services--statistics-service Lambda (spacecat-services-statistics
 * src/statsig/handler.py). Computes per-variant statistical significance for the
 * experimentation-ess-all audit, removing the cross-account Lambda dependency (SITES-47215).
 *
 * Mirrors statsmodels: pooled two-proportion z-test (two-sided) for the p-value,
 * Cohen's h effect size, and GofChisquarePower (non-central chi-square, df=1) for power.
 * Numbers match the Python reference within floating-point tolerance.
 */

const ALPHA = 0.05;
// chi2.isf(0.05, df=1) — critical value for the goodness-of-fit power test (alpha & df fixed).
const CHI2_CRIT_DF1_ALPHA_05 = 3.841458820694124;

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

// Natural log of the gamma function (Lanczos approximation). Only ever called with z >= 0.5
// here (half-integer chi-square dof and Poisson index + 1), so no reflection formula is needed.
function logGamma(z) {
  let x = 0.99999999999980993;
  const zz = z - 1;
  for (let i = 0; i < LANCZOS.length; i += 1) {
    x += LANCZOS[i] / (zz + i + 1);
  }
  const t = zz + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

// Regularized lower incomplete gamma P(s, x) via series expansion (converges for x < s + 1).
function gammpSeries(s, x) {
  let sum = 1 / s;
  let term = sum;
  for (let n = 1; n < 1000; n += 1) {
    term *= x / (s + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-15) {
      break;
    }
  }
  return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
}

// Regularized upper incomplete gamma Q(s, x) via continued fraction (converges for x >= s + 1).
function gammqCF(s, x) {
  const tiny = 1e-300;
  let b = x + 1 - s;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i += 1) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    /* c8 ignore next 3 -- numerical guard against division by ~0 (Numerical Recipes) */
    if (Math.abs(d) < tiny) {
      d = tiny;
    }
    c = b + an / c;
    /* c8 ignore next 3 -- numerical guard against division by ~0 (Numerical Recipes) */
    if (Math.abs(c) < tiny) {
      c = tiny;
    }
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) {
      break;
    }
  }
  return Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
}

// Regularized lower incomplete gamma P(s, x). Callers pass x > 0.
function gammp(s, x) {
  return x < s + 1 ? gammpSeries(s, x) : 1 - gammqCF(s, x);
}

// Regularized upper incomplete gamma Q(s, x) = 1 - P(s, x).
function gammq(s, x) {
  if (x <= 0) {
    return 1;
  }
  return x < s + 1 ? 1 - gammpSeries(s, x) : gammqCF(s, x);
}

// Central chi-square CDF with k degrees of freedom (x always > 0 here — crit value).
function chi2Cdf(x, k) {
  return gammp(k / 2, x / 2);
}

/**
 * Non-central chi-square survival function P(X > x) for df k and non-centrality lambda.
 * Poisson-weighted mixture of central chi-squares. Weights are computed in log-space and the
 * series is summed OUTWARD FROM THE MODE (j ~ lambda/2) so it stays stable for large lambda
 * (a naive forward-from-0 sum overflows/underflows to 0 or NaN for large-N experiments).
 */
function nonCentralChi2Sf(x, k, lambda) {
  if (!(lambda > 0)) {
    return 1 - chi2Cdf(x, k);
  }
  const half = lambda / 2;
  const logHalf = Math.log(half);
  const mode = Math.max(0, Math.floor(half));
  const logWeight = (j) => -half + j * logHalf - logGamma(j + 1);

  let cdf = 0;
  // upward from the mode
  for (let j = mode; j < mode + 1_000_000; j += 1) {
    const w = Math.exp(logWeight(j));
    cdf += w * chi2Cdf(x, k + 2 * j);
    if (j > mode && w < 1e-16) {
      break;
    }
  }
  // downward from the mode
  for (let j = mode - 1; j >= 0; j -= 1) {
    const w = Math.exp(logWeight(j));
    cdf += w * chi2Cdf(x, k + 2 * j);
    if (w < 1e-16) {
      break;
    }
  }
  return 1 - Math.min(cdf, 1);
}

// Standard normal survival via the regularized incomplete gamma (erf), stable in the tails.
function normalSf(z) {
  // P(Z > z) for z >= 0 == 0.5 * erfc(z / sqrt(2)) == 0.5 * gammq(0.5, z^2 / 2)
  return 0.5 * gammq(0.5, (z * z) / 2);
}

function round(value, decimals) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * Two-proportion significance of a test variant vs. control.
 * @param {number} controlMetrics conversions/clicks for control
 * @param {number} controlViews page views for control
 * @param {number} testMetrics conversions/clicks for the variant
 * @param {number} testViews page views for the variant
 * @param {number} [alpha] significance level (default 0.05)
 * @returns {{p_value:number, power:number, statsig:string}|{error:string}}
 */
export function calculatePValueAndPower(
  controlMetrics,
  controlViews,
  testMetrics,
  testViews,
  alpha = ALPHA,
) {
  const p1 = controlMetrics / controlViews;
  const p2 = testMetrics / testViews;
  const pooled = (controlMetrics + testMetrics) / (controlViews + testViews);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / controlViews + 1 / testViews));
  const z = (p1 - p2) / se;
  if (!Number.isFinite(z)) {
    return { error: 'p-value is NaN' };
  }
  const pValue = round(2 * normalSf(Math.abs(z)), 10);

  // Cohen's h effect size and GoF chi-square power (df = 1).
  const h = 2 * Math.asin(Math.sqrt(p1)) - 2 * Math.asin(Math.sqrt(p2));
  const ncp = h * h * (controlViews + testViews);
  const power = nonCentralChi2Sf(CHI2_CRIT_DF1_ALPHA_05, 1, ncp);

  return {
    p_value: pValue,
    power: round(power * 100, 2),
    statsig: String(pValue < alpha),
  };
}

// Per-experiment significance: requires a `control` variant with views+metrics.
function computeExperiment(experiment) {
  const { control } = experiment;
  if (!control || control.metrics === undefined || control.views === undefined) {
    return { error: 'No control group' };
  }
  const result = {};
  const variantNames = Object.keys(experiment).filter((name) => name !== 'control');
  for (const variantName of variantNames) {
    const variant = experiment[variantName];
    if (variant.views === undefined || variant.metrics === undefined) {
      result[variantName] = { error: 'No views or metrics for variant' };
    } else {
      result[variantName] = calculatePValueAndPower(
        control.metrics,
        control.views,
        variant.metrics,
        variant.views,
      );
    }
  }
  return result;
}

/**
 * Compute statsig for all experiments. Mirrors the Lambda `statsig` handler output:
 * `{ [experimentId]: { [variantName]: { p_value, power, statsig } | { error } } | { error } }`.
 * @param {object} rumData `{ [experimentId]: { [variantName]: { views, metrics } } }`
 */
export function computeStatsig(rumData) {
  const statsig = {};
  for (const experimentId of Object.keys(rumData)) {
    statsig[experimentId] = computeExperiment(rumData[experimentId]);
  }
  return statsig;
}

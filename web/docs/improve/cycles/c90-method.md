# c90 method note and tuning rule (committed BEFORE any simulation or code)

## Method
Anytime-valid confidence sequence (CS) for p_after - p_before, built from one sub-Gaussian normal-mixture
boundary per arm, combined by a union bound.

Source: Howard, Ramdas, McAuliffe, Sekhon (2021), "Time-uniform, nonparametric, nonasymptotic confidence sequences",
Annals of Statistics, normal-mixture boundary (the Robbins 1970 mixture). A Bernoulli observation is 1/4-sub-Gaussian
(Hoeffding), so for one arm with t observations and running sum S_t of (x_i - p):
  P( exists t >= 1 : |S_t| >= sqrt( (v+rho) * ( log((v+rho)/rho) + 2 log(1/a) ) ) ) <= a,   with v = t/4.
Arm interval: mean_t +/- boundary(t)/t, clipped to [0,1].

## Alpha
Total alpha = 5%. CORRECTION (fix round, after review): the boundary with 2 log(1/a) is Howard et al.'s ONE-sided bound at level a, so
used as |S_t| it is two-sided at 2a. Each arm therefore gets a = ALPHA/4 = 1.25% (L = ln 80), i.e. two-sided 2.5% per
arm, so both arm sequences hold at once with probability >= 95% (union bound), and the difference interval [lo_after - hi_before, hi_after - lo_before] contains the true difference at
all times together with probability >= 95%. This is conservative (wider than needed); we accept that.

## Running bounds
Every arm sequence is valid for all t at once, so we INTERSECT running bounds (running max of lower, running min of
upper). Bounds are then monotone: the interval never widens, and "0 excluded" never reverts.

## Tuning rule (fixed now, before any simulation)
rho is the single tuning knob. Rule: choose rho to minimise the boundary at a target of n* = 50 observations per arm,
using the closed form of Howard et al. (2021) eq. for the normal mixture:
  rho = (n* / 4) / ( 2 log(1/a) + log(1 + 2 log(1/a)) ),   a = 0.0125 (rho = 1.1320 after the correction; was 1.3153 with the wrong a = 0.025).
n* = 50 is chosen as the volume at which AXION comparisons are first plausible; no other value will be tried and rho
will not be adjusted after seeing any simulation result.

## Minimum
Below 10 observations in either arm the function returns status "not_enough_evidence" and no bounds. At or above 10 per
arm it returns the bounds, and `zeroExcluded` is a plain fact about the interval, not a verdict. No automatic stopping,
no "significant" wording.

## Simulation plan (fixed now)
Two fixed seeds (printed): 90001 and 90002. 1,000 no-effect streams per setting, p in {0.1, 0.3, 0.5} for both arms,
arms alternating, 200 observations per arm, checked after every observation (from the minimum of 10 per arm).
(a) ever-exclude-zero share <= 5% + 2 x Monte Carlo SE, where SE = sqrt(0.05*0.95/1000) = 0.69 points, so the limit is 6.38%.
Judged on every p and on both seeds. Contrast: a fixed-horizon 95% Wald interval for the difference re-checked
on the same streams after every observation (same minimum). Widths: median interval width at n = 20, 50, 100 per arm.
(b) covariate adjustment: NOT BUILT this cycle (optional in the brief); reported as NOT MET / not attempted.

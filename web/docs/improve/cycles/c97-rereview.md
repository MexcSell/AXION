# c97 scoped re-review (c3c8fd0..fe3b465): NOT CLEAR, on one minor-to-moderate gap

This is the controller's copy of the hand-back. All three original majors are fixed; tsc is clean and 39/39 c97 tests pass.

**1. Detector: fixed, but leaky.**
- **Now flagged:** `&>`, here-strings, `find -exec rm` and `-delete`, `tee -a`, `install`, `truncate`, `dd of=`, `chmod` and `chown`, `/bin/rm`, `;` and `||` chains, subshells, and `cd` followed by a relative path. Also `git checkout`, `eval`, `curl -o`, `tar -C` and `sed -i ''`.
- **Still missed, and not in the lane's list:**
  - backslash escapes inside paths;
  - `>&`;
  - `sort -o` and `awk -i inplace`;
  - running a script (`./x.sh`, `bash x.sh`, `source`);
  - answer names that are not whole stems;
  - test-file names beyond `.test.ts` and `.spec.ts`.
- `$` and backticks are flagged everywhere.
- The held-out family (ff1a44fe) was committed before the detector change (f594f493), but by the same author.

**2. Validity: pass.** The subtle mutants are flagged `verdict_mismatch`, the inverted grader is flagged `fails_reference`, and a grader that throws is flagged `grader_threw`.

**3. Fail closed: pass** for the detector, the graders and `checkTrialStart`. `gradeValidity` and `buildVariants` still throw on a null variant or a null `task.initial`.

**4. No loosening: pass.** One assertion became stricter, and one change is a rename. The original 37/40 and 2/40 results are kept.

**5. False flags:** 2/48, with the caveat that real command streams are unmeasured.

**Ruling:** close the cheap gaps, list the rest in the report, and make `gradeValidity` fail closed. This was sent to the lane.

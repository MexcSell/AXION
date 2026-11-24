import { describe, it, expect } from 'vitest';
import { checkBudget, type BudgetCap, type UsageTotal } from '../src/usage/budget.ts';

/** c77 item 1: the pure budget check. Wired to nothing: no route, job or agent calls it. */
const cap = (unit: string, limit: number, warnAtPct?: number): BudgetCap => ({ unit, limit, ...(warnAtPct === undefined ? {} : { warnAtPct }) });
const use = (unit: string, quantity: number): UsageTotal => ({ unit, quantity });

describe('checkBudget (table-driven)', () => {
  const rows: [string, BudgetCap[], UsageTotal[], 'allow' | 'warn' | 'deny', string[]][] = [
    ['no caps allows', [], [use('tokens_in', 5)], 'allow', []],
    ['no usage allows', [cap('tokens_in', 100)], [], 'allow', []],
    ['below the warn line allows', [cap('tokens_in', 100)], [use('tokens_in', 79)], 'allow', []],
    ['at the default 80% line warns', [cap('tokens_in', 100)], [use('tokens_in', 80)], 'warn', ['near_cap:tokens_in']],
    ['a custom warn line is honoured', [cap('tokens_in', 100, 50)], [use('tokens_in', 50)], 'warn', ['near_cap:tokens_in']],
    ['just under the hard cap warns', [cap('tokens_in', 100)], [use('tokens_in', 99)], 'warn', ['near_cap:tokens_in']],
    ['at the hard cap denies', [cap('tokens_in', 100)], [use('tokens_in', 100)], 'deny', ['cap_reached:tokens_in']],
    ['over the hard cap denies', [cap('tokens_in', 100)], [use('tokens_in', 250)], 'deny', ['cap_reached:tokens_in']],
    ['a zero cap denies at once', [cap('requests', 0)], [], 'deny', ['cap_reached:requests']],
    ['usage of a unit with no cap is ignored', [cap('tokens_in', 100)], [use('seconds', 9999)], 'allow', []],
    ['deny beats warn, and every reason is listed', [cap('a', 10), cap('b', 10)], [use('a', 9), use('b', 10)], 'deny', ['near_cap:a', 'cap_reached:b']],
    ['two usage totals of one unit are summed', [cap('a', 10)], [use('a', 6), use('a', 4)], 'deny', ['cap_reached:a']],
    ['cost cap in fixed-point micros', [cap('cost_micros', 5_000_000)], [use('cost_micros', 4_000_000)], 'warn', ['near_cap:cost_micros']],
    // fail closed on anything malformed
    ['a negative limit denies', [cap('a', -1)], [], 'deny', ['invalid_input']],
    ['a fractional limit denies', [cap('a', 1.5)], [], 'deny', ['invalid_input']],
    ['NaN usage denies', [cap('a', 10)], [use('a', NaN)], 'deny', ['invalid_input']],
    ['negative usage denies', [cap('a', 10)], [use('a', -3)], 'deny', ['invalid_input']],
    ['a duplicate cap unit denies', [cap('a', 10), cap('a', 20)], [], 'deny', ['invalid_input']],
    ['a warn line outside 1..99 denies', [cap('a', 10, 100)], [], 'deny', ['invalid_input']],
    ['an unsafe integer denies', [cap('a', Number.MAX_SAFE_INTEGER + 2)], [], 'deny', ['invalid_input']],
  ];
  for (const [name, caps, usage, decision, reasons] of rows) {
    it(name, () => {
      const r = checkBudget(caps, usage);
      expect(r.decision).toBe(decision);
      expect(r.reasons.map((x) => x.code + (x.unit ? ':' + x.unit : ''))).toEqual(reasons);
    });
  }
  it('is pure: it does not change its inputs and gives the same answer twice', () => {
    const caps = [cap('a', 10)]; const usage = [use('a', 9)];
    const s = JSON.stringify([caps, usage]);
    expect(checkBudget(caps, usage)).toEqual(checkBudget(caps, usage));
    expect(JSON.stringify([caps, usage])).toBe(s);
  });
});

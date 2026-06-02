import {
  DROPS_PER_XRP,
  xrpToDropsInt,
  dropsToXrpString,
  splitDrops,
} from '../penaltySplit';

describe('xrpToDropsInt', () => {
  it('converts whole and fractional XRP to drops', () => {
    expect(xrpToDropsInt(1)).toBe(DROPS_PER_XRP);
    expect(xrpToDropsInt(0.5)).toBe(500_000);
    expect(xrpToDropsInt(0)).toBe(0);
  });

  it('rounds to the nearest whole drop', () => {
    // 0.1234565 XRP = 123456.5 drops -> rounds to 123457
    expect(xrpToDropsInt(0.1234565)).toBe(123_457);
  });
});

describe('dropsToXrpString', () => {
  it('formats drops as a 6-decimal XRP string', () => {
    expect(dropsToXrpString(500_000)).toBe('0.500000');
    expect(dropsToXrpString(DROPS_PER_XRP)).toBe('1.000000');
    expect(dropsToXrpString(1)).toBe('0.000001');
  });
});

describe('splitDrops', () => {
  it('splits evenly when divisible', () => {
    expect(splitDrops(DROPS_PER_XRP, 4)).toEqual([250_000, 250_000, 250_000, 250_000]);
  });

  it('routes the flooring remainder to the first recipient', () => {
    // 1 XRP / 3 = 333333 each, remainder 1 -> first gets 333334
    expect(splitDrops(DROPS_PER_XRP, 3)).toEqual([333_334, 333_333, 333_333]);
  });

  it('returns the whole amount for a single recipient', () => {
    expect(splitDrops(777_777, 1)).toEqual([777_777]);
  });

  it('gives the remainder to the first member when total < recipients', () => {
    expect(splitDrops(2, 3)).toEqual([2, 0, 0]);
  });

  it('returns an empty array for non-positive recipient counts', () => {
    expect(splitDrops(1_000, 0)).toEqual([]);
    expect(splitDrops(1_000, -1)).toEqual([]);
  });

  it('never loses dust: shares always sum back to the total', () => {
    const totals = [1, 2, 7, 999, 1_000, 500_000, DROPS_PER_XRP, 3_333_337];
    const counts = [1, 2, 3, 4, 5, 7, 11];
    for (const total of totals) {
      for (const count of counts) {
        const shares = splitDrops(total, count);
        const sum = shares.reduce((a, b) => a + b, 0);
        expect(sum).toBe(total);
        expect(shares).toHaveLength(count);
        expect(shares.every(s => s >= 0)).toBe(true);
      }
    }
  });
});

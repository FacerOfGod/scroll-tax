/**
 * crashReporting.redact — the safety net that keeps wallet seeds and secrets out
 * of crash reports. A regression here could leak a user's funds, so the scrubber
 * is tested directly.
 */
import { redact } from '../crashReporting';

test('redacts XRPL family seeds wherever they appear in strings', () => {
  const seed = 'sn3nxiW7v8KXzPzAqzyHXbSSKNuN9'; // example XRPL seed shape
  const out = redact(`signing with ${seed} now`) as string;
  expect(out).not.toContain(seed);
  expect(out).toContain('[redacted-seed]');
});

test('redacts values under sensitive keys regardless of content', () => {
  const out = redact({
    seed: 'whatever',
    password: 'hunter2',
    apiKey: 'abc',
    note: 'safe to keep',
  }) as Record<string, unknown>;
  expect(out.seed).toBe('[redacted]');
  expect(out.password).toBe('[redacted]');
  expect(out.apiKey).toBe('[redacted]');
  expect(out.note).toBe('safe to keep');
});

test('recurses into nested objects and arrays', () => {
  const out = redact({
    tx: { secret: 's-deep', amounts: [1, 2] },
    list: [{ mnemonic: 'word word' }],
  }) as any;
  expect(out.tx.secret).toBe('[redacted]');
  expect(out.tx.amounts).toEqual([1, 2]);
  expect(out.list[0].mnemonic).toBe('[redacted]');
});

test('leaves non-sensitive primitives untouched', () => {
  expect(redact(42)).toBe(42);
  expect(redact(true)).toBe(true);
  expect(redact('hello world')).toBe('hello world');
});

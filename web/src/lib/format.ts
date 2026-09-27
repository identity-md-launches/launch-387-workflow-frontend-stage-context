import { formatUnits } from 'viem';

/** Fixed-point string with `sig` significant digits, no exponent for ordinary magnitudes. */
export function formatSig(value: number, sig = 5): string {
  if (!Number.isFinite(value)) return '–';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e15 || abs < 1e-12) return value.toExponential(sig - 1);
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
  const fixed = value.toFixed(Math.min(digits, 20));
  // Trim trailing zeros after the decimal point, keep integers intact.
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** Group thousands for large numbers, keep small numbers as-is. */
export function formatWithGroups(value: number, sig = 5): string {
  const s = formatSig(value, sig);
  if (s.includes('e')) return s;
  const [int = '', frac] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Token amount in wei → human string with up to `maxFrac` fraction digits. */
export function formatAmount(wei: bigint, decimals: number, maxFrac = 6): string {
  const s = formatUnits(wei, decimals);
  const [int = '0', frac = ''] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const f = frac.slice(0, maxFrac).replace(/0+$/, '');
  return f ? `${grouped}.${f}` : grouped;
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function shortHash(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

/** Parse a decimal string typed by the user into wei; returns null when invalid. */
export function parseDecimalAmount(input: string, decimals: number): bigint | null {
  const t = input.trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  const [int = '0', frac = ''] = t.split('.');
  if (frac.length > decimals) return null;
  const whole = BigInt(int || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
  return whole;
}

/** Parse a positive decimal (plain or exponent form) for a price. */
export function parsePrice(input: string): number | null {
  const t = input.trim().replace(/,/g, '');
  if (!/^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

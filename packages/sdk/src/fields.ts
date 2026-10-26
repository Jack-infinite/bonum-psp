import { isRecord } from './validation.js';

/** Typed accessors for one parsed JSON object. Each one throws through `fail` on a mismatch. */
export interface FieldReader {
  /** A required string. */
  string(key: string): string;
  /** A string, `null` or absent (→ `null`). */
  nullableString(key: string): string | null;
  /** A decimal kept as a string; a JSON number is converted to its exact decimal text. */
  decimalString(key: string): string;
  /** Like `decimalString`, but absent or `null` gives `null`. */
  nullableDecimalString(key: string): string | null;
  /** A boolean, or absent/`null` (→ `false`). */
  flag(key: string): boolean;
  /** One of the allowed string values. */
  oneOf<T extends string>(key: string, allowed: readonly T[]): T;
}

/** Wraps `data` in a {@link FieldReader}; `fail` turns a problem description into the error to throw. */
export function readFields(data: unknown, fail: (problem: string) => Error): FieldReader {
  if (!isRecord(data)) throw fail('expected a JSON object');
  const mismatch = (key: string, expected: string): Error =>
    fail(`"${key}" should be ${expected}, got ${describe(data[key])}`);

  const string = (key: string): string => {
    const value = data[key];
    if (typeof value === 'string') return value;
    throw mismatch(key, 'a string');
  };
  return {
    string,
    nullableString(key) {
      const value = data[key];
      if (value === undefined || value === null) return null;
      if (typeof value === 'string') return value;
      throw mismatch(key, 'a string or null');
    },
    decimalString(key) {
      const value = data[key];
      // Bonum documents strings, but some of its own samples show numbers. String() keeps the value.
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : string(key);
    },
    nullableDecimalString(key) {
      const value = data[key];
      if (value === undefined || value === null) return null;
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : string(key);
    },
    flag(key) {
      const value = data[key];
      if (value === undefined || value === null) return false;
      if (typeof value === 'boolean') return value;
      throw mismatch(key, 'a boolean');
    },
    oneOf(key, allowed) {
      const value = data[key];
      const match = allowed.find((candidate) => candidate === value);
      if (match !== undefined) return match;
      throw mismatch(key, `one of ${allowed.join(', ')}`);
    },
  };
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  const json = JSON.stringify(value);
  return json.length > 60 ? `${json.slice(0, 60)}…` : json;
}

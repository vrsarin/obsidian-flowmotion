/** A value as text for messages and comparisons. Objects become JSON, not "[object Object]". */
export const plain = (x: unknown): string => {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean' || typeof x === 'bigint') return String(x);
  return JSON.stringify(x) ?? '';
};

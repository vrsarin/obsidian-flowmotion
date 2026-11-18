export const MAIN_JS_MAX_BYTES = 4_800_000;

export function assertMainBundleSize(size) {
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error(`invalid main.js size: ${size}`);
  if (size > MAIN_JS_MAX_BYTES) {
    throw new Error(
      `main.js is ${size} bytes; the release budget is ${MAIN_JS_MAX_BYTES} bytes`,
    );
  }
}

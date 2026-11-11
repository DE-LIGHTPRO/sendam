// Some wallet libraries expect Node's Buffer and process to exist in the browser.
import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
if (!globalThis.process) {
  globalThis.process = { env: {}, browser: true, version: '', versions: {}, nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)) };
}

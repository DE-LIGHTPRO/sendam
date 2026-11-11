// Some wallet libraries expect Node's Buffer to exist in the browser.
import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;

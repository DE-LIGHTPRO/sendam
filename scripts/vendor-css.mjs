// Copies the wallet chooser's stylesheet into vendor/, without its Google Fonts import:
// the chooser uses Sendam's own font, so the page makes no third-party font request.
import { readFileSync, writeFileSync } from 'node:fs';

const css = readFileSync('node_modules/@near-wallet-selector/modal-ui/styles.css', 'utf8');
writeFileSync('vendor/wallet-modal.css', css.replace(/@import url\([^)]*fonts\.googleapis\.com[^)]*\);?\s*/g, ''));

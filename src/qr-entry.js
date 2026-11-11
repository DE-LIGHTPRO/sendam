// Bundled into vendor/qr.js by `npm run vendor`. Draws a QR code as SVG markup.
import qrcode from 'qrcode-generator';

export function qrSvg(text, cell = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin: 0, scalable: true });
}

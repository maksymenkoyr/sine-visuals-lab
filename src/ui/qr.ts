import qrcode from "qrcode-generator";

/**
 * Draws `text` as a QR code into `canvas`, sized as close to `targetSizePx`
 * as an integer cell size allows (kept pixel-aligned so modules stay crisp
 * on a TV rather than blurring under CSS upscaling).
 */
export function drawQrCode(canvas: HTMLCanvasElement, text: string, targetSizePx: number): void {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const cellSize = Math.max(1, Math.floor(targetSizePx / moduleCount));
  const size = cellSize * moduleCount;

  canvas.width = size;
  canvas.height = size;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  qr.renderTo2dContext(ctx, cellSize);
}

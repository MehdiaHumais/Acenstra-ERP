// @ts-nocheck
import fs from "node:fs";
import { PNG } from "pngjs";
import {
  MultiFormatReader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer,
  GlobalHistogramBinarizer, InvertedLuminanceSource, DecodeHintType, BarcodeFormat,
} from "@zxing/library";

const file = process.argv[2] ?? "E:/pictures/barcodes/1.PNG";
const png = PNG.sync.read(fs.readFileSync(file));
const { width, height, data } = png;
console.log(`Image: ${width} x ${height}, bytes: ${data.length}`);

function toLuminance(scale = 1) {
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height / 1 * scale));
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const i = (sy * width + sx) * 4;
      out[y * w + x] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    }
  }
  return { data: out, width: w, height: h };
}

function rotate(src, degrees) {
  const { data: d, width: w, height: h } = src;
  if (degrees === 0) return src;
  const out = new Uint8ClampedArray(d.length);
  if (degrees === 180) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(h - 1 - y) * w + (w - 1 - x)] = d[y * w + x];
    return { data: out, width: w, height: h };
  }
  const nw = h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = d[y * w + x];
    if (degrees === 90) out[x * nw + (h - 1 - y)] = v;
    else out[(w - 1 - x) * nw + y] = v;
  }
  return { data: out, width: nw, height: w };
}

const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE,
]);
hints.set(DecodeHintType.TRY_HARDER, true);

function tryDecode(luma, label) {
  for (const deg of [0, 90, 180, 270]) {
    const f = rotate(luma, deg);
    const base = new RGBLuminanceSource(f.data, f.width, f.height);
    for (const [sname, src] of [["normal", base], ["inverted", new InvertedLuminanceSource(base)]]) {
      for (const [bname, B] of [["hybrid", HybridBinarizer], ["global", GlobalHistogramBinarizer]]) {
        const reader = new MultiFormatReader();
        reader.setHints(hints);
        try {
          const r = reader.decode(new BinaryBitmap(new B(src)));
          console.log(`  ${label} | ${deg}° ${sname} ${bname} -> ${r.getText()} (${BarcodeFormat[r.getBarcodeFormat()]})`);
          return true;
        } catch { /* next */ }
      }
    }
  }
  return false;
}

console.log("\n--- native size ---");
if (!tryDecode(toLuminance(1), "1x")) {
  console.log("  no decode at 1x");
}
for (const scale of [2, 3, 4]) {
  console.log(`\n--- upscaled ${scale}x ---`);
  if (tryDecode(toLuminance(scale), `${scale}x`)) break;
  console.log(`  no decode at ${scale}x`);
}
process.exit(0);

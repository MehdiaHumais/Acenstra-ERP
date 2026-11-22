// @ts-nocheck
import { MultiFormatReader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer, DecodeHintType, BarcodeFormat } from "@zxing/library";

const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

function ean13Bits(code) {
  const d = code.split("").map(Number);
  let bits = "101";
  const parity = PARITY[d[0]];
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + "101";
}

function render(code, module = 4, height = 100, quiet = 12) {
  const bits = "0".repeat(quiet) + ean13Bits(code) + "0".repeat(quiet);
  const width = bits.length * module;
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = bits[Math.floor(x / module)] === "1" ? 0 : 255;
    }
  }
  return { data, width, height };
}

function rotate(src, degrees) {
  const { data, width, height } = src;
  if (degrees === 0) return src;
  if (degrees === 180) {
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[(height - 1 - y) * width + (width - 1 - x)] = data[y * width + x];
    return { data: out, width, height };
  }
  const out = new Uint8ClampedArray(data.length);
  const nw = height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = data[y * width + x];
    if (degrees === 90) out[x * nw + (height - 1 - y)] = v;
    else out[(width - 1 - x) * nw + y] = v;
  }
  return { data: out, width: nw, height: width };
}

function decode(frame) {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  const source = new RGBLuminanceSource(frame.data, frame.width, frame.height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  return reader.decode(bitmap).getText();
}

const img = render("3017620422003");

// Simulate the OLD broken path: raw RGBA bytes handed to RGBLuminanceSource.
const rgba = new Uint8ClampedArray(img.width * img.height * 4);
for (let p = 0, i = 0; p < img.data.length; p++, i += 4) {
  rgba[i] = rgba[i + 1] = rgba[i + 2] = img.data[p];
  rgba[i + 3] = 255;
}
try {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  const source = new RGBLuminanceSource(rgba, img.width, img.height);
  const result = reader.decode(new BinaryBitmap(new HybridBinarizer(source))).getText();
  console.log(`OLD raw-RGBA path -> ${result} (unexpected success)`);
} catch {
  console.log("OLD raw-RGBA path -> FAILED (this is the bug that was fixed)");
}

for (const deg of [0, 90, 180, 270]) {
  try {
    const result = decode(rotate(img, deg));
    console.log(`rotation ${deg}° -> ${result} ${result === "3017620422003" ? "OK" : "MISMATCH"}`);
  } catch (e) {
    console.log(`rotation ${deg}° -> FAILED (${e?.name ?? e.message})`);
  }
}
process.exit(0);

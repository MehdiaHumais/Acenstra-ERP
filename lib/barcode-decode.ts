/**
 * Shared ZXing barcode decoding pipeline used by both the existing Scan &
 * Barcodes workbench and the Add Product "Take Barcode Photo" flow.
 *
 * This is a real 1-D/2-D barcode decoder — no AI/image-recognition fallback.
 */

export interface BarcodeDecodeResult {
  barcode: string;
  format: string;
}

type Luma = { data: Uint8ClampedArray; width: number; height: number };

const CANONICAL_FORMATS = [
  "EAN-13",
  "EAN-8",
  "UPC-A",
  "UPC-E",
  "CODE128",
  "CODE39",
  "ITF",
  "QR",
] as const;

export function canonicalBarcodeFormat(format: unknown): string {
  const raw = String(format ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]+/g, "");
  switch (raw) {
    case "EAN13": return "EAN-13";
    case "EAN8": return "EAN-8";
    case "UPCA": return "UPC-A";
    case "UPCE": return "UPC-E";
    case "CODE128": return "CODE128";
    case "CODE39": return "CODE39";
    case "ITF":
    case "CODE93": return "ITF";
    case "QRCODE":
    case "QR": return "QR";
    default: return (CANONICAL_FORMATS as readonly string[]).includes(raw) ? raw : "CODE128";
  }
}

function toLuminance(imgData: ImageData): Luma {
  const { data, width, height } = imgData;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return { data: out, width, height };
}

function rotateLuma(src: Luma, degrees: number): Luma {
  const { data, width, height } = src;
  if (degrees === 0) return src;
  if (degrees === 180) {
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        out[(height - 1 - y) * width + (width - 1 - x)] = data[y * width + x];
      }
    }
    return { data: out, width, height };
  }
  const out = new Uint8ClampedArray(data.length);
  const newWidth = height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = data[y * width + x];
      if (degrees === 90) out[x * newWidth + (height - 1 - y)] = value;
      else out[(width - 1 - x) * newWidth + y] = value;
    }
  }
  return { data: out, width: newWidth, height: width };
}

/** Decode a canvas frame. `exhaustive=true` tries rotations + inverted images
 *  + both binarizers (best for captured photos); false is the fast camera path. */
export async function decodeCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  exhaustive: boolean,
): Promise<BarcodeDecodeResult | null> {
  const ZXing = await import("@zxing/library");
  const luma = toLuminance(ctx.getImageData(0, 0, width, height));
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.ITF,
    ZXing.BarcodeFormat.QR_CODE,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(hints);
  const binarizers = exhaustive
    ? [ZXing.HybridBinarizer, ZXing.GlobalHistogramBinarizer]
    : [ZXing.HybridBinarizer];
  const rotations = exhaustive ? [0, 90, 180, 270] : [0, 90];

  for (const degrees of rotations) {
    const frame = rotateLuma(luma, degrees);
    const source = new ZXing.RGBLuminanceSource(frame.data, frame.width, frame.height);
    const sources = exhaustive ? [source, new ZXing.InvertedLuminanceSource(source)] : [source];
    for (const input of sources) {
      for (const Binarizer of binarizers) {
        try {
          const bitmap = new ZXing.BinaryBitmap(new Binarizer(input));
          const result = reader.decode(bitmap);
          const text = result?.getText?.();
          if (text) {
            const rawFormat = result?.getBarcodeFormat?.();
            return { barcode: text, format: canonicalBarcodeFormat(rawFormat) };
          }
        } catch {
          // NotFoundException — try the next orientation/strategy.
        }
        reader.reset();
      }
    }
  }
  return null;
}

/** Lightweight image-quality check. It never blocks decoding; it only warns the
 *  user that a retake may improve results for dark or low-contrast photos. */
export function assessImageQuality(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): string | null {
  const luma = toLuminance(ctx.getImageData(0, 0, width, height));
  let sum = 0;
  for (let i = 0; i < luma.data.length; i++) sum += luma.data[i];
  const mean = sum / Math.max(1, luma.data.length);
  if (mean < 48) return "The photo looks very dark. Try better lighting, then retake.";

  let squares = 0;
  for (let i = 0; i < luma.data.length; i++) {
    const delta = luma.data[i] - mean;
    squares += delta * delta;
  }
  const variance = squares / Math.max(1, luma.data.length);
  if (variance < 45) return "The photo has very low contrast. Hold steady and retake closer to the barcode.";

  let edges = 0;
  let samples = 0;
  for (let y = 0; y < luma.height; y += 2) {
    for (let x = 1; x < luma.width; x += 2) {
      edges += Math.abs(luma.data[y * luma.width + x] - luma.data[y * luma.width + x - 1]);
      samples++;
    }
  }
  if (samples > 0 && edges / samples < 2.5) {
    return "The barcode looks blurry or out of focus. Retake with the barcode square to the camera.";
  }
  return null;
}

/** Decode a captured/uploaded image file with the exhaustive photo strategy. */
export async function decodeBarcodeFromFile(
  file: Blob,
): Promise<{ ok: true; result: BarcodeDecodeResult; warning: string | null } | { ok: false; error: string }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read that image."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(1, image.naturalWidth || image.width || 1024));
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width || 1) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height || 1) * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { ok: false, error: "Could not read the image." };
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const warning = assessImageQuality(ctx, canvas.width, canvas.height);
    const result = await decodeCanvas(ctx, canvas.width, canvas.height, true);
    if (!result) {
      return {
        ok: false,
        error: warning
          ? `No barcode detected. ${warning}`
          : "No barcode detected. Move closer, avoid glare, and make sure the full barcode is visible.",
      };
    }
    return { ok: true, result, warning };
  } catch {
    return { ok: false, error: "Could not process that image. Use a clear JPG or PNG photo of the barcode." };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decode a still frame captured from the camera video element. */
export async function decodeBarcodeFromCanvas(
  canvas: HTMLCanvasElement,
): Promise<{ ok: true; result: BarcodeDecodeResult; warning: string | null } | { ok: false; error: string }> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ok: false, error: "Could not read the captured photo." };
  const warning = assessImageQuality(ctx, canvas.width, canvas.height);
  const result = await decodeCanvas(ctx, canvas.width, canvas.height, true);
  if (!result) {
    return {
      ok: false,
      error: warning
        ? `No barcode detected. ${warning}`
        : "No barcode detected. Fill the frame with the barcode and retake.",
    };
  }
  return { ok: true, result, warning };
}

// ---------------------------------------------------------------------------
// Validation (mirrors the server rules so bad codes never reach lookup)
// ---------------------------------------------------------------------------

export function normalizeDecodedBarcode(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]+/g, "");
}

function checksumValid(barcode: string, weights: number[]): boolean {
  const digits = barcode.split("").map(Number);
  if (digits.some((n) => !Number.isInteger(n))) return false;
  const check = digits[digits.length - 1];
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += digits[i] * weights[i];
  return (10 - (sum % 10)) % 10 === check;
}

function alternatingWeights(length: number): number[] {
  return Array.from({ length }, (_, i) => (i % 2 === 1 ? 3 : 1));
}

/** UPC-A checks odd positions (1-indexed) with 3 and even with 1 — the
 *  opposite of EAN-13's 12-digit body. */
function upcAWeights(length: number): number[] {
  return Array.from({ length }, (_, i) => (i % 2 === 0 ? 3 : 1));
}

export function validateDecodedBarcode(
  raw: unknown,
  formatHint?: unknown,
): { ok: true; barcode: string; format: string } | { ok: false; error: string } {
  const barcode = normalizeDecodedBarcode(raw);
  const format = canonicalBarcodeFormat(formatHint);
  if (!barcode) return { ok: false, error: "Enter or scan a barcode first." };
  if (barcode.length < 8 || barcode.length > 128) {
    return { ok: false, error: "Barcode must be between 8 and 128 characters." };
  }

  if (format === "EAN-13") {
    if (!/^\d{13}$/.test(barcode)) return { ok: false, error: "EAN-13 must be exactly 13 digits." };
    if (!checksumValid(barcode, alternatingWeights(12))) {
      return { ok: false, error: "EAN-13 check digit is invalid. Retake the photo or enter the number manually." };
    }
  } else if (format === "EAN-8") {
    if (!/^\d{8}$/.test(barcode)) return { ok: false, error: "EAN-8 must be exactly 8 digits." };
    if (!checksumValid(barcode, [3, 1, 3, 1, 3, 1, 3])) {
      return { ok: false, error: "EAN-8 check digit is invalid. Retake the photo or enter the number manually." };
    }
  } else if (format === "UPC-A") {
    if (!/^\d{12}$/.test(barcode)) return { ok: false, error: "UPC-A must be exactly 12 digits." };
    if (!checksumValid(barcode, upcAWeights(11))) {
      return { ok: false, error: "UPC-A check digit is invalid. Retake the photo or enter the number manually." };
    }
  } else if (format === "UPC-E") {
    if (!/^\d{8}$/.test(barcode) || !/^[01]/.test(barcode)) {
      return { ok: false, error: "UPC-E must be 8 digits starting with 0 or 1." };
    }
  } else if (!formatHint) {
    if (/^\d{13}$/.test(barcode) && !checksumValid(barcode, alternatingWeights(12))) {
      return { ok: false, error: "Barcode check digit is invalid. Retake the photo or enter the number manually." };
    }
    if (/^\d{12}$/.test(barcode) && !checksumValid(barcode, upcAWeights(11))) {
      return { ok: false, error: "Barcode check digit is invalid. Retake the photo or enter the number manually." };
    }
    if (/^\d{8}$/.test(barcode) && !checksumValid(barcode, [3, 1, 3, 1, 3, 1, 3])) {
      return { ok: false, error: "Barcode check digit is invalid. Retake the photo or enter the number manually." };
    }
  }

  return { ok: true, barcode, format };
}

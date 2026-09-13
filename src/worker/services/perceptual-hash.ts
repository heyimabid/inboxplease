import jpeg from 'jpeg-js';
import { decode as decodePng } from 'fast-png';
export function decodeRaster(bytes: ArrayBuffer, type: string) {
  try {
    let width: number,
      height: number,
      data: Uint8Array | Uint16Array | Uint8ClampedArray,
      channels: number;
    if (type === 'image/jpeg') {
      const decoded = jpeg.decode(new Uint8Array(bytes), {
        useTArray: true,
        formatAsRGBA: true,
        tolerantDecoding: false,
        maxResolutionInMP: 4,
        maxMemoryUsageInMB: 32,
      });
      ({ width, height, data } = decoded);
      channels = 4;
    } else if (type === 'image/png') {
      const view = new DataView(bytes);
      if (
        bytes.byteLength < 33 ||
        view.getUint32(16) * view.getUint32(20) > 4000000 ||
        view.getUint8(24) !== 8
      )
        return null;
      let offset = 8;
      while (offset + 12 <= bytes.byteLength) {
        const length = view.getUint32(offset);
        if (length > bytes.byteLength - offset - 12) return null;
        const kind = String.fromCharCode(...new Uint8Array(bytes, offset + 4, 4));
        if (['iCCP', 'zTXt', 'iTXt', 'acTL'].includes(kind)) return null;
        offset += length + 12;
      }
      const decoded = decodePng(new Uint8Array(bytes), { checkCrc: true });
      ({ width, height, data, channels } = decoded);
      if (decoded.depth !== 8 || channels < 3) return null;
    } else return null;
    if (!width || !height || width * height > 4000000) return null;
    return { width, height, data, channels };
  } catch {
    return null;
  }
}

export function perceptualHash(bytes: ArrayBuffer, type: string): string | null {
  const raster = decodeRaster(bytes, type);
  if (!raster) return null;
  const { width, height, data, channels } = raster;
  const gray = (x: number, y: number) => {
    const i =
      (Math.min(height - 1, Math.floor((y * height) / 8)) * width +
        Math.min(width - 1, Math.floor((x * width) / 9))) *
      channels;
    return (data[i] ?? 0) * 0.299 + (data[i + 1] ?? 0) * 0.587 + (data[i + 2] ?? 0) * 0.114;
  };
  let hash = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) hash = (hash << 1n) | (gray(x, y) > gray(x + 1, y) ? 1n : 0n);
  return hash.toString(16).padStart(16, '0');
}

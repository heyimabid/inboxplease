import jpeg from 'jpeg-js';
import { encode as encodePng } from 'fast-png';
import { decodeRaster } from './perceptual-hash';
// Re-encoding bounded, supported rasters drops EXIF/text metadata. Keep original
// bytes privately for exact-file evidence. Unsupported formats retain the original.
export function deliveryImage(original: ArrayBuffer, type: string) {
  const raster = decodeRaster(original, type);
  if (!raster) return { bytes: original, type };
  const scale = Math.min(1, 1024 / Math.max(raster.width, raster.height));
  const width = Math.max(1, Math.round(raster.width * scale)),
    height = Math.max(1, Math.round(raster.height * scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source =
        (Math.min(raster.height - 1, Math.floor(y / scale)) * raster.width +
          Math.min(raster.width - 1, Math.floor(x / scale))) *
        raster.channels;
      const target = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[target + c] = raster.data[source + c] ?? 0;
      data[target + 3] = raster.channels === 4 ? (raster.data[source + 3] ?? 255) : 255;
    }
  const encoded =
    type === 'image/jpeg'
      ? jpeg.encode({ width, height, data }, 82).data
      : encodePng({ width, height, data, channels: 4 });
  return { bytes: new Uint8Array(encoded).buffer, type };
}

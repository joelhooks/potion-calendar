import { crc32, deflateSync } from "node:zlib";

const chunk = (kind: string, content: Uint8Array): Buffer => {
  const data = Buffer.concat([Buffer.from(kind, "ascii"), content]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(content.length);
  checksum.writeUInt32BE(crc32(data));

  return Buffer.concat([length, data, checksum]);
};

export const iconPng = (
  pixels: Uint8Array,
  width: number,
  height: number
): Buffer => {
  if (pixels.length !== width * height * 4 || width < 1 || height < 1) {
    throw new RangeError("Invalid icon dimensions");
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);

  for (let row = 0; row < height; row += 1) {
    rows.set(
      pixels.subarray(row * width * 4, (row + 1) * width * 4),
      row * (width * 4 + 1) + 1
    );
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

export const calendarDotPng = (color: string): Buffer => {
  const hex = /^#[\da-f]{6}$/iu.test(color) ? color.slice(1) : "64748b";
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const pixels = Buffer.alloc(16 * 16 * 4);

  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      if ((x - 7.5) ** 2 + (y - 7.5) ** 2 <= 36) {
        pixels.set([red, green, blue, 255], (y * 16 + x) * 4);
      }
    }
  }

  return iconPng(pixels, 16, 16);
};

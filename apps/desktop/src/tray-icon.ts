import { crc32, deflateSync } from "node:zlib";

import { DateTime } from "effect";

import { trayAgenda } from "./agenda.js";
import type { NativeView } from "./native-host.js";

export const trayIconLogicalSize = 16;

export const trayIconStandardScale = 1;

export const trayIconRetinaScale = 2;

export const trayIconTemplate = true;

export const trayIconDateZone = DateTime.zoneMakeLocal;

export const trayIconRolloverPolicy = "existing-host-render";

export const trayIconDeclinedResponse = "date-only";

export const trayIconDigitScaleByRepresentation = { 1: 1, 2: 2 };

export const trayIconDateDigits: ReadonlyMap<string, readonly string[]> =
  new Map([
    ["0", ["111", "101", "101", "101", "111"]],
    ["1", ["010", "110", "010", "010", "111"]],
    ["2", ["111", "001", "111", "100", "111"]],
    ["3", ["111", "001", "111", "001", "111"]],
    ["4", ["101", "101", "111", "001", "001"]],
    ["5", ["111", "100", "111", "001", "111"]],
    ["6", ["111", "100", "111", "101", "111"]],
    ["7", ["111", "001", "010", "010", "010"]],
    ["8", ["111", "101", "111", "101", "111"]],
    ["9", ["111", "101", "111", "001", "111"]],
  ]);

export const trayIconGlyphStyle: Readonly<
  Record<"accepted" | "tentative" | "unanswered", readonly string[]>
> = {
  accepted: ["00001", "00010", "10100", "01000", "00000"],
  tentative: ["01110", "00010", "00100", "00000", "00100"],
  unanswered: ["01110", "10001", "10001", "10001", "01110"],
};

export interface TrayIconState {
  readonly day: number;
  readonly mark: "date-only" | "accepted" | "tentative" | "unanswered";
}

export const trayIconState = (view: NativeView): TrayIconState => {
  const { current } = trayAgenda(view.agenda, view.preferences, view.now);
  const response = current?.rsvp?.response;

  const instant = DateTime.makeZonedUnsafe(view.now, {
    timeZone: trayIconDateZone(),
  });

  let mark: TrayIconState["mark"] = "date-only";

  if (response === "accepted" || response === "tentative") {
    mark = response;
  } else if (response === null || response === "needsAction") {
    mark = "unanswered";
  } else if (response === "declined") {
    mark = trayIconDeclinedResponse;
  }

  return { day: DateTime.toParts(instant).day, mark };
};

const paintGlyph = (
  mask: Uint8Array,
  glyph: readonly string[],
  left: number,
  top: number
): void => {
  for (const [y, row] of glyph.entries()) {
    for (const [x, bit] of row.split("").entries()) {
      if (bit === "1") {
        mask[(top + y) * trayIconLogicalSize + left + x] = 255;
      }
    }
  }
};

const calendarFrame = (x: number, y: number): boolean =>
  y >= 3 && (x === 1 || x === 13 || y === 3 || y === 6 || y === 14);

const trayIconMask = (model: TrayIconState): Uint8Array => {
  const mask = new Uint8Array(trayIconLogicalSize ** 2);

  for (let y = 1; y <= 14; y += 1) {
    for (let x = 1; x <= 13; x += 1) {
      const frame = calendarFrame(x, y);
      const rings = (x === 4 || x === 10) && y <= 4;
      const badgeSpace = model.mark !== "date-only" && x >= 10 && y >= 10;

      if ((frame || rings) && !badgeSpace) {
        mask[y * trayIconLogicalSize + x] = 255;
      }
    }
  }

  const digits = String(model.day);
  const left = 3 + Math.floor((7 - (digits.length * 4 - 1)) / 2);

  for (const [index, digit] of digits.split("").entries()) {
    const glyph = trayIconDateDigits.get(digit);

    if (glyph === undefined) {
      throw new RangeError("Unsupported tray date digit");
    }

    paintGlyph(mask, glyph, left + index * 4, 8);
  }

  if (model.mark !== "date-only") {
    const badge = trayIconGlyphStyle[model.mark];

    paintGlyph(mask, badge, 11, 11);
  }

  return mask;
};

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

export const trayIconPng = (model: TrayIconState, scale: 1 | 2): Buffer => {
  const mask = trayIconMask(model);
  const width = trayIconLogicalSize * scale;
  const pixels = Buffer.alloc(width ** 2 * 4);
  const stroke = trayIconDigitScaleByRepresentation[scale];

  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[(y * width + x) * 4 + 3] =
        mask[
          Math.floor(y / stroke) * trayIconLogicalSize + Math.floor(x / stroke)
        ] ?? 0;
    }
  }

  return iconPng(pixels, width, width);
};

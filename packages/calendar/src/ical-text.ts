const utf8 = new TextEncoder();

export const escapeIcsText = (value: string): string =>
  value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");

export const foldIcsLine = (line: string): string => {
  const fragments: string[] = [];
  let octets = 0;

  for (const point of line) {
    const width = utf8.encode(point).byteLength;

    if (octets + width > 75) {
      fragments.push("\r\n ");
      octets = 1;
    }

    fragments.push(point);
    octets += width;
  }

  return fragments.join("");
};

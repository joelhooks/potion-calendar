import { conferenceLink } from "./conferencing.js";
import type { LocationMaps } from "./location-maps.js";

export const ordinaryLink = (value: string): string | undefined => {
  if (
    // oxlint-disable-next-line eslint/no-control-regex -- URL parsing can discard control bytes; refuse them before normalization.
    /[\s\u0000-\u001F\u007F-\u009F\\]/u.test(value) ||
    !/^(?:https?:\/\/|mailto:)/iu.test(value)
  ) {
    return undefined;
  }

  const parsed = URL.parse(value);

  if (parsed === null || parsed.username !== "" || parsed.password !== "") {
    return undefined;
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return parsed.hostname === "" ? undefined : parsed.href;
  }

  return parsed.protocol === "mailto:" &&
    parsed.pathname.includes("@") &&
    !/%0[ad]/iu.test(value)
    ? parsed.href
    : undefined;
};

export const eventLinkLabel = (href: string, label: string): string =>
  href.startsWith("mailto:") && /^mailto:/iu.test(label)
    ? (label.slice(7).split("?")[0] ?? label)
    : label;

export const attachmentKind = (
  mimeType: string | undefined
): string | undefined => {
  switch (mimeType?.toLowerCase()) {
    case undefined: {
      return undefined;
    }

    case "application/pdf": {
      return "PDF";
    }

    case "application/msword":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.google-apps.document":
    case "text/plain": {
      return "Document";
    }

    case "application/vnd.ms-excel":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.google-apps.spreadsheet": {
      return "Spreadsheet";
    }

    case "application/vnd.ms-powerpoint":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    case "application/vnd.google-apps.presentation": {
      return "Slides";
    }

    case "text/html": {
      return "Web page";
    }

    default: {
      return mimeType?.toLowerCase().startsWith("image/") === true
        ? "Image"
        : undefined;
    }
  }
};

export interface EventTextPart {
  readonly text: string;
  readonly href?: string;
}

const trimUnmatchedClosing = (
  text: string,
  open: string,
  close: string
): string => {
  let result = text;

  while (
    result.endsWith(close) &&
    result.split(close).length > result.split(open).length
  ) {
    result = result.slice(0, -1);
  }

  return result;
};

export const eventTextLinks = (text: string): readonly EventTextPart[] =>
  (text.match(/\s+|\S+/gu) ?? []).flatMap((token) => {
    const candidate = trimUnmatchedClosing(
      trimUnmatchedClosing(
        trimUnmatchedClosing(token.replace(/[.,;!]+$/u, ""), "(", ")"),
        "[",
        "]"
      ),
      "{",
      "}"
    );

    const href = ordinaryLink(candidate);

    if (
      href === undefined ||
      conferenceLink(undefined, candidate) !== undefined
    ) {
      return [{ text: token }];
    }

    const suffix = token.slice(candidate.length);

    return [
      { href, text: candidate },
      ...(suffix === "" ? [] : [{ text: suffix }]),
    ];
  });

export const mapsLocation = (
  location: string,
  choice: typeof LocationMaps.Type = "google"
): string | undefined => {
  if (
    location.trim() === "" ||
    location.includes("://") ||
    /^[a-z][a-z\d+.-]*:/iu.test(location.trim())
  ) {
    return undefined;
  }

  const query = encodeURIComponent(
    location.trim().replaceAll(/[\uD800-\uDFFF]/gu, "\uFFFD")
  );

  return choice === "apple"
    ? `https://maps.apple.com/search?query=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
};

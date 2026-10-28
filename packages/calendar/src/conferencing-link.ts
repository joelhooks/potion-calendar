import { containsCustomVideoLink } from "./custom-video-link.js";
import type { CustomVideoLink } from "./custom-video-link.js";

const recognized = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "teams.live.com",
  "webex.com",
  "whereby.com",
  "doxy.me",
];

const webUrl = (candidate: string): string | undefined => {
  if (!URL.canParse(candidate)) {
    return undefined;
  }

  const url = new URL(candidate);

  return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
};

export const conferenceLink = (
  native?: string,
  location?: string,
  description?: string,
  customVideoLinks: readonly (typeof CustomVideoLink.Type)[] = []
): string | undefined => {
  const explicit = native === undefined ? undefined : webUrl(native);

  if (explicit !== undefined) {
    return explicit;
  }

  const candidates =
    `${location ?? ""}\n${description ?? ""}`.match(
      /https?:\/\/[^\s<>"']+/gu
    ) ?? [];

  for (const candidate of candidates) {
    const link = webUrl(candidate.replace(/[),.;]+$/u, ""));

    if (link === undefined) {
      continue;
    }

    const { hostname } = new URL(link);

    if (
      recognized.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
      )
    ) {
      return link;
    }
  }

  return customVideoLinks.find((entry) =>
    containsCustomVideoLink(description, entry.link)
  )?.link;
};

export type ParticipantEmailComposition =
  | {
      readonly kind: "ready";
      readonly href: string;
      readonly recipients: readonly string[];
    }
  | { readonly kind: "disabled"; readonly reason?: string };

const wellFormed = (value: string): boolean => {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;

    if (point >= 0xd8_00 && point <= 0xdf_ff) {
      return false;
    }
  }

  return true;
};

export const composeParticipantEmail = (
  title: string,
  recipients: readonly string[]
): ParticipantEmailComposition => {
  if (
    recipients.length === 0 ||
    !wellFormed(title) ||
    recipients.some((email) => !wellFormed(email))
  ) {
    return { kind: "disabled" };
  }

  const href = `mailto:${recipients.map((email) => encodeURIComponent(email).replaceAll("%40", "@")).join(",")}?subject=${encodeURIComponent(title)}`;

  if (href.length > 2000) {
    return { kind: "disabled", reason: "Too many guests to email from here." };
  }

  const parsed = URL.parse(href);

  if (
    parsed === null ||
    parsed.protocol !== "mailto:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !parsed.pathname.includes("@") ||
    /%0[ad]/iu.test(href)
  ) {
    return { kind: "disabled" };
  }

  return { href, kind: "ready", recipients };
};

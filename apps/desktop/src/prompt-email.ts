import type { AgendaEventValue } from "@calendar/core/desktop-bridge";

export const promptEmailUrl = (event: AgendaEventValue): string | undefined => {
  const recipients = event.participantEmails ?? [];

  if (recipients.length === 0) {
    return undefined;
  }

  try {
    const href = `mailto:${recipients.map((email) => encodeURIComponent(email).replaceAll("%40", "@")).join(",")}?subject=${encodeURIComponent(event.title)}`;

    return href.length <= 2000 ? href : undefined;
  } catch {
    return undefined;
  }
};

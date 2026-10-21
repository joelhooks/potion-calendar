import type { CalendarEventValue } from "@calendar/calendar/contracts";
import type { Html, HtmlBuilder } from "foldkit/html";

import { browserMapsPlatform } from "../client/settings/maps-platform.js";
import {
  attachmentKind,
  eventLinkLabel,
  eventTextLinks,
  mapsLocation,
  ordinaryLink,
} from "../layout/event-links.js";
import type { LocationMaps } from "../layout/location-maps.js";
import { effectiveLocationMaps } from "../layout/location-maps.js";

export const externalEventLink = <Message>(
  h: HtmlBuilder<Message>,
  href: string,
  label: string
): Html =>
  h.a(
    [
      h.Href(href),
      h.Target("_blank"),
      h.Rel("noopener noreferrer"),
      h.Style({
        color: "inherit",
        "overflow-wrap": "anywhere",
        "text-underline-offset": "2px",
      }),
    ],
    [eventLinkLabel(href, label)]
  );

export const eventLinkedText = <Message>(
  h: HtmlBuilder<Message>,
  text: string
): Html =>
  h.span(
    [h.Style({ "overflow-wrap": "anywhere", "white-space": "pre-wrap" })],
    eventTextLinks(text).map((part) =>
      part.href === undefined
        ? part.text
        : externalEventLink(h, part.href, part.text)
    )
  );

export const locationMap = <Message>(
  h: HtmlBuilder<Message>,
  location: string,
  choice: typeof LocationMaps.Type = "google"
): readonly Html[] => {
  const effective = effectiveLocationMaps(choice, browserMapsPlatform());
  const href = mapsLocation(location, effective);

  const label =
    effective === "apple" ? "Open in Apple Maps ↗" : "Open in Google Maps ↗";

  return href === undefined ? [] : [externalEventLink(h, href, label)];
};

export const eventAttachments = <Message>(
  h: HtmlBuilder<Message>,
  event: Pick<CalendarEventValue, "attachments" | "eventType">
): readonly Html[] => {
  if (event.eventType === "outOfOffice" || event.attachments?.length === 0) {
    return [];
  }

  if (event.attachments === undefined) {
    return [];
  }

  return [
    h.section(
      [
        h.Class("event-attachments"),
        h.AriaLabel("Attachments"),
        h.Style({ "min-width": "0", "overflow-wrap": "anywhere" }),
      ],
      [
        h.h3([], ["Attachments"]),
        h.ul(
          [h.Style({ "list-style": "none", margin: "0", padding: "0" })],
          event.attachments.map((attachment) => {
            const href = ordinaryLink(attachment.url);
            const title = attachment.title?.trim() ?? "";
            const kind = attachmentKind(attachment.mimeType);

            const blockedTitle =
              title === "" || title === attachment.url ? "Attachment" : title;

            const label = title === "" ? attachment.url : title;

            return h.li(
              [
                h.Style({
                  border: "0",
                  display: "block",
                  "margin-bottom": "10px",
                  padding: "0",
                }),
              ],
              [
                h.span([h.AriaHidden(true)], ["▤ "]),
                ...(href === undefined
                  ? [
                      h.span(
                        [],
                        [
                          `${blockedTitle} · This file can't be opened from here.`,
                        ]
                      ),
                    ]
                  : [
                      externalEventLink(h, href, `${label} ↗`),
                      ...(kind === undefined
                        ? []
                        : [h.span([h.Class("muted")], [` · ${kind}`])]),
                    ]),
              ]
            );
          })
        ),
      ]
    ),
  ];
};

export const editorLinks = <Message>(
  h: HtmlBuilder<Message>,
  event: Pick<
    CalendarEventValue,
    "attachments" | "eventType" | "location" | "description"
  >,
  choice: typeof LocationMaps.Type = "google"
): Html => {
  const omitted = event.eventType === "outOfOffice";

  const parts = omitted
    ? []
    : eventTextLinks(
        `${event.location ?? ""}\n${event.description ?? ""}`
      ).filter((part) => part.href !== undefined);

  return h.section(
    [
      h.Id("event-links"),
      h.Tabindex(-1),
      h.Class("editor-section"),
      h.AriaLabel("Links and attachments"),
      h.Style({ "overflow-wrap": "anywhere" }),
    ],
    [
      h.h3([], ["Links and attachments"]),
      ...(omitted
        ? [
            h.p(
              [h.Class("editor-hint")],
              [
                "Links and attachments are not available for out-of-office events.",
              ]
            ),
          ]
        : [
            ...parts.map((part) =>
              h.p(
                [],
                [
                  part.href === undefined
                    ? part.text
                    : externalEventLink(h, part.href, part.text),
                ]
              )
            ),
            ...locationMap(h, event.location ?? "", choice),
            ...eventAttachments(h, event),
            ...(parts.length === 0 && (event.attachments?.length ?? 0) === 0
              ? [
                  h.p(
                    [h.Class("editor-hint")],
                    [
                      "Links in Location or Description appear here. Attachments are read-only.",
                    ]
                  ),
                ]
              : []),
          ]),
    ]
  );
};

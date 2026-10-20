import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { eventKey } from "../client/calendar-state.js";
import { contextMeeting } from "../client/meetings/candidates.js";
import { savedMeetings } from "../client/meetings/source.js";
import { dayInZone, partsFromDay } from "../layout/navigation.js";
import { eventWhen, visibleEvents } from "../layout/presentation.js";
import { resolvedTimeFormat } from "../layout/time-format.js";

export const upcomingMeetingPanel = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  if (visibleEvents(model).some((event) => event.selected)) {
    return [];
  }

  const read = model.upcoming.data;

  const candidate = contextMeeting(
    savedMeetings(model),
    model.calendar.now,
    model.settings.upcomingMeetingMinutes
  );

  const notices = AsyncData.match(read, {
    onFailure: (error) => [h.p([h.Role("alert")], [error.message])],
    onIdle: () => [h.p([h.Role("status")], ["Loading upcoming meetings…"])],
    onLoading: () => [h.p([h.Role("status")], ["Loading upcoming meetings…"])],
    onRefreshing: () => [],
    onStale: ({ error }) => [h.p([h.Role("alert")], [error.message])],
    onSuccess: () => [],
  });

  if (candidate === undefined) {
    return [
      h.aside(
        [
          h.Id("upcoming-meeting"),
          h.Class("upcoming-panel"),
          h.AriaLabel("Upcoming meeting"),
        ],
        [
          h.h2([], ["Upcoming meeting"]),
          ...notices,
          ...(AsyncData.isSuccess(read) || AsyncData.isRefreshing(read)
            ? [h.p([h.Role("status")], ["No upcoming meeting"])]
            : []),
        ]
      ),
    ];
  }

  const key = model.calendar.mergeDuplicates
    ? candidate.item.key
    : eventKey(candidate.item.source);

  const timing = eventWhen(
    candidate.item,
    model.calendar.zone,
    partsFromDay(dayInZone(model.calendar.now, model.calendar.zone)).year,
    resolvedTimeFormat(model)
  );

  return [
    h.aside(
      [
        h.Id("upcoming-meeting"),
        h.Class("upcoming-panel"),
        h.AriaLabel(candidate.item.title),
      ],
      [
        h.p([h.Class("muted upcoming-label")], ["Upcoming meeting"]),
        ...notices,
        h.h2([h.Class("upcoming-title")], [candidate.item.title]),
        h.p([h.Class("detail-date")], [timing.date]),
        ...(timing.time === undefined
          ? []
          : [h.p([h.Class("detail-time")], [timing.time])]),
        h.p([h.Class("muted")], [candidate.item.calendar.title]),
        ...(candidate.conferenceUrl === undefined
          ? [h.p([], ["Meeting has no conferencing"])]
          : []),
        h.div(
          [h.Class("meeting-actions")],
          [
            ...(candidate.conferenceUrl === undefined
              ? []
              : [
                  h.button(
                    [
                      h.OnClick(
                        Message.RequestedJoinMeeting({
                          key: Option.some({
                            accountId: candidate.item.source.accountId,
                            calendarId: candidate.item.source.calendarId,
                            eventId: candidate.item.source.eventId,
                          }),
                        })
                      ),
                    ],
                    ["Join meeting"]
                  ),
                ]),
            h.button(
              [h.OnClick(Message.ClickedEvent({ key }))],
              ["Select event"]
            ),
          ]
        ),
      ]
    ),
  ];
};

# Calendar

Joel's own calendar app, built clean-room from a private product spec. It is a rat-stack app: Effect owns the hard parts, Alchemy declares the Cloudflare footprint, Foldkit draws the UI. It runs at `calendar.wzrrd.sh` behind Joel's Google sign-in, on top of his real Google Calendars.

## Who it serves

One person: Joel, across his Google accounts. Nobody else signs in. There is no signup, no team, no billing.

## What good looks like

- Opening `calendar.wzrrd.sh` shows this week from every connected Google account, fast, and it stays current without a refresh.
- Creating, moving, resizing, editing, deleting and answering events works the way the spec describes, including recurring events.
- Keyboard first: the shortcuts and command menu in `spec/behaviour/` work.
- Nothing emails attendees unless Joel asks it to.
- Later, a thin Electron shell wraps the same app for the desktop.

## Boundaries

- **Clean room.** `spec/` is the only description of the original product. Never read, copy or fetch the original product's code. Build what the spec describes, not Notion's wire protocol: the API between our UI and our Worker is ours to design.
- **Private.** No public repo. `spec/` is derived from a third-party product and stays private with this code.
- **No Notion.** No Notion integration, branding, telemetry or third-party analytics. Spec items about Notion databases, scheduling links and Notion login are out of scope.
- **Google data is Joel's.** Refresh tokens are encrypted at rest; only allowlisted accounts sign in; scopes stay at OpenID profile plus Calendar.

## Deploy posture

Level: 3 (jfdi)

Personal app behind an allowlisted Google sign-in. Deploys run from the operator machine through the Alchemy `default` profile with `pnpm deploy:plan` then `pnpm deploy:prod`. Rollback with `pnpm deploy:rollback`. Watch the live site after every deploy; a broken sign-in or an empty week is a failed deploy.

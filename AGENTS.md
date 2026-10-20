# Agent instructions

Read `VISION.md` before substantial work. Start non-trivial work with `skills/rat-stack-mode`.

`spec/` is the only product description. It is read-only source corpus. Never inspect the original product's code.

## Stack contract

Workspace manifests own the pins. Keep dependencies exact. Record drift instead of migrating the stack.

- Node `>=24.18.0`, pnpm `11.3.0`, pnpm workspaces, Turborepo `2.11.2`.
- Effect and `@effect/platform-node` `4.0.0`. Foldkit shares this runtime family.
- XState `6.0.0-alpha.69` and `@xstate/effect` `1.0.0-alpha.8`.
- Alchemy `2.0.0-beta.83` owns all cloud resources. Credentials come from Alchemy profiles, never provider environment variables.
- Foldkit `0.167.0` owns the browser program.
- Better Auth `1.6.2` owns OAuth, sessions, and account linking.
- TypeScript `7.0.2` in strict mode, patched by `@effect/tsgo` `0.51.1` in `prepare`.
- `@effect/vitest` `4.0.0` owns Effect tests. Use `it.effect`, `it.layer`, and generated properties. Tests must not call `Effect.run*` or `ManagedRuntime.make`.
- Oxlint `1.88.0`, `@oxlint/plugins` `1.88.0`, Oxfmt `0.68.0`, Ultracite `7.12.0`.
- The vendored anti-slop rules in `tools/oxlint/anti-slop/` stay at `error`. `UPSTREAM.md` records their provenance.
- varlock `1.23.0`: declare application keys in `.env.schema`. Never read `.env.local` directly. Run `pnpm env:check` after schema edits.

The base Effect plugin owns diagnostic severity. Child configs may add exact `allowedUnstableApis` for APIs used in that scope. Do not copy severity maps, use subtree prefixes, or ignore compiler warnings.

## Packages

| Package | Path | Job |
| --- | --- | --- |
| `@calendar/capability` | `packages/capability` | Contracts, implementation binding, approval, and projections |
| `@calendar/core` | `packages/core` | Shared session contract and fence tests |
| `@calendar/auth` | `packages/auth` | Google OAuth, allowlist, tokens, and current-person middleware |
| `@calendar/database` | `packages/database` | D1 migrations and database ports |
| `@calendar/devtools` | `packages/devtools` | Development-only capability and actor inspection |
| `@calendar/check-harness` | `packages/check-harness` | Typed check evidence and verdicts |
| `@calendar/deploy` | `packages/deploy` | Profile-only deployment lifecycle and receipt-backed rollback |
| `@calendar/web` | `apps/web` | Foldkit UI, development composition, and production Worker |
| `@calendar/infra` | `apps/infra` | Calendar Alchemy Stack |

`packages/calendar` is the calendar-core lane's scope. That package owns calendar domain contracts and behavior.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install exact workspace dependencies |
| `pnpm dev` | Run the Foldkit app through portless with fake Google |
| `pnpm check` | Frozen lockfile, config validation, typecheck, typed lint, and formatting |
| `pnpm lint` | Typed lint and formatting |
| `pnpm fix` | Intentionally apply safe lint and formatting changes |
| `pnpm env:check` | Validate declared application config |
| `pnpm typecheck` | Workspace compiler checks |
| `pnpm test` | Build dependencies and run Vitest |
| `pnpm build` | Build workspace artifacts |
| `pnpm vendor:agent-sources` | Fetch exact pinned source mirrors |
| `pnpm infra:plan` | Inspect the CalendarProd Stack; requires a profile |
| `pnpm deploy:plan --profile <profile>` | Profile-only classified production plan |
| `pnpm deploy:prod --profile <profile> --yes` | Apply the approved plan, check, and watch |
| `pnpm deploy:rollback --profile <profile> --yes` | Explicitly approved receipt-backed rollback |

Required finish gate: `pnpm turbo run check test build --concurrency=1`.

## Fence

- Lefthook pre-commit runs `pnpm check` and `pnpm test`.
- Never bypass hooks, pass `--no-verify`, or disable the Git interceptor.
- `scripts/vcs-command-policy.js` is the policy source. Pi, Cursor, and Claude integrations enforce it.
- Fix a failing hook. Do not loosen the fence to land a packet.
- `spec/**` is excluded from lint and formatting with desk approval. It is corpus, never runtime code.
- Prefer generated properties for domain rules and command histories for stateful behavior. Plant a broken behavior before trusting a new property.
- Keep example tests for real seams. Do not add tautological tests or change-detector tests.
- Add a lint rule before cleaning up a recurring bad pattern. Follow `skills/gardener` and `skills/uncomplect`.

## Source-first Effect and XState

Read the installed Effect package's `AGENTS.md` before writing or reviewing Effect code. Check the matching pinned source, not remembered APIs.

- Effect: `.agent_sources/github.com/Effect-TS/effect/`.
- XState and the Effect bridge: `.agent_sources/github.com/statelyai/xstate/`.
- Alchemy: `.agent_sources/github.com/alchemy-run/alchemy/` or the installed package source.
- Better Auth: installed source or its exact source mirror.

Use `pnpm vendor:agent-sources` when a needed mirror is missing. Mirrors are reference material, not runtime dependencies. Never commit populated mirror trees.

Finite lifecycles, retries, cancellation, and resumability belong in XState. Start Effect actors with `createEffectActor`; declare side effects with `createEffectLogic`. Never use `createActor` for Effect-backed logic. Observe machines through `watchActor`.

## Architecture

- One contract defines each application action. Schemas own input, output, and failure. `implement` binds one handler; projections expose that implementation.
- `packages/capability` imports no domain implementation. Packages import no application. Browser code imports contracts and the contract-only RPC group, never handlers.
- `apps/web/src/features` reads the Model and sends Messages. It performs no transport or retries.
- `apps/web/src/client` owns Model, Messages, update, and named Foldkit Commands. Remote state uses `AsyncData`. Commands call the shared contract through `RpcClient`.
- `apps/web/src/server/backend.ts` binds the session capability to the authenticated request. The person id comes from Better Auth's server-side session, never browser input.
- Two external protocol boundaries are the only exceptions to application capability projections:
  - OAuth and session endpoints under `/auth` belong to Better Auth.
  - `POST /google/push` receives Google Calendar push notifications. It is unauthenticated by design: it authenticates each message by channel id and per-channel token, never runs a sync inline, and only hands the calendar to the person's Durable Object.
- The `/live` WebSocket is not a third exception. It authenticates the session on upgrade and carries only change notices for that person.
- `packages/auth/src/google.ts` owns production Google-only options. The provider checks verified email and the allowlist before either sign-in or linking writes. ID tokens are discarded; access and refresh tokens use Better Auth's encryption.
- `googleTokensFor` creates the server-only, person-scoped GoogleTokens adapter. Every account lookup includes the person and provider. Raw credentials never enter RPC output, browser state, or logs.
- Better Auth's D1 tables are authoritative for people, sessions, linked accounts, encrypted tokens, and disconnect state. Google owns provider identity and grants. Browser account summaries are disposable derived data.
- `packages/database/migrations/calendar` owns auth SQL derived from the pinned Better Auth schema. The Calendar D1 resource is the shared app-data cartridge.
- `apps/web/src/dev` and `packages/auth/src/dev` own development fakes. Production entrypoints must never import them. Artifact tests prove their absence from browser and Worker bundles.
- The legacy memory Auth helper exists for devtools test people only. The production Worker imports the Google-only entrypoint, not that helper.
- `apps/web/src/server/worker.ts` serves assets, auth, and RPC from one Worker. It creates request-local auth/backend state and disposes RPC runtimes after each request.
- `apps/infra/alchemy.run.ts` declares the Calendar Stack. The production stage is `CalendarProd`. Resource ids start with `Calendar`.
- The Worker owns only the `calendar.wzrrd.sh` custom domain in the existing zone. It resolves `wzrrd.sh` by name. Never declare a Zone, DNSSEC, standalone DNS record, wildcard update, or mail resource.
- D1 retains its data on removal. Retention is a physical-resource backstop, not approval to remove state.
- Devtools remain development-only. The projection boundary, browser/server imports, request-local state, declared actors, and approval gates keep their existing lint rules.

## Deployment and sign-off

Workers must not make live Google calls or deploy Cloudflare resources. The desk deploys from the operator machine after landing.

- Declare production application keys in `.env.schema`; keep values out of Git. Provider credentials remain profile-only.
- `ALCHEMY_PROFILE` must match the driver's `--profile`.
- Inspect every planned action. Only updates and no-ops pass by default. Initial creates need exact allow entries.
- Replacements and deletions need owner approval and exact allow entries. Never mutate another product's zone records.
- `--expectSha` pins a clean candidate. Quiet windows, typed verdicts, partial-apply evidence, and bounded live checks stay enabled.
- Receipts live in gitignored `.rat/deploy/`. Do not overwrite prior recovery evidence.
- A successful build is not a production OAuth proof. The desk must check real consent, linking, refusal, and sign-out after deploy.
- Rollback is a revert plus approved `pnpm deploy:rollback`. No automatic rollback runs.

Safe scope includes capabilities, tests, project docs, Brain, and removal of unused template surfaces. Dependency-version changes, fence loosening, destructive deploys, sandbox/network widening, or non-localhost agent servers need owner sign-off.

## Code and source control

- Preserve existing work. Inspect status before editing. Stage explicit task paths only. Never commit generated output or secrets.
- Commit as `shitratgit[bot]`. Never bypass hooks or rewrite shared history.
- No prose comments in code. Put knowledge in names, types, tests, commits, or Brain.
- Tool directives carry a reason: `// @effect-diagnostics-next-line <rule>:off -- <reason>` or `// oxlint-disable-next-line <rule> -- <reason>`.
- Type assertions need a one-line `SAFETY:` invariant. Prefer decoding at boundaries instead of asserting.
- Use calm, neutral UI styling. Do not restore the template's hot pink or public teaching pages.

## Brain

Keep durable decisions and receipts in `.brain/` as `.svx`. Put bulk native data in `.brain/data/`. Write plain, short sentences. Keep one claim per sentence. Do not publish private product source or the spec.

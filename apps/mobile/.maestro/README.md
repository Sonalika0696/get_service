# Maestro E2E flows — GateX resident app

FRONTEND_PLAN §7 standing task: one Maestro flow per phase, covering the
resident-facing journeys of `apps/mobile`.

## Flows

| File | Journey | Covers |
| --- | --- | --- |
| `sign-in.yaml` | Auth (F1) | Launches the app, completes the dev sign-in bypass, asserts the Home tab bar renders. |
| `browse-vendors.yaml` | Vendor directory | Signs in, deep-links to `/vendors`, asserts the directory title, search field, and category chips; filters by "Plumbing". |
| `raise-request.yaml` | Requests (F4) | Signs in, opens Requests, taps the "Raise" FAB, fills the compose form (category + title), asserts the primary button, then cancels without submitting. |
| `bills-hub.yaml` | Bills (F3) | Signs in, opens Bills, asserts the hub title and the "Due now" / "All" segmented control. |
| `community.yaml` | Community (F5) | Signs in, opens Community, asserts both feed section headers and the "Post" FAB. |

`browse-vendors.yaml`, `raise-request.yaml`, `bills-hub.yaml`, and
`community.yaml` all start with `runFlow: sign-in.yaml` to reach an
authenticated state before exercising their own screen.

## Auth

There is no live OTP path in this build. `app/auth/sign-in.tsx` renders a
`__DEV__`-only "Developer sign-in" button ("OTP delivery is stubbed in this
build. Skip it for development.") that calls `auth.devSignIn()` and skips
straight to a signed-in session — no real phone number or OTP code is ever
needed. Every flow that needs an authenticated screen goes through this
button via `sign-in.yaml`.

Because the button only exists in `__DEV__`, these flows only work against
a debug or Expo dev-client build, never a release/production build.

## Prerequisites

- A running backend the app can reach at the API base URL configured in
  `app.json` (`expo.extra.apiBaseUrl`, currently
  `http://localhost:4000/api/v1`).
- The app installed and launchable on an iOS simulator, Android emulator,
  or an Expo dev-client build, with `appId: com.gatex.resident` (from
  `app.json`'s `expo.ios.bundleIdentifier` / `expo.android.package`, which
  are identical) matching what's actually installed.
- The [Maestro CLI](https://maestro.mobi) installed and on `PATH`.
- Dev sign-in itself does not strictly require the backend to be reachable
  (a network failure during the post-sign-in `/me` call still leaves the
  session marked signed-in, just with no profile data), but every other
  flow reads real backend-fed lists (bills, requests, vendors, events,
  posts) and will be more meaningful — and its non-title assertions more
  likely to hold — with the backend up.

## Running

From `apps/mobile`:

```sh
maestro test .maestro/sign-in.yaml       # one flow
maestro test .maestro/                   # every flow in the directory
```

## Known limitations

These flows were authored by reading the current screen source
(`app/`, `src/sections/`, `src/i18n/en.json`) — every selector matches
visible English text or an accessibility label the screen renders today.
They have **not been executed** against a real emulator/simulator in this
environment (none was available), so they should be run once against a
live build to confirm selectors before being trusted as a regression
suite. Specific things worth double-checking on that first run:

- `browse-vendors.yaml`'s `openLink: "sft://vendors"` deep link — there is
  currently no in-app tap path to the vendor directory from any tab (it's
  normally reached via `router.push('/vendors/${id}')` from a vendor row
  elsewhere), so this flow relies on the app's `scheme` (`sft`, from
  `app.json`) resolving through expo-router to the `/vendors` route. If a
  direct nav entry point is added later, prefer tapping it over the deep
  link.
- `raise-request.yaml` stops before actually submitting the request (it
  taps "Cancel" instead) because a real submit needs a tagged vendor, and
  the vendor list for a category comes from a live query that may be
  empty in a fresh environment.
- Screen titles/labels pulled from `src/i18n/en.json` (e.g. "Bills",
  "Community", "Due now") assume the device/app language is English,
  which is the default — if a flow runs on a device pinned to another
  locale, retranslate the assertions or set the language back to English
  first via Profile → Language.

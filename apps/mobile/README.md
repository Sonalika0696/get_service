# GateX — Resident app (`@sft/mobile`)

Expo + React Native, TypeScript, Expo Router. Consumes design tokens from
`packages/tokens` and the API client from `packages/api-client`.

## Run

```bash
npm install                       # from repo root — hoists workspace deps
npm run dev:mobile                # or: npm run start --workspace @sft/mobile
```

Then press `i` (iOS sim), `a` (Android emulator), or scan the QR with Expo
Go on device. Note: `react-native-mmkv` requires a **dev build**, not Expo
Go — for a first look with Expo Go, comment out the MMKV persister in
`app/_layout.tsx` and the app still runs (query cache falls back to memory).

## Layout

```
app/                     # expo-router routes
  _layout.tsx            # root providers (query, theme, error boundary, fonts)
  index.tsx              # → /(tabs)
  (tabs)/                # bottom tab shell
    _layout.tsx
    index.tsx            # Home — hero dues card, stat grid, joinable requests
    bills.tsx            # Bills hub (F5)
    requests.tsx         # Requests (F4)
    notices.tsx          # Notice board (F2)
    profile.tsx          # Profile + dev entry
  dev/
    ui.tsx               # /dev/ui — token & primitive playground

src/
  theme/                 # ThemeProvider, theme object
  components/            # Text, Button, Card, Screen, DuesCard, StatTile, RequestRow, ...
  lib/                   # storage (MMKV + SecureStore), query client, api factory
```

## Design system

One family (Inter), monospace for numbers (JetBrains Mono), four sizes, two
weights. Warm off-white base, deep charcoal ink, deep-teal accent. See
`/dev/ui` (Profile → Open design playground) for the full swatch.

Tokens live in `packages/tokens` and are the only source of truth. No
inline hex codes, no ad-hoc padding numbers.

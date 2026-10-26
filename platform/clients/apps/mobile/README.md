# @dramaip/mobile

尽意 DramaIP 的 React Native mobile client, built on **Expo SDK 54** with **Expo
Router**, **NativeWind v5** (Tailwind CSS v4), **gluestack-ui v5**, and
**Reanimated**. Development and debugging use **Expo Go**.

The mobile client extends the optional cloud and collaboration surface of DramaIP; it is not the local creative authority or a standalone video generator. Product copy and feature scope follow the canonical [product positioning](../../../../docs/product/POSITIONING.md): AI-assisted story/IP development, adaptation, screenplay production, continuity, review, and delivery.

Novel writing is a first-class Desktop capability with independent manuscript outcomes, not a mandatory step before video production. Mobile scope must be stated per implemented route and API; this client does not imply full Desktop authoring parity or automatic synchronization of private drafts. Future workflow changes remain in the [execution plan](../../../../docs/PLAN.md).

## Stack

| Concern        | Choice                                                |
| -------------- | ----------------------------------------------------- |
| Runtime        | React Native 0.81.5, React 19.1.0 (matches web/admin) |
| Framework      | Expo SDK 54 (`expo ~54.0.36`)                         |
| Navigation     | Expo Router 6 (file-based, typed routes)              |
| Styling        | NativeWind v5 (`5.0.0-preview.4`) + Tailwind CSS v4   |
| UI components  | gluestack-ui v5 CLI + runtime providers               |
| Animation      | react-native-reanimated 4 + react-native-worklets     |
| API            | `@dramaip/sdk` (workspace) over the v2 HTTP contract  |
| Token storage  | expo-secure-store                                     |

> NativeWind v5 is currently a **preview** (`5.0.0-preview.4`). It compiles
> styles through `react-native-css` + `lightningcss` at build time, so there is
> no native module beyond what Expo Go already ships — it works inside Expo Go.
>
> `lightningcss` is pinned to **1.30.1** via a `resolutions` entry in
> [`clients/package.json`](../../package.json) (workspace root). The pin must
> live at the root so it also overrides the copy nested under
> `react-native-css-interop`; otherwise Metro fails with
> `global.css: failed to deserialize ... Specifier`.

## Run (Expo Go)

The repository launcher wires the mobile app to the Java Gateway and the rest
of the clients:

```bash
pnpm run run-platform-clients.ts            # web + admin + mobile Metro
pnpm run run-platform-clients.ts --mobile-target ios|android
```

Metro listens on **3011** (avoids the 8081 collision with the local Java
identity service). The launcher prints an Expo Go QR for a physical device on
the same Wi-Fi.

To run the mobile app alone from the workspace root (`clients/`):

```bash
pnpm --filter @dramaip/mobile run start
```

Then open the printed URL in the **Expo Go** app, or press `i` / `a` for the
simulator/emulator.

## Environment

Copy `.env.example` to `.env`. The API origin is read from
`EXPO_PUBLIC_MOBILE_API_ORIGIN` (falling back to `EXPO_PUBLIC_API_BASE_URL`).
On a physical device, set it to your machine's LAN IP.

## Adding gluestack-ui components

`gluestack-ui.config.json` is pre-wired so the CLI writes components into
`src/components/ui` and keeps `global.css` in sync:

```bash
npx gluestack-ui@latest add button
npx gluestack-ui@latest add --all
```

`GluestackUIProvider` (overlay + toast hosts) is already mounted in
`app/_layout.tsx`.

## Scripts

| Script            | Purpose                                  |
| ----------------- | ---------------------------------------- |
| `start`           | `expo start --port 3011`                 |
| `ios` / `android` | launch Expo Go on a simulator/emulator   |
| `typecheck`       | `tsc --noEmit`                           |
| `lint`            | ESLint flat config                       |
| `test:security`   | client-side secret/contract invariants   |

## Contract gate

`src/mobile-session.ts` declares the public HTTP contract
(`X-DramaIP-Contract-Version: 2`) and parses responses through
`@dramaip/sdk/contracts`, satisfying `pnpm run contracts:check`.

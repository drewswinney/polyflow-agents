# Store submission notes

What to paste into App Store Connect's *App Review Information* and Google
Play's *App content* declarations, and what to check before pressing submit.
Kept in the repo so the answers stay next to the code they describe.

## App Review notes (Apple) / testing instructions (Google)

> Polyflow Agents is a remote control for an AI agent the user runs on their
> own computer ("Hermes", an open-source agent host). The app has no account
> system and no server of ours: it connects directly to the user's host on
> their own network.
>
> **To review without a host:** on the first screen, tap *"No host yet? Try the
> demo agent"*. This connects to a demo agent built into the app that answers
> with a scripted conversation, including a permission request you can allow
> or deny, an artifact it produces, a sessions list, and the settings screens.
> Every screen in the app is reachable this way.
>
> **Network security:** `NSAllowsArbitraryLoads` / `usesCleartextTraffic` are
> enabled because the host software the app connects to (`hermes serve`)
> serves plain HTTP on a LAN or private tailnet by default. The app probes for
> HTTPS first and warns the user in the connect form when a host is HTTP-only.
> No traffic goes to any server of ours over either scheme.
>
> **Permissions:** microphone (dictate a message; audio is sent to the user's
> own host for transcription), photos and camera (attach a picture to a
> message), notifications (the agent on the user's host telling them it is
> waiting on a decision). Each is requested on first use of the feature.
>
> **Push notifications** are sent by a plugin the user installs on their own
> host, via Expo's push service. The demo agent does not send any.

## Data-safety answers

Both stores ask the same questions in different forms. From
[`privacy-policy.md`](privacy-policy.md):

| Question | Answer |
|---|---|
| Does the app collect data? | No data is collected by the developer. |
| Data sent to third parties | Push notification content (title/body) goes through Expo's push service and Apple/Google for delivery, only if the user installs the host plugin and allows notifications. Update checks go to Expo Application Services. |
| Data linked to the user | None. There is no account. |
| Data used for tracking | None. |
| Encryption in transit | HTTPS when the user's host offers it; the app warns when it does not. |
| Deletion | Everything the app holds is on the device; deleting the app deletes it. |
| Apple "Data Not Collected" label | Yes — no data leaves for a developer-controlled endpoint. Declare *Push notifications* under "Data Not Linked to You → Other Data" if the reviewer pushes back on Expo relaying notification text. |
| Google Data safety: "Does your app collect or share any of the required user data types?" | Share: *Messages → Other in-app messages* (notification content, via Expo), optional, not collected. |

## Before submitting

- [ ] Privacy policy URL: publish `docs/store/privacy-policy.md` (a GitHub URL to
      the file on `main` is acceptable to both stores; a page on polyflow's own
      domain is better) and put the URL in both consoles. Fill in the contact
      address at the bottom first.
- [ ] Support URL (Apple requires one): the repo's issues page works.
- [ ] Screenshots: at least 6.7" and 6.1" iPhone sets for Apple; phone set for
      Google. Take them from the demo agent so nothing private is in them.
- [ ] `expo-notifications` Android: confirm the FCM credentials are uploaded to
      EAS (`eas credentials`), or Android push registration fails silently.
- [ ] iOS: APNs key on EAS, push entitlement in the provisioning profile.
- [ ] `eas build --profile preview` on both platforms; install on a real phone;
      run setup against a real host end to end, including *Send it to the agent*
      on a host that does not yet have the plugin.
- [ ] `eas build --profile production` → TestFlight / Play internal track before
      any public release.
- [ ] Version: `appVersionSource: remote` with `autoIncrement` means EAS owns
      the build number; the marketing version in `app.json` (`0.1.0`) is what
      the stores show. Bump it deliberately.

## What the app does not do, said once

No OpenAI-compatible hosts (deferred — `docs/architecture.md` §12 q3). No
share links that work outside the host's own sign-in (`docs/artifacts.md` §5).
No QR pairing. None of these should be promised in the listing.

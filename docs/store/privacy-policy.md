# Privacy policy — Polyflow Agents

**Effective:** 12 September 2026
**Applies to:** the Polyflow Agents app for iOS and Android, and the
`polyflow-agents-push` plugin you may install on your own Hermes host.

## The short version

Polyflow Agents is a remote control for an AI agent that runs on **a computer
you own** (a Hermes host). The app talks to that computer and to nothing else,
with two exceptions it needs to work: the service that delivers push
notifications, and the service that delivers app updates. There is no account
with us, no analytics, no advertising, and we run no server that sees your
conversations.

## What the app stores on your phone

- **How to reach your host** — its address, and the username or token you sign
  in with. The password or token is kept in the phone's keychain (iOS Keychain
  / Android Keystore) and is sent only to that host.
- **Cached copies** of things you have already seen — session lists, transcripts,
  images you sent, files the agent made — so screens open without waiting for
  the network. The operating system may discard this cache at any time, and
  removing a server from the app removes what was cached for it.
- **Preferences** — theme, which notifications you want, which agent you last used.

Everything above stays on the phone unless you send it to your host.

## What the app sends to your host

Everything you do in the app is a request to your own host: your messages,
images you attach, audio you dictate (sent for transcription and not kept by
the app afterwards), approvals you grant or deny, settings you change, and files
you ask for. Your host is your computer; what it does with this is governed by
how you have configured it and the AI provider it is set up to use — not by
this policy.

If your host speaks plain HTTP rather than HTTPS, the app tells you so when you
connect, because your sign-in and everything after it then crosses your
network unencrypted. The app supports both; the choice is the host's.

## Push notifications

If you install the `polyflow-agents-push` plugin on your host and allow
notifications, your host sends notifications through **Expo's push service**
(`exp.host`, operated by Expo, Inc.), which passes them to Apple or Google for
delivery to your phone. To do that:

- the app registers a **push token** — an identifier Apple or Google mint for
  this app on this phone — with your host. Your host keeps it in its own
  device registry. It is not a credential and cannot be used to sign in.
- a notification's **title and body** travel through Expo, Apple or Google. They
  can contain real content: the command an agent wants approved (up to 140
  characters), a question the agent asked, the first line of its reply, or the
  title of a file it made. These are held by those services for as long as
  their own policies say. Your host's sign-in credential is never put in a
  notification.

You can turn off any category of notification in the app's settings, or all of
them in the phone's settings; the plugin then sends nothing for that category.
Uninstalling the app invalidates the token; the host drops it from its registry
once Apple or Google report it dead. Removing a server from the app does not
by itself tell that host to forget the token, since the app no longer has a
way to reach it — you can remove the device from the host's registry directly.

## App updates

The app can fetch JavaScript updates from **Expo Application Services** (EAS
Update, `u.expo.dev`). That request carries what any app update check does —
the app's version, platform, and a runtime identifier — and no content from
your sessions.

## What we do not do

- We do not run any server that your conversations, files, images or audio
  pass through.
- We do not collect analytics, crash reports, or usage statistics.
- We do not show advertising or share anything with advertisers.
- We do not sell or share personal data.

## Permissions the app asks for, and why

| Permission | Used for |
|---|---|
| Microphone | dictating a message to your agent; the audio is sent to your host for transcription |
| Photos | attaching a picture from your library to a message, and the recent-photos strip in the composer |
| Camera | taking a picture to send to your agent |
| Notifications | the agent telling you it is waiting on you |

Each is asked for the first time you use the feature, and the app works without
any of them.

## Children

The app is not directed at children under 13 and does not knowingly collect
information from them.

## Changes

Changes to this policy are published at this address with a new effective date.

## Contact

Questions about this policy: _[contact address — fill in before publishing]_.

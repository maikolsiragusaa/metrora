# Qovrion Android companion foundation

The Android application is a private local companion to Qovrion Desktop. It does not collect AI usage itself and does not introduce a second gateway, parser, provider registry or analytics engine.

## Authority and data flow

The desktop remains authoritative for collection, normalization, pricing and intelligence. Android consumes only the stable local companion API v1:

- `GET /api/v1/peer/hello`
- `POST /api/v1/peer/pair-request`
- `POST /api/v1/peer/revoke`
- `GET /api/v1/usage`

The user enters a LAN address and port. Discovery and QR conveniences can be layered on later without changing the authority or security model.

## Verified first pairing

The app creates an EC client identity in Android Keystore and presents its certificate during mutual TLS. It observes the desktop certificate fingerprint, verifies that it matches the fingerprint advertised by Qovrion and computes a six-digit confirmation code from both device fingerprints.

The same code is shown on Android and Qovrion Desktop. The desktop owner approves only when every digit matches. This comparison authenticates the first contact and detects an active local-network intermediary whose certificate would produce a different code.

After approval, the desktop fingerprint is pinned for all subsequent operations. The bearer token is useful only together with the same client certificate because the desktop authorizes the token and certificate fingerprint as one peer identity.

## Revocation and local deletion

“Revoke this phone on desktop” performs an authenticated remote revocation first. Local credentials and cached data are deleted only after the desktop confirms that the peer was removed.

“Forget only on this phone” is a separate recovery action for an unavailable desktop. It does not claim to revoke the credential remotely and tells the user to remove the stale device from the desktop later.

## Stable data contract

Android parses `CompanionUsageV1`, not the desktop’s internal menubar/report payload. The contract contains only:

- generated time and period label;
- cost in integer micro-USD;
- calls and sessions;
- input, output, cache-read and cache-write tokens;
- cache-hit percentage;
- up to five top-model summaries;
- pricing coverage metadata.

Project names, session details, findings and other internal desktop report structures are outside this contract.

## Local storage and offline behavior

Pairing credentials and the last successful usage snapshot are encrypted with an AES-GCM key held in Android Keystore. Android backup and device-transfer export are disabled for application state.

When the desktop is unreachable, the app continues to show the most recent encrypted snapshot and marks it as cached. The retrieval timestamp remains visible.

## Data minimization

The companion does not request prompts, assistant messages, source code, patches, tool arguments, secrets or unrestricted filesystem paths.

## Validation boundary

The repository includes contract tests, a real Node mutual-TLS lifecycle test and blocking Android build, unit-test and lint jobs. A physical-device Windows-to-Android pairing run is still required before calling the companion a release-ready alpha.

## Deliberate exclusions

This foundation does not add:

- cloud relay or account synchronization;
- background polling or push notifications;
- a second mobile gateway;
- mobile-side provider parsing or pricing;
- remote execution or control of coding tools;
- store signing, publishing or production release automation.

Those features require separate product and security decisions rather than being smuggled into the companion foundation.

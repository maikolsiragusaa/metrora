# Qovrion Android companion foundation

The Android application is a private local companion to the Qovrion desktop. It does not collect AI usage itself and does not introduce a second gateway, parser, provider registry or analytics engine.

## Authority and data flow

The desktop remains authoritative for collection, normalization, pricing and intelligence. Android reads the existing sanitized usage payload through the stable local companion API v1:

- `GET /api/v1/peer/hello`
- `POST /api/v1/peer/pair`
- `GET /api/v1/usage`

The first foundation supports a manual LAN address, port and six-digit pairing PIN. Discovery and QR conveniences can be layered on later without changing the protocol or authority boundary.

## Security

The app creates an EC client identity in Android Keystore and presents its certificate during mutual TLS. It verifies that the desktop certificate SHA-256 fingerprint observed during TLS is identical to the fingerprint advertised by Qovrion, then pins that fingerprint for pairing and every usage request.

The bearer token issued during pairing is useful only together with the same client certificate because the desktop authorizes the token and certificate fingerprint as one peer identity.

Pairing credentials and the last usage snapshot are encrypted with an AES-GCM key held in Android Keystore. Android backup and device-transfer export are disabled for application state.

## Offline behavior

The most recent successful usage response is kept as an encrypted local snapshot. When the desktop is unreachable, the app continues to show that snapshot and marks it as cached. The retrieval timestamp remains visible.

## Data minimization

The companion reads aggregate fields already sanitized by the desktop, including cost, token totals, calls, sessions, cache rate and top models. It does not request prompts, assistant messages, source code, patches, tool arguments, secrets or unrestricted filesystem paths.

## Deliberate exclusions

This foundation does not add:

- cloud relay or account synchronization;
- background polling or push notifications;
- a second mobile gateway;
- mobile-side provider parsing or pricing;
- remote execution or control of coding tools;
- store signing, publishing or production release automation.

Those features require separate product and security decisions rather than being smuggled into the first companion tranche.

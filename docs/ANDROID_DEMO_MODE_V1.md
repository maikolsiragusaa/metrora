# Android Demo Mode V1

Metrora Android includes an ephemeral, built-in Demo Mode for product
exploration and repeatable visual testing. Demo Mode uses deterministic,
synthetic V1 data through the same Android Usage, Foundation, Project Catalog
and Activity presentation models used by the paired product.

Demo Mode does not create a pairing, credentials, Desktop authorization,
Workspace identity or provider account. It performs no network requests and
does not write demo data to the encrypted credential or projection caches.
Exiting Demo Mode returns to the untouched unpaired state. Active Demo Mode
survives ordinary same-session Android Activity/configuration recreation using
lifecycle-only state; that state is not product authority. A fresh normal
launch/task returns to the real-data authority unless a fresh automation launch
explicitly requests the built-in fixture.

The clean-install Connect screen keeps pairing as the primary action and adds
the secondary `Explore demo` action. Demo-backed destinations show a persistent
`Demo data` indicator. Settings says that no Desktop is connected and exposes
`Exit demo`; Desktop revoke and local-forget actions are not presented in Demo
Mode. Workspace remains clearly unavailable because Android has no truthful
Workspace authority in this version.

The fixture is versioned as `v1`. V1 exposes Today, Last 7 days, Last 30 days,
and This month. This month uses calendar-month-to-date semantics from the first
calendar day through the session's Demo today; Last 30 days remains a distinct
rolling recent-days window. All Usage, Foundation, Project, Activity and Pull
Request values use the same resolved Demo period window. V1 does not expose
lifetime history. A deterministic automation launch may use the
allowlisted Android intent extras `metrora.demo=true`,
`metrora.demo.dataset=v1`, `metrora.demo.now=YYYY-MM-DD`, and
`metrora.demo.destination` with one of `home`, `activity`, `analyze`,
`workspace` or `settings`. The hint is honored only when the real local store
is empty; an existing pairing or cached real state remains authoritative and
the requested demo destination is ignored. Invalid values fail closed and
normal launches are unchanged. Demo dates are session-local, so the same date
and fixture version produce the same domain values.

Demo values are for exploration and visual QA only. They never become real
Metrora evidence; pairing a Desktop remains the normal path for real usage.

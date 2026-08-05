# Core test quarantine

Metrora treats the complete core and desktop suites as blocking merge gates. A test may be quarantined only when it is named exactly, the underlying behavior is outside the current bounded change, and an explicit exit condition is recorded here.

Quarantine is not equivalent to deletion or success. CI continues to execute every non-quarantined test in the affected files and reports quarantined cases separately.

## Active cases

None.

Four previously quarantined parser and durable-cache cases now use clock-independent and filesystem-portable fixtures. The provider-filter parity case was caused by a live-day fixture whose fixed noon timestamps could lie in the future when CI ran before noon; corrected fixtures did not establish a production aggregation defect.

## Rules

- No wildcard quarantine.
- No provider, platform or directory may be excluded without executing its non-quarantined tests separately.
- New failures cannot be added here merely to merge a feature.
- Every active entry must be removed in the first bounded tranche that owns its underlying subsystem.

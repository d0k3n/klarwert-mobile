# Klarwert 1.5.1

- Group derivative products by the underlying asset extracted from the CSV description, falling back to the product name when no underlying is available. Existing manual associations retain priority. No internet lookup is performed.
- Accept changing derivative display names across statement exports without weakening conflict checks on financial values, symbols, or other exported fields. Original CSV provenance is preserved.

Validation: all 252 tests, TypeScript checking, and the web build pass. The 261002 statement merges against the earlier fixture with 292 added movements and 903 duplicates; its 132 derivative products have descriptions identifying 24 underlying groups.

The existing Android Release workflow builds, signs, verifies, and publishes the APK and SHA-256 checksum for tag v1.5.1.

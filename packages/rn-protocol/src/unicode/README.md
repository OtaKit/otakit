# RN portable filename comparison

`case-folding-15.0.0.json` contains the Unicode 15.0.0 default full case folding mappings (statuses C and F; exclude locale-specific T and simple-only S). Source: [CaseFolding.txt](https://www.unicode.org/Public/15.0.0/ucd/CaseFolding.txt), SHA-256 `cdd49e55eae3bbf1f0a3f6580c974a0263cb86a6a08daa10fbf705b4808a56f7`. The adjacent license applies to this derived data.

RN comparison uses NFD, this pinned full fold, then NFD again. Preserve accepted original names when hashing and storing files. Do not replace full folding with locale-sensitive lowercase. The native and CLI implementations must use the same data and shared path acceptance vectors before RN enablement. NFD uses the host Unicode normalizer; acceptance across supported native/Node Unicode versions remains part of that compatibility matrix.

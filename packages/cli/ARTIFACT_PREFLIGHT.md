# Upload artifact preflight

All ZIP and delta uploads inspect the web build before packaging or requesting an upload URL. The scan reports native installer artifacts (including `.exe`, `.msi`, `.dmg`, `.apk`, and `.ipa`), bundles at least 50 MiB unpacked, and individual files at least 10 MiB. Warnings list the largest files so accidental desktop downloads can be removed from the web build or hosted separately. Files are never removed or excluded automatically.

Use `otakit upload dist --strict-artifacts` to make these warnings fail CI before upload. Without that flag, intentional large web assets and installer download links remain allowed within the hard limits.

Hard failures match existing server/native constraints: 5,000 files for deltas, 10,000 for ZIP, and 500,000,000 unpacked bytes. `index.html` must be a regular file; symlinks and non-file artifacts are rejected. For encrypted ZIPs, the compressed archive plus the 16-byte authentication tag must fit within 128 MiB. Devices can have a lower encrypted-object budget depending on current memory headroom.

The scan uses local file metadata and does not predict compressed size or memory usage. Encrypted size is checked after ZIP creation and before encryption/upload. Keep the build output stable during the upload process.

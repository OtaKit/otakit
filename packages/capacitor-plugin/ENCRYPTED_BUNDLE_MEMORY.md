# Encrypted bundle memory

AES-GCM bundle decryption still verifies the tag before writing any plaintext. This change does not introduce streaming plaintext or change the encrypted bundle format.

Before loading the encrypted object, both clients compare its actual file length with a conservative admission budget: the smaller of 128 MiB and one quarter of current available process memory after reserving 32 MiB. Android measures Java heap headroom using `Runtime`; iOS queries `os_proc_available_memory` at each call. Objects over budget fail with `insufficient_memory_for_encrypted_bundle` and byte-count diagnostics, leaving the active installation intact. Reduce the bundle's assets to make it installable on constrained devices.

Android reads into one exactly sized array, removing ByteArrayOutputStream growth and its final full-size copy. iOS uses mapped input where Foundation considers that safe. Authentication and plaintext allocation remain with the platform crypto provider.

The budget is an admission heuristic, not a reservation or an OOM guarantee: other threads, WebViews, crypto providers, and OS memory pressure can change headroom after the check. The 128 MiB ceiling intentionally rejects large encrypted objects even on devices with more memory. Unencrypted ZIPs do not use this path. A future chunk-authenticated format would be needed to support arbitrarily large encrypted bundles without whole-object memory costs.

Validation includes a shared Node.js AES-256-GCM fixture on Android and CryptoKit, a real Android provider test, tampered body/tag and wrong-key tests that preserve existing output, sparse 200 MiB admission failures, and arithmetic boundaries. These are not substitutes for physical-device memory profiling during rollout.

Primary references: [Android Runtime memory methods](https://developer.android.com/reference/java/lang/Runtime), [Apple available process memory](https://developer.apple.com/documentation/os/os_proc_available_memory), and [Cipher authenticated decryption](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/javax/crypto/Cipher.html).

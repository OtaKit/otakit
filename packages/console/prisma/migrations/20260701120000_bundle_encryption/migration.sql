-- End-to-end bundle encryption (opt-in per app): store the AES-256-GCM
-- envelope parameters ({alg, kid, wrapNonce, wrappedDek, nonce}) alongside
-- the bundle. Carried from initiate through the upload session onto the
-- bundle, then baked into the signed manifest. Null = unencrypted bundle.
ALTER TABLE "Bundle" ADD COLUMN "encryption" JSONB;
ALTER TABLE "UploadSession" ADD COLUMN "encryption" JSONB;

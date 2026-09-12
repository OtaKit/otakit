module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    exportEnvironment: process.env.EXPO_PUBLIC_OTAKIT_EXPORT_FIXTURE ?? null,
  },
});

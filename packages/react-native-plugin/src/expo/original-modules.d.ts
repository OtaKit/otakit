declare module 'otakit:original-expo-constants' {
  const constants: { readonly expoConfig: Record<string, unknown> | null; [key: string]: unknown };
  export default constants;
}
declare module 'otakit:original-expo-dom' {
  export function getBaseURL(): string | null;
}

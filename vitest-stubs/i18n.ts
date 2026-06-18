// Vitest stub for WXT's #i18n alias.
// Returns a no-op i18n object so modules that call t('key') don't crash.
// Tests that need real translations should set up their own locale.
export const i18n = {
  t: (key: string, _vars?: Record<string, unknown>) => key,
  locale: 'en',
  getLocale: () => 'en',
  setLocale: (_l: string) => {},
};

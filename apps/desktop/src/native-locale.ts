export const nativeLocaleOptions = (
  locale: string | undefined
): Intl.DateTimeFormatOptions & { readonly locale?: string } =>
  locale === undefined ? {} : { calendar: "gregory", locale };

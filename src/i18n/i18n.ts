import type { Language } from '../preferences/preferences';
import { catalogs, type MessageKey, type Messages } from './messages';

export type MessageParams = Readonly<Record<string, string>>;

/** Translations and locale-aware formatting for one language. */
export class I18n {
  private readonly messages: Messages;
  private readonly integerFormat: Intl.NumberFormat;
  /** Millisecond formats with 2, 1 and 0 fraction digits. */
  private readonly millisecondFormats: readonly [
    Intl.NumberFormat,
    Intl.NumberFormat,
    Intl.NumberFormat,
  ];
  private readonly timeFormat: Intl.DateTimeFormat;
  private readonly listFormat: Intl.ListFormat;

  constructor(readonly language: Language) {
    this.messages = catalogs[language];
    this.integerFormat = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
    const milliseconds = (digits: number) =>
      new Intl.NumberFormat(language, {
        style: 'unit',
        unit: 'millisecond',
        unitDisplay: 'short',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    this.millisecondFormats = [milliseconds(2), milliseconds(1), milliseconds(0)];
    this.timeFormat = new Intl.DateTimeFormat(language, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hourCycle: 'h23',
    });
    this.listFormat = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' });
  }

  /** Looks up a message and fills in its `{placeholders}`. */
  t(key: MessageKey, params?: MessageParams): string {
    const template = this.messages[key];
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
  }

  integer(value: number): string {
    return this.integerFormat.format(value);
  }

  /** A duration in milliseconds, with precision that adapts to its magnitude. */
  ms(value: number): string {
    const [fine, medium, coarse] = this.millisecondFormats;
    return (value < 10 ? fine : value < 100 ? medium : coarse).format(value);
  }

  px(value: number): string {
    return this.t('pxValue', { value: this.integer(value) });
  }

  /** Wall-clock time with milliseconds, e.g. 14:03:27.512. */
  time(epochMs: number): string {
    return this.timeFormat.format(epochMs);
  }

  list(items: readonly string[]): string {
    return this.listFormat.format(items);
  }
}

const cache = new Map<Language, I18n>();

export function getI18n(language: Language): I18n {
  let i18n = cache.get(language);
  if (i18n === undefined) {
    i18n = new I18n(language);
    cache.set(language, i18n);
  }
  return i18n;
}

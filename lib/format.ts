export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const currencyFmt = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const currencyPrecise = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(cents: number, precise = false): string {
  return (precise ? currencyPrecise : currencyFmt).format(cents / 100);
}

export const currency = money;

export function formatCurrency(centsOrEuros: number, isCents = true): string {
  return money(isCents ? centsOrEuros : Math.round(centsOrEuros * 100), true);
}

export function compactMoney(cents: number): string {
  const value = cents / 100;
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `€${(value / 1_000).toFixed(1)}k`;
  return `€${value.toFixed(0)}`;
}

export function number(value: number, digits = 0): string {
  return new Intl.NumberFormat("en-IE", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function percent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function shortDate(value: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(parsed);
}

export function dateTime(value: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

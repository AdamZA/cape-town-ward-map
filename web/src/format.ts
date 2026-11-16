// Number and date formatting, matching the City's documents: space as thousands separator,
// decimal point, "R" prefix. (Intl's en-ZA uses a decimal comma, so we build it ourselves.)
const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const NBSP = " ";
const int = { format: (n: number) => intFmt.format(n).replace(/,/g, NBSP) };
const one = { format: (n: number) => oneFmt.format(n).replace(/,/g, NBSP) };

export const fmtInt = (n: number) => int.format(n);
export const fmtPct = (n: number) => `${one.format(n)}%`;
export const fmtRand = (n: number) => `R${int.format(n)}`;

export function fmtRandShort(n: number): string {
  if (Math.abs(n) >= 1e6) return `R${one.format(n / 1e6)}m`;
  if (Math.abs(n) >= 1e3) return `R${int.format(n / 1e3)}k`;
  return fmtRand(n);
}

/** Format a value by its field unit. */
export function fmtUnit(v: number, unit: string | null | undefined): string {
  switch (unit) {
    case "%":
      return fmtPct(v);
    case "R":
      return fmtRand(v);
    case "days":
      return `${fmtInt(v)} ${v === 1 ? "day" : "days"}`;
    case "per 1,000 per year":
      return one.format(v);
    case "km²":
      return `${one.format(v)} km²`;
    default:
      return fmtInt(v);
  }
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-13" -> "13 Nov 2026"; "2024-05" -> "May 2024". */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const mon = months[Number(m) - 1] ?? m;
  return d ? `${Number(d)} ${mon} ${y}` : `${mon} ${y}`;
}

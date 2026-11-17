// One fixed colour per party, used on the map and in every chart, so a party keeps its colour
// whatever else is shown. Colours come from the validated categorical palette and lean on the
// parties' own colours where that's possible (DA blue, ANC gold, EFF red, PA green). Party names
// are always shown beside the colour (legend, labels, tooltips); colour is never the only cue.

const COLOURS: Record<string, string> = {
  "Democratic Alliance": "#2a78d6",
  "African National Congress": "#eda100",
  "Economic Freedom Fighters": "#e34948",
  "Patriotic Alliance": "#008300",
  GOOD: "#eb6834",
  ActionSA: "#1baf7a",
  "Freedom Front Plus (Vryheidsfront Plus)": "#e87ba4",
  "African Christian Democratic Party": "#6250d6",
};
/** The same hues, stepped for the dark theme (from the palette's dark column). */
const DARK: Record<string, string> = {
  "#2a78d6": "#3987e5",
  "#eda100": "#c98500",
  "#e34948": "#e66767",
  "#008300": "#0ca30c",
  "#eb6834": "#d95926",
  "#1baf7a": "#199e70",
  "#e87ba4": "#d55181",
  "#6250d6": "#9085e9",
};
export const OTHER_PARTY = "#8f8d86";

export function partyColour(party: string, dark = false): string {
  const c = COLOURS[party];
  if (!c) return OTHER_PARTY;
  return dark ? (DARK[c] ?? c) : c;
}
export const hasOwnColour = (party: string) => party in COLOURS;

const SHORT: Record<string, string> = {
  "Democratic Alliance": "DA",
  "African National Congress": "ANC",
  "Economic Freedom Fighters": "EFF",
  "Patriotic Alliance": "PA",
  "Freedom Front Plus (Vryheidsfront Plus)": "FF Plus",
  "African Christian Democratic Party": "ACDP",
  "National Coloured Congress": "NCC",
  "uMkhonto weSizwe Party": "MK",
  "United Democratic Movement": "UDM",
  "African Transformation Movement": "ATM",
  "Inkatha Freedom Party": "IFP",
  "Congress Of The People": "COPE",
  "South African Communist Party": "SACP",
};

/** Short, widely used name for tight spaces (legends, chart labels). */
export const partyShort = (party: string) => SHORT[party] ?? party;

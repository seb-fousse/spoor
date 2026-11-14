// Rule 4: lib/format is where dates are formatted.
export const formatter = new Intl.DateTimeFormat("en-GB");
export const formatted = new Date(0).toLocaleString();

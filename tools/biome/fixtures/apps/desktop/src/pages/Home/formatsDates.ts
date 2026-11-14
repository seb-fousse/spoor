// Rule 4: formatting a date outside lib/format is an error, in each form the plugin bans.
const at = new Date(0);
const maybe: Date | undefined = at;

export const formatted = [
  at.toLocaleString(), // lint-expect: plugin "lib/format"
  at.toLocaleDateString("en-GB"), // lint-expect: plugin "lib/format"
  at.toLocaleTimeString("en-GB", { hour: "2-digit" }), // lint-expect: plugin "lib/format"
  maybe?.toLocaleString(), // lint-expect: plugin "lib/format"
  maybe?.toLocaleDateString(), // lint-expect: plugin "lib/format"
  maybe?.toLocaleTimeString(), // lint-expect: plugin "lib/format"
  new Intl.DateTimeFormat("en-GB").format(at), // lint-expect: plugin "lib/format"
  Intl.DateTimeFormat().format(at), // lint-expect: plugin "lib/format"
];

// Not date formatting: left alone.
export const other = [at.toISOString(), at.toString(), new Intl.NumberFormat().format(1)];

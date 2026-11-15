// Rule 6 applies to the data hooks too: the override that adds rule 3 for them
// has to repeat rule 6's patterns, or it would wipe them out.
import { Icon } from "@components/Icon/Icon"; // lint-expect: lint/style/noRestrictedImports "@components/<Name>"

export const used = [Icon];

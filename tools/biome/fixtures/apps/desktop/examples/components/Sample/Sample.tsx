// The examples get src/'s rules: outside examples/data/, rules 1, 2, 4 and 6 apply.
import { DatabaseProvider } from "@platform/DatabaseProvider";
import { useDatabase } from "@platform/DatabaseProvider"; // lint-expect: lint/style/noRestrictedImports "src/data/"
import { useQuery } from "@tanstack/react-query"; // lint-expect: lint/style/noRestrictedImports "src/data/"
import { Icon } from "@components/Icon";
import { IconPart } from "@components/Icon/Icon"; // lint-expect: lint/style/noRestrictedImports "barrel"

export const used = [DatabaseProvider, useDatabase, useQuery, Icon, IconPart];

export const formatted = new Date(0).toLocaleString(); // lint-expect: plugin "lib/format"

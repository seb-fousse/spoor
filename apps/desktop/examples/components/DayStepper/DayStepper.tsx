/**
 * Example: binding shortcuts and showing them. Illustrates docs/conventions/keyboard.md
 * and docs/conventions/time.md.
 *
 * The keys come from the one table, `SHORTCUTS` in keyboard/shortcuts.ts, by id; a
 * component never writes a key itself. `useShortcuts` binds them page-wide while the
 * component is mounted (for keys that only work while one element has focus, give
 * that element `onKeyDown={shortcutHandler(bindings)}`). `ShortcutTooltip` shows a
 * button's shortcut, written the platform's way, and sets its `aria-keyshortcuts`.
 */
import { type ShortcutBinding, ShortcutTooltip, useShortcuts } from "@keyboard";
import { formatDay } from "@lib/format";
import { ActionIcon, Group, Text } from "@mantine/core";
import { addDays, type LocalDate } from "@spoor/core";

interface DayStepperProps {
  day: LocalDate;
  onChange: (day: LocalDate) => void;
}

/** The day, with ‹ › to step it, and ← → to do the same from anywhere on the page. */
export function DayStepper({ day, onChange }: DayStepperProps) {
  const step = (by: number) => onChange(addDays(day, by));
  // A new array each render is fine: useShortcuts keeps the latest.
  const bindings: ShortcutBinding[] = [
    ["previousDay", () => step(-1)],
    ["nextDay", () => step(1)],
  ];
  useShortcuts(bindings);

  return (
    <Group gap="xs">
      <ShortcutTooltip shortcut="previousDay">
        <ActionIcon variant="default" aria-label="Previous day" onClick={() => step(-1)}>
          ‹
        </ActionIcon>
      </ShortcutTooltip>
      {/* Formatted only through lib/format. */}
      <Text>{formatDay(day)}</Text>
      <ShortcutTooltip shortcut="nextDay">
        <ActionIcon variant="default" aria-label="Next day" onClick={() => step(1)}>
          ›
        </ActionIcon>
      </ShortcutTooltip>
    </Group>
  );
}

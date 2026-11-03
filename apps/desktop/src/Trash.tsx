import { Button, Collapse, Group, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";

/** The collapsible trash list the screens share, with a Restore button per item. */
export function Trash({
  items,
  onRestore,
}: {
  items: { id: string; label: string; deletionId: string | null }[];
  onRestore: (deletionId: string) => void;
}) {
  const [opened, { toggle }] = useDisclosure(false);
  if (items.length === 0) return null;
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Button size="xs" variant="subtle" color="gray" onClick={toggle} aria-expanded={opened}>
          {opened ? "▾" : "▸"} Trash ({items.length})
        </Button>
      </Group>
      <Collapse expanded={opened}>
        <Stack gap={4} pl="md">
          {items.map((item) => (
            <Group key={item.id} gap="xs">
              <Text size="sm">{item.label}</Text>
              <Button
                size="xs"
                variant="default"
                onClick={() => item.deletionId && onRestore(item.deletionId)}
              >
                Restore
              </Button>
            </Group>
          ))}
        </Stack>
      </Collapse>
    </Stack>
  );
}

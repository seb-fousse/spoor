import { Stack, Text, Title } from "@mantine/core";

/** Placeholder Analytics page. */
export function Analytics() {
  return (
    <Stack gap="xs">
      <Title order={2}>Analytics</Title>
      <Text c="dimmed">Charts and trends across your data will live here.</Text>
    </Stack>
  );
}

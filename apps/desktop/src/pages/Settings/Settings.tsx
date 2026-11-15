import { Stack, Text, Title } from "@mantine/core";

/** Placeholder Settings page. */
export function Settings() {
  return (
    <Stack gap="xs">
      <Title order={2}>Settings</Title>
      <Text c="dimmed">App settings will live here.</Text>
    </Stack>
  );
}

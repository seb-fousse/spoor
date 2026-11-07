import { Stack, Text, Title } from "@mantine/core";

/** Placeholder Home page: it will show today's timelines, logs and metrics. */
export function Home() {
  return (
    <Stack gap="xs">
      <Title order={2}>Home</Title>
      <Text c="dimmed">Your timelines, logs and metrics at a glance will live here.</Text>
      <Text c="dimmed" size="sm">
        Early development — this is a scaffold, not a usable app yet. Your data stays on your
        device.
      </Text>
    </Stack>
  );
}

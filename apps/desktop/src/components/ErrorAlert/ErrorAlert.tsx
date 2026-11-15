import { describeError } from "@lib/errors";
import { Alert, type AlertProps } from "@mantine/core";
import { useEffect } from "react";

interface ErrorAlertProps extends Omit<AlertProps, "title" | "children" | "color"> {
  /** What failed, as a data hook or a caught promise gives it. Its `message` is never shown. */
  error: unknown;
  /** What was being done, such as "Could not load logs". Wins over the error's own title. */
  title?: string;
}

/**
 * The one way the app shows an error: a red alert, worded for users by
 * `describeError`. An error the user can't have caused, a bug or a stale
 * screen, is also logged in full, once per error. Spacing and a close button
 * pass through to Mantine's `Alert`.
 */
export function ErrorAlert({ error, title, ...props }: ErrorAlertProps) {
  const described = describeError(error);
  const { expected } = described;

  useEffect(() => {
    if (!expected) console.error(error);
  }, [error, expected]);

  return (
    <Alert color="red" title={title ?? described.title} {...props}>
      {described.message}
    </Alert>
  );
}

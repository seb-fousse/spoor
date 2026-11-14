import { useEffect, useRef, useState } from "react";

/**
 * A short message that clears itself after `ms`, such as why the paste key
 * did nothing. Saying something new replaces the last message and restarts
 * the timer.
 */
export function useNotice(ms: number) {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const say = (text: string) => {
    clearTimeout(timer.current);
    setNotice(text);
    timer.current = setTimeout(() => setNotice(null), ms);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return { notice, say };
}

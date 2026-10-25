import { useSyncExternalStore } from "react";

// Tailwind's default lg breakpoint is 64rem (1024px).
const query = "(width < 64rem)";
function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const getSnapshot = () => window.matchMedia(query).matches;
export function useCompactLayout() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

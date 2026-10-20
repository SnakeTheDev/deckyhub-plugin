import type { FocusEvent, ReactNode } from "react";

// Steam only scrolls far enough to show the focused control, so a section's
// title and text above its first button stay hidden when the D-pad moves up
// into it. Bring the whole box into view, then make sure the focused control
// is still visible in case the box is taller than the screen.
export function keepInView(event: FocusEvent<HTMLElement>) {
  const box = event.currentTarget;
  const target = event.target;
  // After Steam's own scroll to the focused control.
  window.setTimeout(() => {
    box.scrollIntoView({ block: "nearest" });
    target.scrollIntoView({ block: "nearest" });
  });
}

export function KeepInView({ children }: { children: ReactNode }) {
  return <div onFocus={keepInView}>{children}</div>;
}

import { Focusable } from "@decky/ui";
import type { ReactNode } from "react";
import { gridGap } from "../utils";
import { keepInView } from "./KeepInView";

/**
 * Steam's gamepad-nav doesn't reliably support any single "wrapping grid"
 * flow-children value (row-wrap/right-wrap/grid were all tried on real
 * hardware and none enabled left/right). Build the grid as explicit rows
 * instead: make the grid an explicit vertical Focusable of horizontal rows.
 */
export function FocusableGrid<T>({
  items,
  columns,
  keyFor,
  children,
}: {
  items: T[];
  columns: number;
  keyFor: (item: T) => string;
  children: (item: T) => ReactNode;
}) {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += columns) rows.push(items.slice(index, index + columns));
  return (
    <Focusable flow-children="down">
      {rows.map((row, index) => (
        <Focusable key={index} flow-children="right" style={{ display: "flex", gap: gridGap, marginBottom: gridGap }}>
          {row.map((item) => (
            <Focusable key={keyFor(item)} flow-children="down" onFocus={keepInView} style={{ flex: 1, minWidth: 0 }}>
              {children(item)}
            </Focusable>
          ))}
          {Array.from({ length: columns - row.length }, (_, index) => (
            <div aria-hidden key={`empty-${index}`} style={{ flex: 1, minWidth: 0 }} />
          ))}
        </Focusable>
      ))}
    </Focusable>
  );
}

// Screen-space label declutter. Pure: takes boxes in pixels, returns which ones to show.
// Higher-priority boxes (lower number) are placed first. A box is dropped if it overlaps one already kept.

export interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Lower is more important: cities 0, towns 1, and so on. */
  priority: number;
}

function overlaps(a: LabelBox, b: LabelBox, padding: number): boolean {
  return (
    a.left < b.right + padding &&
    b.left < a.right + padding &&
    a.top < b.bottom + padding &&
    b.top < a.bottom + padding
  );
}

/**
 * `null` means the item is off screen or hidden by LOD. It is never shown and never blocks another box.
 * Ties on priority keep input order, so the result is stable from frame to frame.
 */
export function declutter(boxes: (LabelBox | null)[], padding = 4): boolean[] {
  const shown = boxes.map(() => false);
  const order = boxes
    .map((box, index) => ({ box, index }))
    .filter((entry): entry is { box: LabelBox; index: number } => entry.box !== null)
    .sort((a, b) => a.box.priority - b.box.priority || a.index - b.index);

  const kept: LabelBox[] = [];
  for (const { box, index } of order) {
    if (kept.some((other) => overlaps(box, other, padding))) continue;
    kept.push(box);
    shown[index] = true;
  }
  return shown;
}

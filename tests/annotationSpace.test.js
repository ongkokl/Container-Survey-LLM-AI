import { describe, expect, it } from "vitest";
import {
  containedImageRect,
  stagePixelToImageNormalized,
  imageNormalizedToStagePixel,
  imageNormalizedBoxToStageRect
} from "../public/annotation-space.js";

describe("image-space annotation geometry", () => {
  it("removes portrait letterboxing before normalizing a tap", () => {
    const rect = containedImageRect(430, 430, 287, 430);
    expect(rect.x).toBeCloseTo(71.5, 6);
    expect(rect.y).toBeCloseTo(0, 6);
    expect(rect.width).toBeCloseTo(287, 6);
    expect(rect.height).toBeCloseTo(430, 6);

    const point = stagePixelToImageNormalized({ x: 100, y: 215 }, rect);
    expect(point?.x).toBeCloseTo((100 - 71.5) / 287, 6);
    expect(point?.y).toBeCloseTo(0.5, 6);

    // The old implementation would have used 100 / 430 ~= 0.233,
    // shifting the source-image target horizontally.
    expect(point?.x).not.toBeCloseTo(100 / 430, 2);
  });

  it("rejects taps in object-fit contain black margins", () => {
    const rect = containedImageRect(430, 430, 287, 430);
    expect(stagePixelToImageNormalized({ x: 20, y: 200 }, rect)).toBeNull();
    expect(stagePixelToImageNormalized({ x: 410, y: 200 }, rect)).toBeNull();
  });

  it("draws an image-normalized point back onto the same visible pixel", () => {
    const rect = containedImageRect(430, 430, 287, 430);
    const stage = imageNormalizedToStagePixel({ x: 0.1, y: 0.5 }, rect);
    expect(stage?.x).toBeCloseTo(71.5 + 0.1 * 287, 6);
    expect(stage?.y).toBeCloseTo(215, 6);
  });

  it("maps normalized damage boxes inside the visible image rather than the stage", () => {
    const rect = containedImageRect(430, 430, 287, 430);
    const box = imageNormalizedBoxToStageRect(
      { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      rect
    );
    expect(box).toEqual({
      x: 71.5 + 0.1 * 287,
      y: 0.2 * 430,
      width: 0.4 * 287,
      height: 0.3 * 430
    });
  });

  it("keeps full-frame coordinates unchanged when no letterboxing exists", () => {
    const rect = containedImageRect(400, 300, 1600, 1200);
    expect(rect).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(stagePixelToImageNormalized({ x: 100, y: 75 }, rect)).toEqual({ x: 0.25, y: 0.25 });
  });
});

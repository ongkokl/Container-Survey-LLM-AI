import { describe, expect, it } from "vitest";
import {
  expectedDoorImageSide,
  inferDoorEndDetection
} from "../src/domain/container/doorEndOrientation";

const side={x:0.22,y:0.12,width:0.7,height:0.76};

describe("door-end orientation inference",()=>{
  it("expects the door at image left for a RIGHT side overview",()=>{
    expect(expectedDoorImageSide("RIGHT")).toBe("LEFT");
    expect(expectedDoorImageSide("LEFT")).toBe("RIGHT");
  });

  it("detects a left-image door as consistent with the selected RIGHT side",()=>{
    const result=inferDoorEndDetection({
      selectedFace:"RIGHT",
      referenceBox:side,
      doorBox:{x:0.02,y:0.16,width:0.18,height:0.68}
    });
    expect(result.visible).toBe(true);
    expect(result.side).toBe("LEFT");
    expect(result.matchesSelectedFace).toBe(true);
    expect(result.suggestedFace).toBe("RIGHT");
    expect(result.confidence).toBeGreaterThanOrEqual(0.64);
  });

  it("flags the same image orientation when LEFT side was selected",()=>{
    const result=inferDoorEndDetection({
      selectedFace:"LEFT",
      referenceBox:side,
      doorBox:{x:0.02,y:0.16,width:0.18,height:0.68}
    });
    expect(result.side).toBe("LEFT");
    expect(result.matchesSelectedFace).toBe(false);
    expect(result.suggestedFace).toBe("RIGHT");
  });

  it("detects a right-image door as suggesting the LEFT side",()=>{
    const result=inferDoorEndDetection({
      selectedFace:"LEFT",
      referenceBox:{x:0.08,y:0.12,width:0.68,height:0.76},
      doorBox:{x:0.79,y:0.16,width:0.19,height:0.68}
    });
    expect(result.side).toBe("RIGHT");
    expect(result.matchesSelectedFace).toBe(true);
    expect(result.suggestedFace).toBe("LEFT");
  });

  it("reports no door when the AI did not return a door box",()=>{
    const result=inferDoorEndDetection({
      selectedFace:"RIGHT",
      referenceBox:side,
      doorBox:null
    });
    expect(result.visible).toBe(false);
    expect(result.side).toBeNull();
    expect(result.matchesSelectedFace).toBeNull();
  });

  it("recognises a door-dominant photo when no side reference exists",()=>{
    const result=inferDoorEndDetection({
      selectedFace:"RIGHT",
      referenceBox:null,
      doorBox:{x:0.18,y:0.08,width:0.64,height:0.78}
    });
    expect(result.visible).toBe(true);
    expect(result.doorDominant).toBe(true);
    expect(result.matchesSelectedFace).toBeNull();
  });
});

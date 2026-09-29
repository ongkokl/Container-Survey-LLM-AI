import { describe, expect, it } from "vitest";
import {
  alignedCalibrationCorners,
  assessFixedCameraAlignment
} from "../src/domain/container/fixedCameraAlignment";
import type { FaceQuad } from "../src/domain/container/faceHomography";

const corners:FaceQuad=[
  {x:0.1,y:0.1},
  {x:0.9,y:0.1},
  {x:0.9,y:0.9},
  {x:0.1,y:0.9}
];

describe("fixed camera alignment",()=>{
  it("marks a matching face as GREEN",()=>{
    const result=assessFixedCameraAlignment(corners,{x:0.1,y:0.1,width:0.8,height:0.8});
    expect(result.status).toBe("GREEN");
    expect(result.iou).toBe(1);
    expect(result.compensationAllowed).toBe(true);
  });

  it("marks a small stop-position shift as AMBER and allows compensation",()=>{
    const detected={x:0.14,y:0.1,width:0.8,height:0.8};
    const result=assessFixedCameraAlignment(corners,detected);
    expect(result.status).toBe("AMBER");
    expect(result.compensationAllowed).toBe(true);
    const adjusted=alignedCalibrationCorners(corners,detected);
    expect(adjusted[0].x).toBeCloseTo(0.14,6);
    expect(adjusted[1].x).toBeCloseTo(0.94,6);
  });

  it("marks a large container displacement as RED",()=>{
    const result=assessFixedCameraAlignment(corners,{x:0.28,y:0.1,width:0.65,height:0.8});
    expect(result.status).toBe("RED");
    expect(result.compensationAllowed).toBe(false);
  });
});

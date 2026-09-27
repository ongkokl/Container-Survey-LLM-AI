import { describe, expect, it } from "vitest";
import {
  isValidFaceQuad,
  mapBoxToFace,
  mapPointToFace,
  mapPointToCalibratedFace,
  type FaceQuad
} from "../src/domain/container/faceHomography";
import { suggestCedexLocationOnNormalizedSide } from "../src/domain/container/locationCode";

const rectangle:FaceQuad=[
  {x:0.1,y:0.1},
  {x:0.9,y:0.1},
  {x:0.9,y:0.9},
  {x:0.1,y:0.9}
];

describe("manual container-face homography",()=>{
  it("maps the four marked corners to a normalized face with the door at left",()=>{
    expect(mapPointToFace(rectangle[0],rectangle,"LEFT")).toEqual({x:0,y:0});
    expect(mapPointToFace(rectangle[1],rectangle,"LEFT")).toEqual({x:1,y:0});
    expect(mapPointToFace(rectangle[2],rectangle,"LEFT")).toEqual({x:1,y:1});
    expect(mapPointToFace(rectangle[3],rectangle,"LEFT")).toEqual({x:0,y:1});
  });

  it("reverses longitudinal direction when the door end is at image right",()=>{
    expect(mapPointToFace(rectangle[0],rectangle,"RIGHT")).toEqual({x:1,y:0});
    expect(mapPointToFace(rectangle[1],rectangle,"RIGHT")).toEqual({x:0,y:0});
  });

  it("supports fixed-camera canonical horizontal and vertical flips",()=>{
    const flipX=mapPointToCalibratedFace(rectangle[0],rectangle,{flipX:true});
    expect(flipX.x).toBeCloseTo(1,8);expect(flipX.y).toBeCloseTo(0,8);
    const flipY=mapPointToCalibratedFace(rectangle[0],rectangle,{flipY:true});
    expect(flipY.x).toBeCloseTo(0,8);expect(flipY.y).toBeCloseTo(1,8);
    const both=mapPointToCalibratedFace(rectangle[2],rectangle,{flipX:true,flipY:true});
    expect(both.x).toBeCloseTo(0,8);expect(both.y).toBeCloseTo(0,8);
  });

  it("accepts a perspective trapezoid as a valid four-corner face",()=>{
    const trapezoid:FaceQuad=[
      {x:0.18,y:0.16},
      {x:0.84,y:0.25},
      {x:0.78,y:0.78},
      {x:0.12,y:0.88}
    ];
    expect(isValidFaceQuad(trapezoid)).toBe(true);
    const tl=mapPointToFace(trapezoid[0],trapezoid,"LEFT");
    const br=mapPointToFace(trapezoid[2],trapezoid,"LEFT");
    expect(tl.x).toBeCloseTo(0,6);
    expect(tl.y).toBeCloseTo(0,6);
    expect(br.x).toBeCloseTo(1,6);
    expect(br.y).toBeCloseTo(1,6);
  });

  it("maps a marked area through the face reference and preserves multi-zone CEDEX extent",()=>{
    const mapped=mapBoxToFace(
      {x:0.436,y:0.38,width:0.128,height:0.24},
      rectangle,
      "LEFT"
    );
    const result=suggestCedexLocationOnNormalizedSide({
      face:"RIGHT",
      lengthFt:40,
      damageBox:mapped
    });
    expect(result.code).toBe("RX56");
  });

  it("rejects a self-crossing corner order",()=>{
    const crossed:FaceQuad=[
      {x:0.1,y:0.1},
      {x:0.9,y:0.9},
      {x:0.9,y:0.1},
      {x:0.1,y:0.9}
    ];
    expect(isValidFaceQuad(crossed)).toBe(false);
  });
});

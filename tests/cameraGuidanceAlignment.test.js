import { describe, expect, it } from "vitest";
import { estimateFixedFaceBoundsFromGray } from "../public/camera-guidance.js";

function rectangleImage(width,height,box){
  const gray=new Uint8Array(width*height);
  gray.fill(20);
  const left=Math.round(box.x*width);
  const right=Math.round((box.x+box.width)*width);
  const top=Math.round(box.y*height);
  const bottom=Math.round((box.y+box.height)*height);
  for(let y=top;y<=bottom;y++){
    for(let x=left;x<=right;x++)gray[y*width+x]=180;
  }
  return gray;
}

const corners=[
  {x:0.10,y:0.10},
  {x:0.90,y:0.10},
  {x:0.90,y:0.90},
  {x:0.10,y:0.90}
];

describe("fixed-camera edge alignment fallback",()=>{
  it("finds the container frame near the stored calibration",()=>{
    const width=400,height=300;
    const actual={x:0.12,y:0.11,width:0.78,height:0.79};
    const gray=rectangleImage(width,height,actual);
    const result=estimateFixedFaceBoundsFromGray(gray,width,height,corners);
    expect(result).not.toBeNull();
    expect(result.source).toBe("FIXED_GEOMETRY_EDGE");
    expect(result.box.x).toBeCloseTo(actual.x,2);
    expect(result.box.y).toBeCloseTo(actual.y,2);
    expect(result.box.width).toBeCloseTo(actual.width,2);
    expect(result.box.height).toBeCloseTo(actual.height,2);
    expect(result.confidence).toBeGreaterThan(0.18);
  });

  it("returns null when there is no usable structural edge evidence",()=>{
    const width=400,height=300;
    const gray=new Uint8Array(width*height);
    gray.fill(100);
    expect(estimateFixedFaceBoundsFromGray(gray,width,height,corners)).toBeNull();
  });
});

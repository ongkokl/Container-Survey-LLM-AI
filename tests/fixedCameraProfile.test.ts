import { describe, expect, it } from "vitest";
import { fixedCameraProfile, fixedCameraProfiles } from "../src/domain/container/fixedCameraProfile";

describe("fixed camera POC profiles",()=>{
  it("maps Camera R/L to opposite door-end image orientations",()=>{
    expect(fixedCameraProfile("R")).toMatchObject({
      id:"R",face:"RIGHT",doorEndInImage:"LEFT",canonicalFlipX:false,zoomMode:"OPTICAL",automaticLocation:true
    });
    expect(fixedCameraProfile("L")).toMatchObject({
      id:"L",face:"LEFT",doorEndInImage:"RIGHT",canonicalFlipX:true,zoomMode:"OPTICAL",automaticLocation:true
    });
  });

  it("maps Door and Front cameras with front-view horizontal reversal",()=>{
    expect(fixedCameraProfile("D")).toMatchObject({
      id:"D",face:"DOOR",canonicalFlipX:false,automaticLocation:true
    });
    expect(fixedCameraProfile("F")).toMatchObject({
      id:"F",face:"FRONT",canonicalFlipX:true,automaticLocation:true
    });
  });

  it("maps Roof and Floor cameras with the door end at image left",()=>{
    expect(fixedCameraProfile("T")).toMatchObject({
      id:"T",face:"ROOF",doorEndInImage:"LEFT",canonicalFlipX:false,automaticLocation:true
    });
    expect(fixedCameraProfile("B")).toMatchObject({
      id:"B",face:"FLOOR",doorEndInImage:"LEFT",canonicalFlipX:false,automaticLocation:true
    });
  });

  it("exposes exactly six POC cameras",()=>{
    expect(fixedCameraProfiles().map(x=>x.id).sort()).toEqual(["B","D","F","L","R","T"]);
  });

  it("rejects unknown camera ids",()=>{
    expect(fixedCameraProfile("X")).toBeNull();
  });
});

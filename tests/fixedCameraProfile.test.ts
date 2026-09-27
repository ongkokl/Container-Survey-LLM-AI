import { describe, expect, it } from "vitest";
import { fixedCameraProfile, fixedCameraProfiles } from "../src/domain/container/fixedCameraProfile";

describe("fixed camera POC profiles",()=>{
  it("maps Camera R to the right side with door end at image left",()=>{
    expect(fixedCameraProfile("R")).toMatchObject({
      id:"R",face:"RIGHT",doorEndInImage:"LEFT",zoomMode:"OPTICAL",automaticSideLocation:true
    });
  });

  it("maps Camera L to the left side with door end at image right",()=>{
    expect(fixedCameraProfile("L")).toMatchObject({
      id:"L",face:"LEFT",doorEndInImage:"RIGHT",zoomMode:"OPTICAL",automaticSideLocation:true
    });
  });

  it("maps D and T without inventing a side-door orientation",()=>{
    expect(fixedCameraProfile("D")).toMatchObject({face:"DOOR",doorEndInImage:null,zoomMode:"OPTICAL"});
    expect(fixedCameraProfile("T")).toMatchObject({face:"ROOF",doorEndInImage:null,zoomMode:"OPTICAL"});
  });

  it("exposes exactly four POC cameras",()=>{
    expect(fixedCameraProfiles().map(x=>x.id).sort()).toEqual(["D","L","R","T"]);
  });

  it("rejects unknown camera ids",()=>{
    expect(fixedCameraProfile("X")).toBeNull();
  });
});

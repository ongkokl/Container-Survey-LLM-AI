import { describe, expect, it } from "vitest";
import {
  isValidContainerLocationCode,
  suggestCedexLocation,
  suggestCedexLocationFromPoint
} from "../src/domain/container/locationCode";

const full={x:0,y:0,width:1,height:1};

describe("CEDEX side location calculation",()=>{
  it("maps a 40 ft right-side upper point to section 5",()=>{
    expect(suggestCedexLocationFromPoint({
      face:"RIGHT",lengthFt:40,point:{x:0.45,y:0.25},referenceBox:full
    }).code).toBe("RT5N");
  });

  it("maps a 40 ft left-side upper point using rear-at-right orientation",()=>{
    expect(suggestCedexLocationFromPoint({
      face:"LEFT",lengthFt:40,point:{x:0.55,y:0.25},referenceBox:full
    }).code).toBe("LT5N");
  });

  it("uses the first and last sections when damage spans adjacent 40 ft sections",()=>{
    expect(suggestCedexLocation({
      face:"RIGHT",lengthFt:40,
      damageBox:{x:0.11,y:0.10,width:0.28,height:0.20},
      referenceBox:full
    }).code).toBe("RT24");
  });

  it("maps lower-half damage on the right side",()=>{
    expect(suggestCedexLocationFromPoint({
      face:"RIGHT",lengthFt:40,point:{x:0.15,y:0.70},referenceBox:full
    }).code).toBe("RB2N");
  });

  it("uses five longitudinal sections for a 20 ft side",()=>{
    expect(suggestCedexLocationFromPoint({
      face:"RIGHT",lengthFt:20,point:{x:0.25,y:0.25},referenceBox:full
    }).code).toBe("RT2N");
  });

  it("uses X when damage crosses the vertical half boundary",()=>{
    expect(suggestCedexLocation({
      face:"RIGHT",lengthFt:40,
      damageBox:{x:0.41,y:0.45,width:0.05,height:0.15},
      referenceBox:full
    }).code).toBe("RX5N");
  });

  it("uses X and first/last sections when one damage area spans top and bottom sections 5-6",()=>{
    expect(suggestCedexLocation({
      face:"RIGHT",lengthFt:40,
      damageBox:{x:0.42,y:0.35,width:0.16,height:0.30},
      referenceBox:full
    }).code).toBe("RX56");
  });

  it("mirrors the same top/bottom 5-6 span correctly on the left side",()=>{
    expect(suggestCedexLocation({
      face:"LEFT",lengthFt:40,
      damageBox:{x:0.42,y:0.35,width:0.16,height:0.30},
      referenceBox:full
    }).code).toBe("LX56");
  });

  it("maps IICL door-end examples DH2N and DB1N",()=>{
    expect(suggestCedexLocationFromPoint({
      face:"DOOR",lengthFt:40,point:{x:0.25,y:0.05},referenceBox:full
    }).code).toBe("DH2N");
    expect(suggestCedexLocationFromPoint({
      face:"DOOR",lengthFt:40,point:{x:0.05,y:0.70},referenceBox:full
    }).code).toBe("DB1N");
  });

  it("maps the canonical front plane to FB3N",()=>{
    expect(suggestCedexLocationFromPoint({
      face:"FRONT",lengthFt:40,point:{x:0.62,y:0.70},referenceBox:full
    }).code).toBe("FB3N");
  });

  it("maps roof left-half section 3 to TL3N",()=>{
    expect(suggestCedexLocationFromPoint({
      face:"ROOF",lengthFt:40,point:{x:0.25,y:0.25},referenceBox:full
    }).code).toBe("TL3N");
  });

  it("uses X when roof damage crosses the left/right half boundary",()=>{
    expect(suggestCedexLocation({
      face:"ROOF",lengthFt:40,
      damageBox:{x:0.82,y:0.45,width:0.04,height:0.12},
      referenceBox:full
    }).code).toBe("TX9N");
  });

  it("maps floor left-half section 1 to BL1N",()=>{
    expect(suggestCedexLocationFromPoint({
      face:"FLOOR",lengthFt:40,point:{x:0.05,y:0.25},referenceBox:full
    }).code).toBe("BL1N");
  });

  it("validates four-character container location codes",()=>{
    expect(isValidContainerLocationCode("RT5N")).toBe(true);
    expect(isValidContainerLocationCode("RT24")).toBe(true);
    expect(isValidContainerLocationCode("bad")).toBe(false);
  });
});

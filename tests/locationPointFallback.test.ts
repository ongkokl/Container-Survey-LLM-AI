import { describe, expect, it, vi } from "vitest";
import { LocationSuggestionService } from "../src/application/locationSuggestionService";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

function file(){
  return new File([new Uint8Array([1,2,3])],"overview.jpg",{type:"image/jpeg"});
}

describe("zero-touch fixed-camera point fallback",()=>{
  it("uses Moondream point fallback when box detection misses and continues location calculation",async()=>{
    const saveLocationPrediction=vi.fn(async()=>({predictionId:"loc-1"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f1",survey_id:"s1",container_face:"LEFT",final_location_code:null,
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      geometryForFinding:vi.fn(async()=>({
        isoCode:"45G1",equipmentType:"GP",lengthFt:40,heightDescription:"9'6",
        lengthMm:12192,widthMm:2438,heightMm:2896,
        geometrySource:"test",geometryVersion:"test"
      })),
      fixedCameraCalibration:vi.fn(async()=>({
        cameraId:"L",containerFace:"LEFT",lengthFt:40,heightMm:2896,
        doorEndInImage:"RIGHT",
        corners:[
          {x:0.1,y:0.1},
          {x:0.9,y:0.1},
          {x:0.9,y:0.9},
          {x:0.1,y:0.9}
        ],
        calibrationVersion:1,updatedAt:"2026-09-30T00:00:00Z"
      })),
      fixedCameraCalibrationByHeight:vi.fn(async()=>null),
      fixedCameraEndStructureCalibration:vi.fn(async()=>null),
      saveLocationPrediction
    } as unknown as CedexRepository;

    const marker={
      locateOverview:vi.fn(async()=>({
        found:false,
        model:"@cf/moondream/moondream3.1-9B-A2B",
        damageBox:null,
        referenceBox:null,
        doorBox:null,
        raw:{}
      })),
      point:vi.fn(async()=>({
        found:true,
        model:"@cf/moondream/moondream3.1-9B-A2B",
        geometry:{x:0.42,y:0.56},
        raw:{}
      }))
    };

    const service=new LocationSuggestionService(repo,marker as never);
    const result=await service.analyse({
      findingId:"f1",
      file:file(),
      imageWidth:1600,
      imageHeight:900,
      captureMetadata:{
        source:"gallery",
        fixedCameraMode:true,
        fixedCameraId:"L"
      }
    });

    expect(marker.locateOverview).toHaveBeenCalledTimes(1);
    expect(marker.point).toHaveBeenCalledTimes(1);
    expect(result.found).toBe(true);
    expect(result.localizationSource).toBe("POINT_FALLBACK");
    expect(result.point).toEqual({x:0.42,y:0.56});
    expect(result.damageBox).toEqual({
      x:0.33,
      y:0.44,
      width:0.18,
      height:0.24
    });
    expect(result.location.code).toBeTruthy();
    expect(result.location.reviewRequired).toBe(true);
    expect(result.location.physicalMeasurement).toBeNull();
    expect(String(result.location.reason)).toContain("point fallback located");
    expect(saveLocationPrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        localizationSource:"POINT_FALLBACK"
      })
    }));
  });

  it("keeps manual fallback only when both detect and point fail",async()=>{
    const saveLocationPrediction=vi.fn(async()=>({predictionId:"loc-2"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f2",survey_id:"s2",container_face:"LEFT",final_location_code:null,
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      geometryForFinding:vi.fn(async()=>({
        isoCode:"45G1",equipmentType:"GP",lengthFt:40,heightDescription:"9'6",
        lengthMm:12192,widthMm:2438,heightMm:2896,
        geometrySource:"test",geometryVersion:"test"
      })),
      fixedCameraCalibration:vi.fn(async()=>({
        cameraId:"L",containerFace:"LEFT",lengthFt:40,heightMm:2896,
        doorEndInImage:"RIGHT",
        corners:[
          {x:0.1,y:0.1},
          {x:0.9,y:0.1},
          {x:0.9,y:0.9},
          {x:0.1,y:0.9}
        ],
        calibrationVersion:1,updatedAt:"2026-09-30T00:00:00Z"
      })),
      fixedCameraCalibrationByHeight:vi.fn(async()=>null),
      fixedCameraEndStructureCalibration:vi.fn(async()=>null),
      saveLocationPrediction
    } as unknown as CedexRepository;

    const marker={
      locateOverview:vi.fn(async()=>({
        found:false,model:"@cf/moondream/moondream3.1-9B-A2B",
        damageBox:null,referenceBox:null,doorBox:null,raw:{}
      })),
      point:vi.fn(async()=>({
        found:false,model:"@cf/moondream/moondream3.1-9B-A2B",
        geometry:null,raw:{}
      }))
    };

    const result=await new LocationSuggestionService(repo,marker as never).analyse({
      findingId:"f2",
      file:file(),
      imageWidth:1600,
      imageHeight:900,
      captureMetadata:{source:"gallery",fixedCameraMode:true,fixedCameraId:"L"}
    });

    expect(result.found).toBe(false);
    expect(result.localizationSource).toBe("POINT_FALLBACK");
    expect(result.damageBox).toBeNull();
    expect(result.point).toBeNull();
    expect(String(result.location.reason)).toContain("mark the damage manually");
  });
});

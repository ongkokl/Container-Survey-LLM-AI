import { describe, expect, it, vi } from "vitest";
import { LocationSuggestionService } from "../src/application/locationSuggestionService";
import { MoondreamDamageMarker } from "../src/infrastructure/ai/moondreamDamageMarker";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

function photo(){
  return new File([new Uint8Array([1,2,3])],"overview.jpg",{type:"image/jpeg"});
}

describe("zero-touch overview point fallback",()=>{
  it("uses a permissive Moondream point target when box detection misses",async()=>{
    const ai={run:vi.fn(async(_model:string,input:unknown)=>{
      const req=input as {task:string;target:string;max_objects:number};
      expect(req.task).toBe("point");
      expect(req.max_objects).toBe(3);
      expect(req.target).toContain("single most visually abnormal physical damage or repair area");
      expect(req.target).toContain("repair patch");
      expect(req.target).toContain("normal corrugations");
      return {points:[{x:43,y:58}]};
    })};
    const marker=new MoondreamDamageMarker(ai);
    const result=await marker.pointOverview(photo(),"LEFT");
    expect(result.found).toBe(true);
    expect(result.geometry).toEqual({x:0.43,y:0.58});
  });

  it("continues fixed-camera CEDEX location from the automatic point when detect returns no box",async()=>{
    const saveLocationPrediction=vi.fn(async()=>({predictionId:"lp1"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f1",survey_id:"s1",container_face:"LEFT",
        final_location_code:null,equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
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
          {x:0.1,y:0.1},{x:0.9,y:0.1},{x:0.9,y:0.9},{x:0.1,y:0.9}
        ],
        calibrationVersion:1,updatedAt:"2026-09-30T00:00:00.000Z"
      })),
      saveLocationPrediction
    } as unknown as CedexRepository;

    const marker={
      locateOverview:vi.fn(async()=>({
        found:false,model:"@cf/moondream/moondream3.1-9B-A2B",
        damageBox:null,referenceBox:null,doorBox:null,raw:{}
      })),
      pointOverview:vi.fn(async()=>({
        found:true,model:"@cf/moondream/moondream3.1-9B-A2B",
        geometry:{x:0.42,y:0.55},raw:{points:[{x:42,y:55}]}
      }))
    } as unknown as MoondreamDamageMarker;

    const result=await new LocationSuggestionService(repo,marker).analyse({
      findingId:"f1",
      file:photo(),
      imageWidth:1600,
      imageHeight:900,
      captureMetadata:{
        source:"gallery",
        fixedCameraMode:true,
        fixedCameraId:"L",
        fixedCameraFace:"LEFT",
        fixedDoorEndInImage:"RIGHT"
      }
    });

    expect(marker.locateOverview).toHaveBeenCalledTimes(1);
    expect(marker.pointOverview).toHaveBeenCalledWith(expect.any(File),"LEFT");
    expect(result.found).toBe(true);
    expect(result.localizationSource).toBe("POINT_FALLBACK");
    expect(result.point).toEqual({x:0.42,y:0.55});
    expect(result.damageBox).toEqual(expect.objectContaining({
      width:0.18,height:0.18
    }));
    expect(result.location.code).toMatch(/^L/);
    expect(result.location.markType).toBe("POINT");
    expect(result.autoUsable).toBe(true);
    expect(saveLocationPrediction).toHaveBeenCalledWith(expect.objectContaining({
      selectedCode:result.location.code,
      requestContext:expect.objectContaining({
        localizationSource:"POINT_FALLBACK",
        pointFallbackUsed:true
      })
    }));
  });

  it("returns manual fallback only after both box detection and point fallback fail",async()=>{
    const saveLocationPrediction=vi.fn(async()=>({predictionId:"lp2"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f2",survey_id:"s2",container_face:"LEFT",
        final_location_code:null,equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
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
          {x:0.1,y:0.1},{x:0.9,y:0.1},{x:0.9,y:0.9},{x:0.1,y:0.9}
        ],
        calibrationVersion:1,updatedAt:"2026-09-30T00:00:00.000Z"
      })),
      saveLocationPrediction
    } as unknown as CedexRepository;

    const marker={
      locateOverview:vi.fn(async()=>({
        found:false,model:"@cf/moondream/moondream3.1-9B-A2B",
        damageBox:null,referenceBox:null,doorBox:null,raw:{}
      })),
      pointOverview:vi.fn(async()=>({
        found:false,model:"@cf/moondream/moondream3.1-9B-A2B",
        geometry:null,raw:{points:[]}
      }))
    } as unknown as MoondreamDamageMarker;

    const result=await new LocationSuggestionService(repo,marker).analyse({
      findingId:"f2",file:photo(),imageWidth:1600,imageHeight:900,
      captureMetadata:{fixedCameraMode:true,fixedCameraId:"L"}
    });

    expect(result.found).toBe(false);
    expect(result.localizationSource).toBe("NONE");
    expect(result.pointFallbackAttempted).toBe(true);
    expect(result.location.reason).toContain("could not detect or pinpoint");
  });
});

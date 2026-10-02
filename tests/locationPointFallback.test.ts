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

  it("uses a narrow deformation-only Moondream target for the PAA/DT speed experiment",async()=>{
    const ai={run:vi.fn(async(_model:string,input:unknown)=>{
      const req=input as {task:string;target:string;max_objects:number};
      expect(req.task).toBe("point");
      expect(req.max_objects).toBe(1);
      expect(req.target).toContain("single most prominent inward or outward dent");
      expect(req.target).toContain("permanently deformed corrugation");
      expect(req.target).toContain("side-wall panel field");
      expect(req.target).toContain("ignore normal corrugation shape");
      expect(req.target).not.toContain("PAA");
      expect(req.target).not.toContain("DT");
      return {points:[{x:38,y:48}]};
    })};
    const marker=new MoondreamDamageMarker(ai);
    const result=await marker.pointPanelDeformationOverview(photo(),"LEFT");
    expect(result.found).toBe(true);
    expect(result.geometry).toEqual({x:0.38,y:0.48});
    expect(result.locatorProfile).toBe("PANEL_DEFORMATION_POINT_V1");
  });

  it("uses Qwen full-overview reasoning as the third automatic localization stage",async()=>{
    const ai={run:vi.fn(async(model:string,input:unknown)=>{
      expect(model).toBe("@cf/qwen/qwen3.8-27b");
      const req=input as {
        messages:Array<{content:Array<{type:string;text?:string}>}>,
        response_format:{json_schema:{name:string}}
      };
      const prompt=String(req.messages[0].content[0].text??"");
      expect(prompt).toContain("Moondream object detection and pinpoint both failed");
      expect(prompt).toContain("normalized image coordinates");
      expect(req.response_format.json_schema.name).toBe("overview_damage_point_fallback");
      return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        found:true,x:0.49,y:0.53,confidence:0.84,
        reason:"Visible local inward deformation on the corrugated panel."
      })}}]};
    })};
    const marker=new MoondreamDamageMarker(ai);
    const result=await marker.reasonedPointOverview(photo(),"LEFT");
    expect(result.found).toBe(true);
    expect(result.geometry).toEqual({x:0.49,y:0.53});
    expect(result.confidence).toBe(0.84);
    expect(result.model).toBe("@cf/qwen/qwen3.8-27b");
  });

  it("uses Moondream point directly for the fast zero-touch path and skips detect/Qwen localization",async()=>{
    const saveLocationPrediction=vi.fn(async()=>({predictionId:"lp-fast"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f-fast",survey_id:"s-fast",container_face:"LEFT",
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
        calibrationVersion:5,updatedAt:"2026-10-02T00:00:00.000Z"
      })),
      saveLocationPrediction
    } as unknown as CedexRepository;

    const markerMock={
      locateOverview:vi.fn(),
      selectPrimaryOverviewDamage:vi.fn(),
      pointOverview:vi.fn(),
      pointPanelDeformationOverview:vi.fn(async()=>({
        found:true,model:"@cf/moondream/moondream3.1-9B-A2B",
        geometry:{x:0.38,y:0.48},raw:{points:[{x:38,y:48}]},
        locatorProfile:"PANEL_DEFORMATION_POINT_V1"
      })),
      reasonedPointOverview:vi.fn()
    } as unknown as MoondreamDamageMarker;

    const result=await new LocationSuggestionService(repo,markerMock).analyse({
      findingId:"f-fast",file:photo(),imageWidth:1103,imageHeight:417,
      captureMetadata:{fixedCameraMode:true,fixedCameraId:"L"},
      fastPointOnly:true
    });

    expect(markerMock.pointPanelDeformationOverview).toHaveBeenCalledWith(expect.any(File),"LEFT");
    expect(markerMock.pointOverview).not.toHaveBeenCalled();
    expect(markerMock.locateOverview).not.toHaveBeenCalled();
    expect(markerMock.selectPrimaryOverviewDamage).not.toHaveBeenCalled();
    expect(markerMock.reasonedPointOverview).not.toHaveBeenCalled();
    expect(result.found).toBe(true);
    expect(result.localizationSource).toBe("MOONDREAM_POINT_FAST");
    expect(result.locatorProfile).toBe("PANEL_DEFORMATION_POINT_V1");
    expect(result.point).toEqual({x:0.38,y:0.48});
    expect(result.damageBox).toEqual(expect.objectContaining({width:0.18,height:0.18}));
    expect((result.location as {code?:string|null}|null)?.code).toMatch(/^L/);
    expect((result as any).timings.moondreamPointMs).toBeGreaterThanOrEqual(0);
    expect(saveLocationPrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        localizationSource:"MOONDREAM_POINT_FAST",
        fastPointOnly:true,
        locatorProfile:"PANEL_DEFORMATION_POINT_V1"
      })
    }));
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
      })),
      reasonedPointOverview:vi.fn()
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
    expect(marker.reasonedPointOverview).not.toHaveBeenCalled();
    expect(result.found).toBe(true);
    expect(result.localizationSource).toBe("POINT_FALLBACK");
    expect(result.point).toEqual({x:0.42,y:0.55});
    expect(result.damageBox).toEqual(expect.objectContaining({
      width:0.18,height:0.18
    }));
    const location=result.location as {code:string|null;markType?:string}|null;
    expect(location?.code).toMatch(/^L/);
    expect(location?.markType).toBe("POINT");
    expect(result.autoUsable).toBe(true);
    expect(saveLocationPrediction).toHaveBeenCalledWith(expect.objectContaining({
      selectedCode:location?.code,
      requestContext:expect.objectContaining({
        localizationSource:"POINT_FALLBACK",
        pointFallbackUsed:true
      })
    }));
  });

  it("continues zero-touch location with Qwen when both Moondream localization stages miss",async()=>{
    const saveLocationPrediction=vi.fn(async()=>({predictionId:"lp-qwen"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"fq",survey_id:"sq",container_face:"LEFT",
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
      })),
      reasonedPointOverview:vi.fn(async()=>({
        found:true,model:"@cf/qwen/qwen3.8-27b",
        geometry:{x:0.51,y:0.47},
        confidence:0.86,
        reason:"Visible inward dent interrupts the otherwise regular corrugation.",
        raw:{}
      }))
    } as unknown as MoondreamDamageMarker;

    const result=await new LocationSuggestionService(repo,marker).analyse({
      findingId:"fq",file:photo(),imageWidth:1600,imageHeight:900,
      captureMetadata:{fixedCameraMode:true,fixedCameraId:"L"}
    });

    expect(marker.locateOverview).toHaveBeenCalledTimes(1);
    expect(marker.pointOverview).toHaveBeenCalledTimes(1);
    expect(marker.reasonedPointOverview).toHaveBeenCalledWith(expect.any(File),"LEFT");
    expect(result.found).toBe(true);
    expect(result.localizationSource).toBe("QWEN_POINT_FALLBACK");
    expect(result.model).toBe("@cf/qwen/qwen3.8-27b");
    expect(result.point).toEqual({x:0.51,y:0.47});
    expect(result.pointFallbackConfidence).toBe(0.86);
    const location=result.location as {code:string|null;markType?:string}|null;
    expect(location?.code).toMatch(/^L/);
    expect(location?.markType).toBe("POINT");
    expect(saveLocationPrediction).toHaveBeenCalledWith(expect.objectContaining({
      modelName:"@cf/qwen/qwen3.8-27b",
      requestContext:expect.objectContaining({
        localizationSource:"QWEN_POINT_FALLBACK",
        qwenFallbackUsed:true,
        pointFallbackConfidence:0.86
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
      })),
      reasonedPointOverview:vi.fn(async()=>({
        found:false,model:"@cf/qwen/qwen3.8-27b",
        geometry:null,confidence:0.2,reason:"No reliable physical defect.",raw:{}
      }))
    } as unknown as MoondreamDamageMarker;

    const result=await new LocationSuggestionService(repo,marker).analyse({
      findingId:"f2",file:photo(),imageWidth:1600,imageHeight:900,
      captureMetadata:{fixedCameraMode:true,fixedCameraId:"L"}
    });

    expect(result.found).toBe(false);
    expect(result.localizationSource).toBe("NONE");
    expect(result.pointFallbackAttempted).toBe(true);
    expect(result.qwenFallbackAttempted).toBe(true);
    expect(marker.reasonedPointOverview).toHaveBeenCalledTimes(1);
    expect(result.location?.reason).toContain("could not detect, pinpoint or reason");
  });
});

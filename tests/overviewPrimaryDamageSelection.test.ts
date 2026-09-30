import { describe, expect, it, vi } from "vitest";
import { MoondreamDamageMarker } from "../src/infrastructure/ai/moondreamDamageMarker";
import { LocationSuggestionService } from "../src/application/locationSuggestionService";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

function photo(){
  return new File([new Uint8Array([1,2,3])],"overview.jpg",{type:"image/jpeg"});
}

describe("primary overview damage selection",()=>{
  it("asks Qwen to prefer structural deformation over lower-priority surface marks",async()=>{
    const ai={run:vi.fn(async(model:string,input:unknown)=>{
      expect(model).toBe("@cf/qwen/qwen3.8-27b");
      const req=input as {
        messages:Array<{content:Array<{type:string;text?:string}>}>,
        response_format:{json_schema:{name:string}}
      };
      const prompt=String(req.messages[0].content[0].text??"");
      expect(prompt).toContain("clear structural deformation");
      expect(prompt).toContain("gouge, scrape, scratch");
      expect(prompt).toContain("row or line of repeated dents");
      expect(req.response_format.json_schema.name).toBe("overview_primary_damage_selection");
      return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        decision:"CANDIDATE",
        candidate_index:1,
        x:null,
        y:null,
        confidence:0.91,
        priority_class:"STRUCTURAL_DEFORMATION",
        reason:"Candidate 1 is a repeated dent line; candidate 0 is only a dark scrape."
      })}}]};
    })};

    const marker=new MoondreamDamageMarker(ai);
    const candidates=[
      {x:0.25,y:0.77,width:0.18,height:0.18},
      {x:0.10,y:0.43,width:0.58,height:0.12}
    ];
    const result=await marker.selectPrimaryOverviewDamage(photo(),"LEFT",candidates);

    expect(result.found).toBe(true);
    expect(result.decision).toBe("CANDIDATE");
    expect(result.selectedCandidateIndex).toBe(1);
    expect(result.geometry).toEqual(candidates[1]);
    expect(result.priorityClass).toBe("STRUCTURAL_DEFORMATION");
  });

  it("can override Moondream boxes when a stronger structural defect is elsewhere",async()=>{
    const ai={run:vi.fn(async()=>({
      choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        decision:"OVERRIDE_POINT",
        candidate_index:null,
        x:0.43,
        y:0.49,
        confidence:0.86,
        priority_class:"STRUCTURAL_DEFORMATION",
        reason:"The strongest damage is a horizontal dent line outside the dark scrape candidate."
      })}}]
    }))};
    const marker=new MoondreamDamageMarker(ai);
    const result=await marker.selectPrimaryOverviewDamage(
      photo(),"LEFT",
      [{x:0.25,y:0.77,width:0.18,height:0.18}]
    );
    expect(result.found).toBe(true);
    expect(result.decision).toBe("OVERRIDE_POINT");
    expect(result.geometry).toEqual({x:0.43,y:0.49});
  });

  it("returns up to three Moondream candidate boxes instead of hiding all but the largest",async()=>{
    const ai={run:vi.fn(async()=>({
      objects:[
        {x_min:10,y_min:20,x_max:30,y_max:40},
        {x_min:40,y_min:45,x_max:80,y_max:60},
        {x_min:65,y_min:70,x_max:90,y_max:90}
      ]
    }))};
    const marker=new MoondreamDamageMarker(ai);
    const result=await marker.locateOverview(photo(),"LEFT",null,{skipReferenceDetection:true,skipDoorDetection:true});
    expect(result.damageCandidates).toHaveLength(3);
    expect(result.damageCandidates[0]).toEqual({x:0.1,y:0.2,width:0.2,height:0.2});
    expect(result.damageBox).toEqual({x:0.4,y:0.45,width:0.4,height:0.15});
  });

  it("uses the Qwen-selected structural candidate for fixed-camera CEDEX location",async()=>{
    const saveLocationPrediction=vi.fn(async()=>({predictionId:"lp-primary"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f-primary",survey_id:"s-primary",container_face:"LEFT",
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

    const lowerScrape={x:0.25,y:0.77,width:0.18,height:0.18};
    const centreDent={x:0.12,y:0.43,width:0.55,height:0.12};
    const marker={
      locateOverview:vi.fn(async()=>({
        found:true,
        model:"@cf/moondream/moondream3.1-9B-A2B",
        damageBox:lowerScrape,
        damageCandidates:[lowerScrape,centreDent],
        referenceBox:null,doorBox:null,raw:{}
      })),
      selectPrimaryOverviewDamage:vi.fn(async()=>({
        found:true,
        model:"@cf/qwen/qwen3.8-27b",
        decision:"CANDIDATE",
        geometry:centreDent,
        selectedCandidateIndex:1,
        confidence:0.92,
        priorityClass:"STRUCTURAL_DEFORMATION",
        reason:"Centre dent line outranks the lower surface scrape.",
        raw:{}
      })),
      pointOverview:vi.fn(),
      reasonedPointOverview:vi.fn()
    } as unknown as MoondreamDamageMarker;

    const result=await new LocationSuggestionService(repo,marker).analyse({
      findingId:"f-primary",
      file:photo(),
      imageWidth:1600,
      imageHeight:900,
      captureMetadata:{fixedCameraMode:true,fixedCameraId:"L"}
    });

    expect(result.localizationSource).toBe("QWEN_PRIMARY_BOX");
    expect(result.damageBox).toEqual(centreDent);
    expect(result.primaryDamageSelection).toEqual(expect.objectContaining({
      decision:"CANDIDATE",
      selectedCandidateIndex:1,
      priorityClass:"STRUCTURAL_DEFORMATION"
    }));
    expect(marker.pointOverview).not.toHaveBeenCalled();
    expect(marker.reasonedPointOverview).not.toHaveBeenCalled();
    expect(saveLocationPrediction).toHaveBeenCalledWith(expect.objectContaining({
      modelName:"@cf/qwen/qwen3.8-27b",
      requestContext:expect.objectContaining({
        primarySelectionUsed:true,
        selectedCandidateIndex:1,
        primarySelectorPriorityClass:"STRUCTURAL_DEFORMATION"
      })
    }));
  });

  it("uses a Qwen override point when Moondream only found a lower surface mark",async()=>{
    const saveLocationPrediction=vi.fn(async()=>({predictionId:"lp-override"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f-override",survey_id:"s-override",container_face:"LEFT",
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

    const lowerScrape={x:0.25,y:0.77,width:0.18,height:0.18};
    const marker={
      locateOverview:vi.fn(async()=>({
        found:true,
        model:"@cf/moondream/moondream3.1-9B-A2B",
        damageBox:lowerScrape,
        damageCandidates:[lowerScrape],
        referenceBox:null,doorBox:null,raw:{}
      })),
      selectPrimaryOverviewDamage:vi.fn(async()=>({
        found:true,
        model:"@cf/qwen/qwen3.8-27b",
        decision:"OVERRIDE_POINT",
        geometry:{x:0.43,y:0.49},
        selectedCandidateIndex:null,
        confidence:0.87,
        priorityClass:"STRUCTURAL_DEFORMATION",
        reason:"Visible horizontal dent line is stronger than the lower scrape.",
        raw:{}
      })),
      pointOverview:vi.fn(),
      reasonedPointOverview:vi.fn()
    } as unknown as MoondreamDamageMarker;

    const result=await new LocationSuggestionService(repo,marker).analyse({
      findingId:"f-override",
      file:photo(),
      imageWidth:1600,
      imageHeight:900,
      captureMetadata:{fixedCameraMode:true,fixedCameraId:"L"}
    });

    expect(result.localizationSource).toBe("QWEN_PRIMARY_OVERRIDE_POINT");
    expect(result.point).toEqual({x:0.43,y:0.49});
    expect(result.damageBox).toEqual(expect.objectContaining({width:0.18,height:0.18}));
    expect((result.location as {markType?:string}|null)?.markType).toBe("POINT");
    expect((result.location as {physicalMeasurement?:unknown}|null)?.physicalMeasurement).toBeNull();
    expect(marker.pointOverview).not.toHaveBeenCalled();
    expect(marker.reasonedPointOverview).not.toHaveBeenCalled();
  });
});

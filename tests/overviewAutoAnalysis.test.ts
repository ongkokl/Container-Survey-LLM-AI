import { describe, expect, it, vi } from "vitest";
import { OverviewAutoAnalysisService } from "../src/application/overviewAutoAnalysisService";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

function photo(){
  return new File([new Uint8Array([1,2,3])],"crop.jpg",{type:"image/jpeg"});
}

describe("zero-touch overview analysis",()=>{
  it("detects component then damage and records both AI predictions",async()=>{
    const saveComponentPrediction=vi.fn(async()=>({predictionId:"cp1"}));
    const saveDamagePrediction=vi.fn(async()=>({predictionId:"dp1"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f1",survey_id:"s1",container_face:"RIGHT",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      components:vi.fn(async()=>[
        {component_code:"PAA",component_name:"Panel Assembly",standard_version:"test"},
        {component_code:"RLA",component_name:"Rail Assembly",standard_version:"test"}
      ]),
      componentVisualRules:vi.fn(async()=>[
        {
          component_code:"PAA",container_face:"RIGHT",overview_zone:"CENTRAL_FIELD",
          visual_definition:"Broad corrugated side panel.",positive_cues:"Corrugated panel field.",
          negative_cues:"Not rail.",confusable_with:"RLA",force_review:0,source_reference:"test"
        }
      ]),
      damageCodesForComponent:vi.fn(async(_findingId:string,componentCode:string)=>{
        if(componentCode==="PAA")return {componentCode:"PAA",damages:[
          {damage_code:"DT",damage_name:"Dent / Bent"},
          {damage_code:"CK",damage_name:"Cracked"}
        ]};
        return {componentCode,damages:[{damage_code:"DT",damage_name:"Dent / Bent"}]};
      }),
      damageVisualRules:vi.fn(async()=>[
        {
          damage_code:"DT",component_code:"PAA",visual_definition:"Dent or deformation.",
          positive_cues:"Permanent displacement.",negative_cues:"No fracture.",
          confusable_with:"CK",evidence_requirement:"VISUAL",force_review:0,source_reference:"test"
        },
        {
          damage_code:"CK",component_code:"PAA",visual_definition:"Crack.",
          positive_cues:"Material split.",negative_cues:"Not dent only.",
          confusable_with:"DT",evidence_requirement:"VISUAL",force_review:0,source_reference:"test"
        }
      ]),
      saveComponentPrediction,
      saveDamagePrediction
    } as unknown as CedexRepository;

    const ai={run:vi.fn(async()=>({
      choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        component_code:"PAA",component_confidence:0.91,component_needs_review:false,
        component_reason:"Central damage lies on broad corrugated panel.",
        component_candidates:[{code:"PAA",confidence:0.91,reason:"Broad panel field."}],
        damage_code:"DT",damage_confidence:0.89,damage_needs_review:false,
        damage_reason:"Permanent inward deformation without crack.",
        damage_candidates:[{code:"DT",confidence:0.89,reason:"Visible deformation."}]
      })}}]
    }))};

    const result=await new OverviewAutoAnalysisService(repo,ai).analyse({
      findingId:"f1",file:photo(),
      damageBox:{x:0.3,y:0.35,width:0.2,height:0.22},
      locationCode:"RT3N"
    });

    expect(result.componentCode).toBe("PAA");
    expect(result.componentName).toBe("Panel Assembly");
    expect(result.selectedCode).toBe("DT");
    expect(result.selectedName).toBe("Dent / Bent");
    expect(result.locationCode).toBe("RT3N");
    expect(result.needsReview).toBe(false);
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(result.classificationMode).toBe("SINGLE_QWEN_COMPONENT_DAMAGE");
    expect(result.timings.classificationAiMs).toBeGreaterThanOrEqual(0);
    expect(saveComponentPrediction).toHaveBeenCalledWith(expect.objectContaining({
      selectedCode:"PAA",
      requestContext:expect.objectContaining({
        source:"ZERO_TOUCH_OVERVIEW_POC",
        classificationMode:"SINGLE_QWEN_COMPONENT_DAMAGE",
        manualTargetUsed:false,
        componentPinpointUsed:false
      })
    }));
    expect(saveDamagePrediction).toHaveBeenCalledWith(expect.objectContaining({
      selectedCode:"DT",
      requestContext:expect.objectContaining({
        source:"ZERO_TOUCH_OVERVIEW_POC",
        manualDamageBoxUsed:false,
        manualTargetUsed:false
      })
    }));
  });

  it("uses one unified Qwen result for full-overview localization, component and damage",async()=>{
    const saveComponentPrediction=vi.fn(async()=>({predictionId:"cp-orch"}));
    const saveDamagePrediction=vi.fn(async()=>({predictionId:"dp-orch"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f2",survey_id:"s2",container_face:"LEFT",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      saveComponentPrediction,
      saveDamagePrediction
    } as unknown as CedexRepository;

    const unifiedService={
      analyse:vi.fn(async()=>({
        pocMode:"ZERO_TOUCH_OVERVIEW",
        source:"FULL_OVERVIEW_ORCHESTRATOR",
        classificationMode:"SINGLE_QWEN_LOCALIZATION_COMPONENT_DAMAGE",
        imageScope:"FULL_OVERVIEW",
        speedProfile:"ZERO_TOUCH_FAST_768_1200",
        aiInput:{width:768,height:432,bytes:180000,longSide:768},
        damageBox:{x:0.23,y:0.48,width:0.18,height:0.18},
        locationCode:"LB4N",
        componentCode:"PAA",
        componentName:"Panel Assembly",
        componentConfidence:0.9,
        componentNeedsReview:false,
        componentReason:"Panel field.",
        componentCandidates:[{code:"PAA",confidence:0.9,reason:"Panel field."}],
        selectedCode:"DT",
        selectedName:"Dent / Bent",
        confidence:0.85,
        damageNeedsReview:false,
        damageReason:"Visible deformation.",
        candidates:[{code:"DT",confidence:0.85,reason:"Visible deformation."}],
        needsReview:true,
        analysisStatus:"SUGGESTED",
        model:"@cf/qwen/qwen3.8-27b",
        finishReason:"stop",
        completionTokenLimit:1200,
        localization:{
          localizationSource:"QWEN_PRIMARY_OVERRIDE_POINT",
          location:{code:"LB4N",reviewRequired:true,reason:"Review location."}
        },
        timings:{
          moondreamCandidateMs:80,
          unifiedQwenMs:1200,
          classificationAiMs:1200,
          totalClassificationMs:1210,
          totalAutoAnalysisMs:1300,
          aiInputWidth:768,
          aiInputHeight:432,
          aiInputBytes:180000,
          aiInputLongSide:768,
          qwenCalls:1,
          sharedQwenLocalizationClassification:true
        }
      }))
    } as any;
    const combinedService={analyse:vi.fn()} as any;

    const service=new OverviewAutoAnalysisService(repo,{run:vi.fn()},{
      unifiedService,
      combinedService
    });
    const result=await service.analyse({
      findingId:"f2",
      file:photo(),
      imageWidth:1600,
      imageHeight:900,
      captureMetadata:{fixedCameraMode:true,fixedCameraId:"L"},
      orchestrateLocalization:true
    });

    expect(unifiedService.analyse).toHaveBeenCalledTimes(1);
    expect(combinedService.analyse).not.toHaveBeenCalled();
    expect(result.source).toBe("FULL_OVERVIEW_ORCHESTRATOR");
    expect(result.classificationMode).toBe("SINGLE_QWEN_LOCALIZATION_COMPONENT_DAMAGE");
    expect((result as any).speedProfile).toBe("ZERO_TOUCH_FAST_768_1200");
    expect((result as any).completionTokenLimit).toBe(1200);
    expect((result as any).aiInput?.longSide).toBe(768);
    expect((result as any).localization?.localizationSource).toBe("QWEN_PRIMARY_OVERRIDE_POINT");
    expect(result.locationCode).toBe("LB4N");
    expect(result.componentCode).toBe("PAA");
    expect(result.selectedCode).toBe("DT");
    expect(result.needsReview).toBe(true);
    expect((result.timings as any).qwenCalls).toBe(1);
    expect(saveComponentPrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        imageScope:"FULL_OVERVIEW",
        localizationSource:"QWEN_PRIMARY_OVERRIDE_POINT",
        unifiedQwen:true
      })
    }));
    expect(saveDamagePrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        imageScope:"FULL_OVERVIEW",
        localizationSource:"QWEN_PRIMARY_OVERRIDE_POINT",
        unifiedQwen:true
      })
    }));
  });
});

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
        expect(componentCode).toBe("PAA");
        return {componentCode:"PAA",damages:[
          {damage_code:"DT",damage_name:"Dent / Bent"},
          {damage_code:"CK",damage_name:"Cracked"}
        ]};
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

    let call=0;
    const ai={run:vi.fn(async()=>{
      call++;
      if(call===1){
        return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          selected_code:"PAA",confidence:0.91,needs_review:false,
          reason:"Central damage lies on broad corrugated panel.",
          candidates:[{code:"PAA",confidence:0.91,reason:"Broad panel field."}]
        })}}]};
      }
      return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        selected_code:"DT",confidence:0.89,needs_review:false,
        reason:"Permanent inward deformation without crack.",
        candidates:[{code:"DT",confidence:0.89,reason:"Visible deformation."}]
      })}}]};
    })};

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
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(saveComponentPrediction).toHaveBeenCalledWith(expect.objectContaining({
      selectedCode:"PAA",
      requestContext:expect.objectContaining({
        source:"ZERO_TOUCH_OVERVIEW_POC",
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
});

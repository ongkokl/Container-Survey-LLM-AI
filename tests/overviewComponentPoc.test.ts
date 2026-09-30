import { describe, expect, it, vi } from "vitest";
import { OverviewComponentPocService } from "../src/application/overviewComponentPocService";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

function photo(){
  return new File([new Uint8Array([1,2,3])],"crop.jpg",{type:"image/jpeg"});
}

describe("overview component POC",()=>{
  it("identifies the underlying component without a surveyor pinpoint",async()=>{
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f1",survey_id:"s1",container_face:"RIGHT",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      components:vi.fn(async()=>[
        {component_code:"PAA",component_name:"Panel Assembly",standard_version:"test"},
        {component_code:"RLA",component_name:"Rail Assembly",standard_version:"test"},
        {component_code:"FLA",component_name:"Forklift Pocket Assembly",standard_version:"test"}
      ]),
      componentVisualRules:vi.fn(async()=>[
        {
          component_code:"RLA",container_face:"RIGHT",overview_zone:"BOTTOM_EDGE",
          visual_definition:"Longitudinal structural rail.",positive_cues:"Continuous rail member.",
          negative_cues:"Not corrugated panel or forklift pocket.",confusable_with:"PAA,FLA",
          force_review:0,source_reference:"test"
        }
      ])
    } as unknown as CedexRepository;

    const ai={run:vi.fn(async(_model:string,input:unknown)=>{
      const request=input as {
        messages:Array<{content:Array<{type:string;text?:string}>}>,
        response_format:{json_schema:{schema:{properties:{selected_code:{enum:Array<string|null>}}}}}
      };
      const prompt=String(request.messages[0].content[0].text??"");
      expect(prompt).toContain("No surveyor crosshair or pinpoint exists");
      expect(prompt).toContain("UNDERLYING PHYSICAL COMPONENT");
      expect(prompt).toContain("RLA = Rail Assembly");
      expect(prompt).toContain("Container face: RIGHT");
      return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        selected_code:"RLA",confidence:0.87,needs_review:false,
        reason:"Central target is the continuous lower structural rail.",
        candidates:[
          {code:"RLA",confidence:0.87,reason:"Continuous lower rail."},
          {code:"PAA",confidence:0.1,reason:"Panel is above target."}
        ]
      })}}]};
    })};

    const result=await new OverviewComponentPocService(repo,ai).analyse({
      findingId:"f1",file:photo(),
      damageBox:{x:0.3,y:0.78,width:0.18,height:0.12},
      locationCode:"RB3N"
    });

    expect(result.selectedCode).toBe("RLA");
    expect(result.selectedName).toBe("Rail Assembly");
    expect(result.confidence).toBe(0.87);
    expect(result.needsReview).toBe(false);
    expect(result.overviewZone).toBe("BOTTOM_EDGE");
  });
});

import { describe, expect, it, vi } from "vitest";
import { OverviewDamagePocService } from "../src/application/overviewDamagePocService";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

function file(){
  return new File([new Uint8Array([1,2,3])],"damage.jpg",{type:"image/jpeg"});
}

describe("overview-only damage POC",()=>{
  it("classifies one AI-detected GP panel damage crop as DT without requiring a confirmed component",async()=>{
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f1",survey_id:"s1",container_face:"RIGHT",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      damageCodesForComponent:vi.fn(async(_findingId:string,componentCode:string)=>{
        expect(componentCode).toBe("PAA");
        return {
          componentCode:"PAA",
          damages:[
            {damage_code:"CK",damage_name:"Cracked"},
            {damage_code:"CU",damage_name:"Cut"},
            {damage_code:"DT",damage_name:"Dent / Bent"},
            {damage_code:"PF",damage_name:"Paint failure"},
            {damage_code:"IR",damage_name:"Improper / Non-conforming repair"},
            {damage_code:"ME",damage_name:"Existing manufacturing defect"}
          ]
        };
      }),
      damageVisualRules:vi.fn(async()=>[
        {
          damage_code:"CK",component_code:"PAA",visual_definition:"Crack or fracture.",
          positive_cues:"Split line.",negative_cues:"Not dent only.",confusable_with:"DT",
          evidence_requirement:"VISUAL",force_review:0,source_reference:"test"
        },
        {
          damage_code:"CU",component_code:"PAA",visual_definition:"Cut.",
          positive_cues:"Severed edge.",negative_cues:"Not dent only.",confusable_with:"DT",
          evidence_requirement:"VISUAL",force_review:0,source_reference:"test"
        },
        {
          damage_code:"DT",component_code:"PAA",visual_definition:"Dent or permanent deformation.",
          positive_cues:"Panel depression or buckle.",negative_cues:"No crack/cut.",confusable_with:"PF",
          evidence_requirement:"VISUAL",force_review:0,source_reference:"test"
        },
        {
          damage_code:"PF",component_code:"PAA",visual_definition:"Paint failure.",
          positive_cues:"Coating loss.",negative_cues:"Not structural deformation.",confusable_with:"DT",
          evidence_requirement:"VISUAL",force_review:0,source_reference:"test"
        },
        {
          damage_code:"IR",component_code:"PAA",visual_definition:"Improper previous repair.",
          positive_cues:"Patch or weld.",negative_cues:"Needs surveyor conformity review.",confusable_with:"ME",
          evidence_requirement:"HISTORY_CONTEXT",force_review:1,source_reference:"test"
        },
        {
          damage_code:"ME",component_code:"PAA",visual_definition:"Manufacturing defect.",
          positive_cues:"Fabrication origin.",negative_cues:"Needs history.",confusable_with:"IR",
          evidence_requirement:"HISTORY_CONTEXT",force_review:1,source_reference:"test"
        }
      ])
    } as unknown as CedexRepository;

    const ai={run:vi.fn(async(_model:string,input:unknown)=>{
      const request=input as {
        messages:Array<{content:Array<{type:string;text?:string}>}>,
        response_format:{json_schema:{schema:{properties:{selected_code:{enum:Array<string|null>}}}}},
        max_completion_tokens:number
      };
      const prompt=String(request.messages[0].content[0].text??"");
      expect(prompt).toContain("component is intentionally assumed to be PAA");
      expect(prompt).toContain("DT for permanent panel displacement");
      expect(prompt).toContain("Calculated CEDEX location: RB3N");
      expect(prompt).toContain("IR may be suggested");
      expect(prompt).toContain("DT = Dent / Bent");
      expect(prompt).not.toContain("ME = Existing manufacturing defect");
      expect(request.max_completion_tokens).toBe(2000);
      const codes=request.response_format.json_schema.schema.properties.selected_code.enum;
      expect(codes).toContain("DT");
      expect(codes).toContain("IR");
      expect(codes).not.toContain("ME");
      return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        selected_code:"DT",
        confidence:0.88,
        needs_review:false,
        reason:"Permanent inward panel deformation without crack or cut.",
        candidates:[
          {code:"DT",confidence:0.88,reason:"Panel deformation."},
          {code:"PF",confidence:0.12,reason:"Minor coating loss is secondary."}
        ]
      })}}]};
    })};

    const result=await new OverviewDamagePocService(repo,ai).analyse({
      findingId:"f1",
      file:file(),
      damageBox:{x:0.25,y:0.3,width:0.2,height:0.22},
      locationCode:"RB3N"
    });

    expect(result.pocMode).toBe("OVERVIEW_SINGLE_PAA_DAMAGE");
    expect(result.componentCode).toBe("PAA");
    expect(result.componentAssumed).toBe(true);
    expect(result.locationCode).toBe("RB3N");
    expect(result.selectedCode).toBe("DT");
    expect(result.selectedName).toBe("Dent / Bent");
    expect(result.confidence).toBe(0.88);
    expect(result.needsReview).toBe(false);
    expect(result.aiEligibleDamageCodes).toContain("IR");
    expect(result.excludedFromPhotoOnlyAi).toContain("ME");
  });

  it("forces review for IR even when the model does not",async()=>{
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f2",survey_id:"s2",container_face:"LEFT",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      damageCodesForComponent:vi.fn(async()=>({
        componentCode:"PAA",
        damages:[{damage_code:"IR",damage_name:"Improper / Non-conforming repair"}]
      })),
      damageVisualRules:vi.fn(async()=>[{
        damage_code:"IR",component_code:"PAA",visual_definition:"Improper previous repair.",
        positive_cues:"Patch or weld.",negative_cues:"Needs confirmation.",confusable_with:"",
        evidence_requirement:"HISTORY_CONTEXT",force_review:1,source_reference:"test"
      }])
    } as unknown as CedexRepository;
    const ai={run:vi.fn(async()=>({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
      selected_code:"IR",confidence:0.95,needs_review:false,
      reason:"Visible previous patch repair.",
      candidates:[{code:"IR",confidence:0.95,reason:"Previous patch repair."}]
    })}}]}))};

    const result=await new OverviewDamagePocService(repo,ai).analyse({
      findingId:"f2",file:file(),damageBox:{x:0.1,y:0.2,width:0.2,height:0.2},locationCode:"LB2N"
    });
    expect(result.selectedCode).toBe("IR");
    expect(result.needsReview).toBe(true);
    expect(result.evidenceReviewRequired).toBe(true);
  });
});

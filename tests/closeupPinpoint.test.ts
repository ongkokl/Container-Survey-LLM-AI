import { describe, expect, it, vi } from "vitest";
import { CedexClassificationService } from "../src/application/cedexClassificationService";
import { DamageClassificationService } from "../src/application/damageClassificationService";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

function imageObject(){
  return {arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
}

describe("close-up pinpoint targeting",()=>{
  it("uses the surveyor component point for Qwen component classification",async()=>{
    const saveComponentPrediction=vi.fn(async()=>({predictionId:"pred-1"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f1",survey_id:"s1",container_face:"RIGHT",final_location_code:"RB24",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      equipmentForFinding:vi.fn(async()=>"GP"),
      components:vi.fn(async()=>[
        {component_code:"PAA",component_name:"Panel Assembly",standard_version:"2025"}
      ]),
      findingPhoto:vi.fn(async(_id:string,role:string)=>{
        if(role==="DAMAGE_CLOSEUP")return {id:"photo-1",r2_key:"closeup.jpg",content_type:"image/jpeg"};
        if(role==="COMPONENT_CLOSEUP")return {id:"target-1",r2_key:"target.jpg",content_type:"image/jpeg"};
        return null;
      }),
      surveyorComponentPoint:vi.fn(async()=>({x:0.42,y:0.37})),
      surveyorLocationPoint:vi.fn(async()=>null),
      componentVisualRules:vi.fn(async()=>[]),
      saveComponentPrediction
    } as unknown as CedexRepository;

    const ai={run:vi.fn(async(_model:string,input:unknown)=>{
      const request=input as {messages:Array<{content:Array<{type:string;text?:string}>}>};
      const prompt=String(request.messages[0].content[0].text??"");
      expect(prompt).toContain("surveyor pinpointed the target");
      expect(prompt).toContain("x=0.4200, y=0.3700");
      expect(prompt).toContain("Confirmed CEDEX location from the overview workflow: RB24");
      expect(prompt).toContain("supporting structural-position context only");
      expect(prompt).toContain("Do not choose a component from the location code alone");
      expect(prompt).toContain("fine cyan laser reticle");
      expect(prompt).toContain("reticle is an overlay");
      expect(prompt).not.toContain("damage box");
      const images=request.messages[0].content.filter(item=>item.type==="image_url");
      expect(images).toHaveLength(2);
      return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        selected_code:"PAA",confidence:0.95,needs_review:false,
        reason:"Target point lies on corrugated panel.",
        candidates:[{code:"PAA",confidence:0.95,reason:"Corrugated panel."}]
      })}}]};
    })};

    const result=await new CedexClassificationService(
      repo,
      {get:vi.fn(async()=>imageObject())},
      ai
    ).analyseComponent("f1");

    expect(result.targetPointUsed).toBe(true);
    expect(result.targetCropUsed).toBe(true);
    expect(saveComponentPrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        targetPoint:{x:0.42,y:0.37},
        componentTargetPhotoId:"target-1",
        targetCropUsed:true,
        targetCropReticle:"FINE_LASER",
        confirmedLocationCode:"RB24",
        locationContextUsed:true
      })
    }));
  });

  it("uses the same pinpoint as the primary target for damage classification",async()=>{
    const saveDamagePrediction=vi.fn(async()=>({predictionId:"pred-2"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f1",survey_id:"s1",container_face:"RIGHT",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      damageCodesForFinding:vi.fn(async()=>({
        componentCode:"PAA",
        damages:[{damage_code:"DT",damage_name:"Dent / Bent"}]
      })),
      findingPhoto:vi.fn(async()=>({id:"photo-1",r2_key:"closeup.jpg",content_type:"image/jpeg"})),
      surveyorComponentPoint:vi.fn(async()=>({x:0.51,y:0.48})),
      damageVisualRules:vi.fn(async()=>[{
        damage_code:"DT",component_code:"PAA",
        visual_definition:"Visible dent deformation.",
        positive_cues:"Local panel deformation.",
        negative_cues:"Not a scratch.",
        confusable_with:"GD",
        evidence_requirement:"VISUAL",
        force_review:0,
        source_reference:"test"
      }]),
      saveDamagePrediction
    } as unknown as CedexRepository;

    const ai={run:vi.fn(async(_model:string,input:unknown)=>{
      const request=input as {messages:Array<{content:Array<{type:string;text?:string}>}>};
      const prompt=String(request.messages[0].content[0].text??"");
      expect(prompt).toContain("surveyor pinpointed the intended damage");
      expect(prompt).toContain("x=0.5100, y=0.4800");
      expect(prompt).not.toContain("marked region");
      return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        selected_code:"DT",confidence:0.93,needs_review:false,
        reason:"Visible local dent deformation.",
        candidates:[{code:"DT",confidence:0.93,reason:"Dent morphology."}]
      })}}]};
    })};

    const result=await new DamageClassificationService(
      repo,
      {get:vi.fn(async()=>imageObject())},
      ai
    ).analyse("f1");

    expect(result.targetPointUsed).toBe(true);
    expect(saveDamagePrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        targetPoint:{x:0.51,y:0.48}
      })
    }));
  });
});

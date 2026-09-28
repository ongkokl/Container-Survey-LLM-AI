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

  it("narrows a high-confidence GP door locking-bar family before exact HWH/HWR classification",async()=>{
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f-hw",survey_id:"s-hw",container_face:"DOOR",final_location_code:"DX2N",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      equipmentForFinding:vi.fn(async()=>"GP"),
      components:vi.fn(async()=>[
        {component_code:"HWH",component_name:"Hardware - Huckbolt",standard_version:"2025"},
        {component_code:"HWR",component_name:"Hardware",standard_version:"2025"},
        {component_code:"LBB",component_name:"Locking Bar Bracket",standard_version:"2025"},
        {component_code:"LBG",component_name:"Locking Bar Guide",standard_version:"2025"},
        {component_code:"LBR",component_name:"Locking Bar Rod",standard_version:"2025"},
        {component_code:"PAA",component_name:"Panel Assembly",standard_version:"2025"},
        {component_code:"HGA",component_name:"Hinge Assembly",standard_version:"2025"},
        {component_code:"HGB",component_name:"Hinge Blade",standard_version:"2025"},
        {component_code:"HGP",component_name:"Hinge Pin",standard_version:"2025"},
        {component_code:"GTA",component_name:"Gasket Assembly",standard_version:"2025"},
        {component_code:"GRS",component_name:"Gasket Retainer Strip",standard_version:"2025"},
        {component_code:"DFA",component_name:"Door Frame Assembly",standard_version:"2025"},
        {component_code:"CPA",component_name:"Corner Post Assembly",standard_version:"2025"},
        {component_code:"MPD",component_name:"Consolidated Data Plate",standard_version:"2025"}
      ]),
      findingPhoto:vi.fn(async(_id:string,role:string)=>{
        if(role==="DAMAGE_CLOSEUP")return {id:"photo-hw",r2_key:"closeup-hw.jpg",content_type:"image/jpeg"};
        if(role==="COMPONENT_CLOSEUP")return {id:"target-hw",r2_key:"target-hw.jpg",content_type:"image/jpeg"};
        if(role==="FACE_OVERVIEW")return {id:"overview-hw",r2_key:"overview-hw.jpg",content_type:"image/jpeg"};
        return null;
      }),
      surveyorComponentPoint:vi.fn(async()=>({x:0.5,y:0.5})),
      surveyorLocationPoint:vi.fn(async()=>({x:0.5,y:0.5})),
      componentVisualRules:vi.fn(async()=>[
        {
          equipment_type:"GP",component_code:"HWH",container_face:"DOOR",overview_zone:"ANY",
          visual_definition:"Specific Huckbolt",positive_cues:"Positive Huckbolt identification",
          negative_cues:"Round head alone is insufficient",confusable_with:"HWR,LBB",
          force_review:0,source_reference:"test",priority:190,active:1
        },
        {
          equipment_type:"GP",component_code:"HWR",container_face:"DOOR",overview_zone:"ANY",
          visual_definition:"Generic hardware",positive_cues:"Generic fastener",
          negative_cues:"Not positively identified HWH",confusable_with:"HWH,LBB",
          force_review:0,source_reference:"test",priority:180,active:1
        }
      ]),
      saveComponentPrediction:vi.fn(async()=>({predictionId:"pred-hw"}))
    } as unknown as CedexRepository;

    const ai={run:vi.fn()
      .mockImplementationOnce(async(_model:string,input:unknown)=>{
        const request=input as {messages:Array<{content:Array<{type:string;text?:string}>}>};
        const prompt=String(request.messages[0].content[0].text??"");
        expect(prompt).toContain("Identify the local GP dry-container DOOR assembly family");
        expect(prompt).toContain("LOCKING_BAR_SUPPORT");
        return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          family:"LOCKING_BAR_SUPPORT",confidence:0.94,
          reason:"The reticle is on the locking-bar bracket/fastener support area."
        })}}]};
      })
      .mockImplementationOnce(async(_model:string,input:unknown)=>{
        const request=input as {
          messages:Array<{content:Array<{type:string;text?:string}>}>,
          response_format:{json_schema:{schema:{properties:{selected_code:{enum:string[]}}}}}
        };
        const prompt=String(request.messages[0].content[0].text??"");
        expect(prompt).toContain("final AI candidate list was narrowed from 14 to 5 codes");
        expect(prompt).toContain("A round fastener head by itself is NOT enough evidence for HWH");
        expect(prompt).toContain("prefer HWR");
        expect(prompt).not.toContain("PAA = Panel Assembly");
        expect(prompt).not.toContain("HGA = Hinge Assembly");
        const enumCodes=request.response_format.json_schema.schema.properties.selected_code.enum;
        expect(enumCodes).toContain("HWR");
        expect(enumCodes).toContain("HWH");
        expect(enumCodes).toContain("LBB");
        expect(enumCodes).not.toContain("PAA");
        expect(enumCodes).not.toContain("HGA");
        return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          selected_code:"HWR",confidence:0.82,needs_review:false,
          reason:"The target is generic fastening hardware without positive Huckbolt-specific identification.",
          candidates:[
            {code:"HWR",confidence:0.82,reason:"Generic fastener."},
            {code:"HWH",confidence:0.18,reason:"Huckbolt-specific construction is not established."}
          ]
        })}}]};
      })};

    const result=await new CedexClassificationService(
      repo,
      {get:vi.fn(async()=>imageObject())},
      ai
    ).analyseComponent("f-hw");

    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(result.selectedCode).toBe("HWR");
    expect(result.fullAllowedCount).toBe(14);
    expect(result.classificationAllowedCount).toBe(5);
    expect(result.componentFamilyInferenceUsed).toBe(true);
    expect(result.componentFamily).toBe("LOCKING_BAR_SUPPORT");
    expect(result.componentFamilyConfidence).toBe(0.94);
    expect(result.componentFamilyNarrowingUsed).toBe(true);
    expect(result.componentFamilyFallbackUsed).toBe(false);
    expect(result.hardwareSpecificityRuleUsed).toBe(true);
  });

  it("falls back to the full GP door component list when family confidence is low",async()=>{
    const componentCodes=["HWH","HWR","LBB","LBG","LBR","PAA","HGA","HGB","HGP","GTA","GRS","DFA","CPA","MPD"];
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f-low",survey_id:"s-low",container_face:"DOOR",final_location_code:"DX2N",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      equipmentForFinding:vi.fn(async()=>"GP"),
      components:vi.fn(async()=>componentCodes.map(code=>({
        component_code:code,component_name:code,standard_version:"2025"
      }))),
      findingPhoto:vi.fn(async(_id:string,role:string)=>{
        if(role==="DAMAGE_CLOSEUP")return {id:"photo-low",r2_key:"closeup-low.jpg",content_type:"image/jpeg"};
        if(role==="COMPONENT_CLOSEUP")return {id:"target-low",r2_key:"target-low.jpg",content_type:"image/jpeg"};
        return null;
      }),
      surveyorComponentPoint:vi.fn(async()=>({x:0.5,y:0.5})),
      surveyorLocationPoint:vi.fn(async()=>null),
      componentVisualRules:vi.fn(async()=>[]),
      saveComponentPrediction:vi.fn(async()=>({predictionId:"pred-low"}))
    } as unknown as CedexRepository;

    const ai={run:vi.fn()
      .mockImplementationOnce(async()=>({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        family:"HINGE",confidence:0.61,reason:"The target is too ambiguous to narrow safely."
      })}}]}))
      .mockImplementationOnce(async(_model:string,input:unknown)=>{
        const request=input as {
          response_format:{json_schema:{schema:{properties:{selected_code:{enum:string[]}}}}}
        };
        const enumCodes=request.response_format.json_schema.schema.properties.selected_code.enum;
        expect(enumCodes).toContain("PAA");
        expect(enumCodes).toContain("HGA");
        expect(enumCodes).toContain("HWH");
        return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          selected_code:"PAA",confidence:0.86,needs_review:false,
          reason:"The exact target lies on the door panel.",
          candidates:[{code:"PAA",confidence:0.86,reason:"Door panel."}]
        })}}]};
      })};

    const result=await new CedexClassificationService(
      repo,
      {get:vi.fn(async()=>imageObject())},
      ai
    ).analyseComponent("f-low");

    expect(result.fullAllowedCount).toBe(14);
    expect(result.classificationAllowedCount).toBe(14);
    expect(result.componentFamilyInferenceUsed).toBe(true);
    expect(result.componentFamily).toBe("HINGE");
    expect(result.componentFamilyConfidence).toBe(0.61);
    expect(result.componentFamilyNarrowingUsed).toBe(false);
    expect(result.componentFamilyFallbackUsed).toBe(true);
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
      expect(prompt).toContain("A true material discontinuity at the pinpoint");
      expect(prompt).toContain("Do not label CK/CU as DT");
      expect(prompt).toContain("Do not label a clear DT as PF or CO");
      expect(prompt).not.toContain("marked region");
      const images=request.messages[0].content.filter(item=>item.type==="image_url");
      expect(images).toHaveLength(2);
      const targetCropText=request.messages[0].content
        .filter(item=>item.type==="text")
        .map(item=>item.text??"")
        .join("\n");
      expect(targetCropText).toContain("Fine-reticle target crop");
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
    expect(result.targetCropUsed).toBe(true);
    expect(result.morphologyPriorityUsed).toBe(true);
    expect(saveDamagePrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        targetPoint:{x:0.51,y:0.48},
        targetCropUsed:true,
        targetCropReticle:"FINE_LASER",
        morphologyPriorityUsed:true
      })
    }));
  });
});

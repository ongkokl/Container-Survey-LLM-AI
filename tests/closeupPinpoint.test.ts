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
      expect(prompt).toContain("surveyor pinpointed the component target");
      expect(prompt).toContain("x=0.4200, y=0.3700");
      expect(prompt).toContain("Confirmed CEDEX location from the overview workflow: RB24");
      expect(prompt).toContain("weak structural-position context");
      expect(prompt).toContain("Do not choose a component from the location code alone");
      expect(prompt).toContain("fine cyan reticle");
      expect(prompt).toContain("reticle is an overlay");
      expect(prompt).toContain("damage-area box or damage extent is for damage size/location");
      expect(prompt).toContain("must NEVER be used as the component target");
      const content=request.messages[0].content;
      const images=content.filter(item=>item.type==="image_url");
      expect(images).toHaveLength(2);
      expect(String(content[1]?.text??"")).toContain("PRIMARY LOCAL TARGET");
      expect(String(content[3]?.text??"")).toContain("SECONDARY CONTEXT");
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
    expect(result.localEvidencePriorityUsed).toBe(true);
    expect(saveComponentPrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        targetPoint:{x:0.42,y:0.37},
        componentTargetPhotoId:"target-1",
        targetCropUsed:true,
        targetCropReticle:"FINE_LASER",
        localEvidencePriorityUsed:true,
        damageAreaUsedForComponent:false,
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
    expect(result.componentFamilyScope).toBe("GP_DOOR");
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
    expect(result.componentFamilyScope).toBe("GP_DOOR");
    expect(result.componentFamily).toBe("HINGE");
    expect(result.componentFamilyConfidence).toBe(0.61);
    expect(result.componentFamilyNarrowingUsed).toBe(false);
    expect(result.componentFamilyFallbackUsed).toBe(true);
  });

  it("uses local structural family evidence to suppress PAA when the crosshair is on a corner fitting",async()=>{
    const componentCodes=[
      ["PAA","Panel Assembly"],["CFG","Corner Fitting"],["CPO","Corner Post Outer Piece"],
      ["CPA","Corner Post Assembly"],["RLA","Rail Assembly"],["RLG","Rail Gusset"],
      ["RDP","Rail Doubling Plate"],["RCI","Rail Corner Protector Recess"],["VRA","Ventilator"],
      ["FLP","Forklift Pocket Top Plate"],["FLS","Forklift Pocket Strap"],["FLT","Forklift Pocket Whole Transverse Section"],
      ["FLA","Forklift Pocket Assembly"],["DRH","Door Chain Hook"]
    ];
    const saveComponentPrediction=vi.fn(async()=>({predictionId:"pred-cfg"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f-cfg",survey_id:"s-cfg",container_face:"RIGHT",final_location_code:"RT1N",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      equipmentForFinding:vi.fn(async()=>"GP"),
      components:vi.fn(async()=>componentCodes.map(([component_code,component_name])=>({
        component_code,component_name,standard_version:"2025"
      }))),
      findingPhoto:vi.fn(async(_id:string,role:string)=>{
        if(role==="DAMAGE_CLOSEUP")return {id:"photo-cfg",r2_key:"closeup-cfg.jpg",content_type:"image/jpeg"};
        if(role==="COMPONENT_CLOSEUP")return {
          id:"target-cfg",r2_key:"target-cfg.jpg",content_type:"image/jpeg",
          capture_metadata_json:JSON.stringify({version:"component_target_crop_v3",targetEvidenceMode:"DUAL_SCALE_LOCAL"})
        };
        if(role==="FACE_OVERVIEW")return {id:"overview-cfg",r2_key:"overview-cfg.jpg",content_type:"image/jpeg"};
        return null;
      }),
      surveyorComponentPoint:vi.fn(async()=>({x:0.88,y:0.10})),
      surveyorLocationPoint:vi.fn(async()=>({x:0.92,y:0.10})),
      componentVisualRules:vi.fn(async()=>[]),
      saveComponentPrediction
    } as unknown as CedexRepository;

    const ai={run:vi.fn()
      .mockImplementationOnce(async(_model:string,input:unknown)=>{
        const request=input as {messages:Array<{content:Array<{type:string;text?:string}>}>};
        const prompt=String(request.messages[0].content[0].text??"");
        expect(prompt).toContain("GP dry-container structural family");
        expect(prompt).toContain("CORNER_FITTING");
        expect(prompt).toContain("overall image must not override");
        return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          family:"CORNER_FITTING",confidence:0.96,
          reason:"The reticle is centred on the block-like ISO corner casting."
        })}}]};
      })
      .mockImplementationOnce(async(_model:string,input:unknown)=>{
        const request=input as {
          messages:Array<{content:Array<{type:string;text?:string}>}>,
          response_format:{json_schema:{schema:{properties:{selected_code:{enum:Array<string|null>}}}}}
        };
        const prompt=String(request.messages[0].content[0].text??"");
        expect(prompt).not.toContain("PAA = Panel Assembly");
        expect(prompt).toContain("CFG = Corner Fitting");
        const enumCodes=request.response_format.json_schema.schema.properties.selected_code.enum;
        expect(enumCodes).toEqual(["CFG",null]);
        const content=request.messages[0].content;
        expect(String(content[1]?.text??"")).toContain("PRIMARY LOCAL TARGET");
        expect(String(content[3]?.text??"")).toContain("SECONDARY CONTEXT");
        expect(content.filter(item=>item.type==="image_url")).toHaveLength(2);
        return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          selected_code:"CFG",confidence:0.96,needs_review:false,
          reason:"The crosshair centre is on the corner fitting.",
          candidates:[{code:"CFG",confidence:0.96,reason:"Block-like corner fitting at the target."}]
        })}}]};
      })};

    const result=await new CedexClassificationService(
      repo,
      {get:vi.fn(async()=>imageObject())},
      ai
    ).analyseComponent("f-cfg");

    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(result.selectedCode).toBe("CFG");
    expect(result.componentFamilyScope).toBe("GP_STRUCTURAL");
    expect(result.componentFamily).toBe("CORNER_FITTING");
    expect(result.componentFamilyNarrowingUsed).toBe(true);
    expect(result.classificationAllowedCount).toBe(1);
    expect(result.classificationAllowedComponents.map(x=>x.component_code)).toEqual(["CFG"]);
    expect(result.overviewImageUsed).toBe(false);
    expect(saveComponentPrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        componentFamilyScope:"GP_STRUCTURAL",
        componentFamily:"CORNER_FITTING",
        componentFamilyNarrowingUsed:true,
        targetEvidenceMode:"DUAL_SCALE_LOCAL",
        localEvidencePriorityUsed:true,
        damageAreaUsedForComponent:false
      })
    }));
  });

  it("narrows a side corner-post target to CPO/CPA instead of the dominant PAA panel",async()=>{
    const componentCodes=[
      ["PAA","Panel Assembly"],["CFG","Corner Fitting"],["CPO","Corner Post Outer Piece"],
      ["CPA","Corner Post Assembly"],["RLA","Rail Assembly"],["RLG","Rail Gusset"],
      ["RDP","Rail Doubling Plate"],["RCI","Rail Corner Protector Recess"],["VRA","Ventilator"],
      ["FLP","Forklift Pocket Top Plate"],["FLS","Forklift Pocket Strap"],["FLT","Forklift Pocket Whole Transverse Section"],
      ["FLA","Forklift Pocket Assembly"],["DRH","Door Chain Hook"]
    ];
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f-cpo",survey_id:"s-cpo",container_face:"RIGHT",final_location_code:"RB1N",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      equipmentForFinding:vi.fn(async()=>"GP"),
      components:vi.fn(async()=>componentCodes.map(([component_code,component_name])=>({
        component_code,component_name,standard_version:"2025"
      }))),
      findingPhoto:vi.fn(async(_id:string,role:string)=>{
        if(role==="DAMAGE_CLOSEUP")return {id:"photo-cpo",r2_key:"closeup-cpo.jpg",content_type:"image/jpeg"};
        if(role==="COMPONENT_CLOSEUP")return {
          id:"target-cpo",r2_key:"target-cpo.jpg",content_type:"image/jpeg",
          capture_metadata_json:JSON.stringify({version:"component_target_crop_v3",targetEvidenceMode:"DUAL_SCALE_LOCAL"})
        };
        return null;
      }),
      surveyorComponentPoint:vi.fn(async()=>({x:0.86,y:0.46})),
      surveyorLocationPoint:vi.fn(async()=>null),
      componentVisualRules:vi.fn(async()=>[]),
      saveComponentPrediction:vi.fn(async()=>({predictionId:"pred-cpo"}))
    } as unknown as CedexRepository;

    const ai={run:vi.fn()
      .mockImplementationOnce(async()=>({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        family:"CORNER_POST",confidence:0.93,
        reason:"The reticle is centred on the vertical corner-post structure."
      })}}]}))
      .mockImplementationOnce(async(_model:string,input:unknown)=>{
        const request=input as {
          response_format:{json_schema:{schema:{properties:{selected_code:{enum:Array<string|null>}}}}}
        };
        const enumCodes=request.response_format.json_schema.schema.properties.selected_code.enum;
        expect(enumCodes).toContain("CPO");
        expect(enumCodes).toContain("CPA");
        expect(enumCodes).not.toContain("PAA");
        return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          selected_code:"CPO",confidence:0.9,needs_review:false,
          reason:"The crosshair centre is on the outer vertical corner-post piece.",
          candidates:[
            {code:"CPO",confidence:0.9,reason:"Outer post surface."},
            {code:"CPA",confidence:0.1,reason:"Assembly-level alternative."}
          ]
        })}}]};
      })};

    const result=await new CedexClassificationService(
      repo,
      {get:vi.fn(async()=>imageObject())},
      ai
    ).analyseComponent("f-cpo");

    expect(result.selectedCode).toBe("CPO");
    expect(result.componentFamilyScope).toBe("GP_STRUCTURAL");
    expect(result.componentFamily).toBe("CORNER_POST");
    expect(result.componentFamilyNarrowingUsed).toBe(true);
    expect(result.classificationAllowedComponents.map(x=>x.component_code).sort()).toEqual(["CPA","CPO"]);
  });

  it("recognises a side forklift-pocket target before rail/panel classification",async()=>{
    const componentCodes=[
      ["PAA","Panel Assembly"],["RLA","Rail Assembly"],["RDP","Rail Doubling Plate"],
      ["FLA","Forklift Pocket Assembly"],["FLT","Forklift Pocket Whole Transverse Section"],
      ["FLP","Forklift Pocket Top Plate"],["FLS","Forklift Pocket Strap"],
      ["CFG","Corner Fitting"],["CPO","Corner Post Outer Piece"],["CPA","Corner Post Assembly"],
      ["RCI","Rail Corner Protector Recess"],["RLG","Rail Gusset"],["VRA","Ventilator"],["DRH","Door Chain Hook"]
    ];
    const saveComponentPrediction=vi.fn(async()=>({predictionId:"pred-fork"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f-fork",survey_id:"s-fork",container_face:"LEFT",final_location_code:"LB4N",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      equipmentForFinding:vi.fn(async()=>"GP"),
      components:vi.fn(async()=>componentCodes.map(([component_code,component_name])=>({
        component_code,component_name,standard_version:"2025"
      }))),
      findingPhoto:vi.fn(async(_id:string,role:string)=>{
        if(role==="DAMAGE_CLOSEUP")return {id:"photo-fork",r2_key:"closeup-fork.jpg",content_type:"image/jpeg"};
        if(role==="COMPONENT_CLOSEUP")return {
          id:"target-fork",r2_key:"target-fork.jpg",content_type:"image/jpeg",
          capture_metadata_json:JSON.stringify({version:"component_target_crop_v3",targetEvidenceMode:"DUAL_SCALE_LOCAL"})
        };
        if(role==="FACE_OVERVIEW")return {id:"overview-fork",r2_key:"overview-fork.jpg",content_type:"image/jpeg"};
        return null;
      }),
      surveyorComponentPoint:vi.fn(async()=>({x:0.34,y:0.83})),
      surveyorLocationPoint:vi.fn(async()=>({x:0.34,y:0.83})),
      componentVisualRules:vi.fn(async()=>[]),
      saveComponentPrediction
    } as unknown as CedexRepository;

    const ai={run:vi.fn()
      .mockImplementationOnce(async(_model:string,input:unknown)=>{
        const request=input as {messages:Array<{content:Array<{type:string;text?:string}>}>};
        const prompt=String(request.messages[0].content[0].text??"");
        expect(prompt).toContain("FORKLIFT_POCKET");
        expect(prompt).toContain("fork-entry pocket/opening");
        expect(prompt).toContain("do NOT collapse it into a general rail");
        return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          family:"FORKLIFT_POCKET",confidence:0.94,
          reason:"The reticle is centred on the visible fork-entry pocket opening."
        })}}]};
      })
      .mockImplementationOnce(async(_model:string,input:unknown)=>{
        const request=input as {
          messages:Array<{content:Array<{type:string;text?:string}>}>,
          response_format:{json_schema:{schema:{properties:{selected_code:{enum:Array<string|null>}}}}}
        };
        const prompt=String(request.messages[0].content[0].text??"");
        expect(prompt).toContain("GP forklift-pocket family stage");
        expect(prompt).toContain("FLA = Forklift Pocket Assembly");
        expect(prompt).toContain("FLT = Forklift Pocket Whole Transverse Section");
        expect(prompt).toContain("FLP = Forklift Pocket Top Plate");
        expect(prompt).toContain("FLS = Forklift Pocket Strap");
        expect(prompt).not.toContain("RLA = Rail Assembly");
        expect(prompt).not.toContain("PAA = Panel Assembly");
        expect(prompt).not.toContain("RDP = Rail Doubling Plate");
        const enumCodes=request.response_format.json_schema.schema.properties.selected_code.enum;
        expect(enumCodes.filter(Boolean).sort()).toEqual(["FLA","FLP","FLS","FLT"]);
        expect(enumCodes).not.toContain("RLA");
        expect(enumCodes).not.toContain("PAA");
        expect(enumCodes).not.toContain("RDP");
        return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          selected_code:"FLA",confidence:0.84,needs_review:true,
          reason:"The target is the forklift-pocket opening generally; the exact sub-member is not distinct.",
          candidates:[
            {code:"FLA",confidence:0.84,reason:"Pocket assembly/opening."},
            {code:"FLT",confidence:0.12,reason:"Possible transverse section."},
            {code:"FLP",confidence:0.04,reason:"Top plate not clearly isolated."}
          ]
        })}}]};
      })};

    const result=await new CedexClassificationService(
      repo,
      {get:vi.fn(async()=>imageObject())},
      ai
    ).analyseComponent("f-fork");

    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(result.selectedCode).toBe("FLA");
    expect(result.needsReview).toBe(true);
    expect(result.componentFamilyScope).toBe("GP_STRUCTURAL");
    expect(result.componentFamily).toBe("FORKLIFT_POCKET");
    expect(result.componentFamilyNarrowingUsed).toBe(true);
    expect(result.classificationAllowedComponents.map(x=>x.component_code).sort()).toEqual(["FLA","FLP","FLS","FLT"]);
    expect(saveComponentPrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        componentFamilyScope:"GP_STRUCTURAL",
        componentFamily:"FORKLIFT_POCKET",
        componentFamilyNarrowingUsed:true,
        targetEvidenceMode:"DUAL_SCALE_LOCAL",
        damageAreaUsedForComponent:false
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

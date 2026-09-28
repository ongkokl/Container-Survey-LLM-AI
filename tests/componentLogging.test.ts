import { afterEach, describe, expect, it, vi } from "vitest";
import { CedexClassificationService } from "../src/application/cedexClassificationService";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

function imageObject(){
  return {arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer};
}

afterEach(()=>vi.restoreAllMocks());

describe("component analysis structured logging",()=>{
  it("logs useful debugging metadata without logging image payloads",async()=>{
    const log=vi.spyOn(console,"log").mockImplementation(()=>{});
    const saveComponentPrediction=vi.fn(async()=>({predictionId:"pred-123"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f80",survey_id:"s1",container_face:"DOOR",final_location_code:"DB12",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      equipmentForFinding:vi.fn(async()=>"GP"),
      components:vi.fn(async()=>[
        {component_code:"LBG",component_name:"Locking Bar Guide",standard_version:"2025-06-11"},
        {component_code:"HWR",component_name:"Hardware",standard_version:"2025-06-11"}
      ]),
      findingPhoto:vi.fn(async(_findingId:string,role:string)=>{
        if(role==="DAMAGE_CLOSEUP")return {id:"close-1",r2_key:"closeup.jpg",content_type:"image/jpeg"};
        if(role==="COMPONENT_CLOSEUP")return {id:"target-1",r2_key:"target.jpg",content_type:"image/jpeg"};
        return {id:"overview-1",r2_key:"overview.jpg",content_type:"image/jpeg"};
      }),
      surveyorComponentPoint:vi.fn(async()=>({x:0.43,y:0.28})),
      surveyorLocationPoint:vi.fn(async()=>({x:0.42,y:0.71})),
      componentVisualRules:vi.fn(async()=>[
        {
          component_code:"LBG",container_face:"DOOR",overview_zone:"ANY",
          visual_definition:"Locking bar guide",positive_cues:"Guide body",
          negative_cues:"Not generic fastener",confusable_with:"HWR",
          force_review:0,source_reference:"IICL"
        },
        {
          component_code:"HWR",container_face:"DOOR",overview_zone:"ANY",
          visual_definition:"Generic hardware",positive_cues:"Fastener",
          negative_cues:"Not the guide body",confusable_with:"LBG",
          force_review:0,source_reference:"IICL"
        }
      ]),
      saveComponentPrediction
    } as unknown as CedexRepository;

    const ai={run:vi.fn(async()=>({
      choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        selected_code:"LBG",confidence:0.91,needs_review:false,
        reason:"Pinpoint lies on the shaped guide body.",
        candidates:[
          {code:"LBG",confidence:0.91,reason:"Guide body"},
          {code:"HWR",confidence:0.32,reason:"Fastener is adjacent"}
        ]
      })}}]
    }))};

    await new CedexClassificationService(
      repo,
      {get:vi.fn(async()=>imageObject())},
      ai
    ).analyseComponent("f80");

    const entries=log.mock.calls.map(call=>String(call[0]));
    const parsed=entries
      .filter(entry=>entry.startsWith("{"))
      .map(entry=>JSON.parse(entry) as Record<string,unknown>)
      .filter(entry=>entry.scope==="COMPONENT_ANALYSIS");

    expect(parsed.map(entry=>entry.event)).toEqual(expect.arrayContaining([
      "START","CONTEXT","AI_REQUEST","AI_RESPONSE","PERSIST_START","COMPLETE"
    ]));
    const context=parsed.find(entry=>entry.event==="CONTEXT");
    expect(context).toMatchObject({
      findingId:"f80",
      equipment:"GP",
      containerFace:"DOOR",
      confirmedLocationCode:"DB12",
      targetPoint:{x:0.43,y:0.28},
      targetCropAvailable:true,
      allowedCodes:["LBG","HWR"]
    });
    const response=parsed.find(entry=>entry.event==="AI_RESPONSE");
    expect(response).toMatchObject({
      selectedCode:"LBG",
      confidence:0.91,
      needsReview:false
    });
    expect(entries.join("\n")).not.toContain("data:image/");
    expect(entries.join("\n")).not.toContain("base64");
    expect(entries.join("\n")).not.toContain("closeup.jpg");
    expect(entries.join("\n")).not.toContain("overview.jpg");
    expect(entries.join("\n")).not.toContain("target.jpg");

    expect(saveComponentPrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        debugTraceId:expect.any(String)
      })
    }));
  });
});

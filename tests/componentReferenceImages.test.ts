import { describe, expect, it, vi } from "vitest";
import { CedexClassificationService } from "../src/application/cedexClassificationService";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

function bytes(value:number){
  return new Uint8Array([value,value+1,value+2]).buffer;
}

describe("component reference image guidance",()=>{
  it("attaches only verified allowed reference examples returned by the repository",async()=>{
    const saveComponentPrediction=vi.fn(async()=>({predictionId:"p1"}));
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f1",survey_id:"s1",container_face:"RIGHT",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      equipmentForFinding:vi.fn(async()=>"GP"),
      components:vi.fn(async()=>[
        {component_code:"PAA",component_name:"Panel Assembly",standard_version:"2025"},
        {component_code:"RLA",component_name:"Rail Assembly",standard_version:"2025"}
      ]),
      findingPhoto:vi.fn(async(_findingId:string,role:string)=>
        role==="DAMAGE_CLOSEUP"
          ?{id:"close1",r2_key:"target.jpg",content_type:"image/jpeg"}
          :null
      ),
      surveyorDamageBox:vi.fn(async()=>({x:0.2,y:0.2,width:0.3,height:0.3})),
      surveyorLocationPoint:vi.fn(async()=>null),
      componentVisualRules:vi.fn(async()=>[]),
      componentReferenceImages:vi.fn(async()=>[
        {
          id:"ref-paa",component_code:"PAA",container_face:"RIGHT",overview_zone:"ANY",
          r2_key:"refs/paa.jpg",content_type:"image/jpeg",caption:"Verified corrugated panel",
          visual_descriptor:null,source_reference:"IICL",priority:200
        },
        {
          id:"ref-not-allowed",component_code:"CFG",container_face:"RIGHT",overview_zone:"ANY",
          r2_key:"refs/cfg.jpg",content_type:"image/jpeg",caption:"Corner fitting",
          visual_descriptor:null,source_reference:"IICL",priority:190
        }
      ]),
      saveComponentPrediction
    } as unknown as CedexRepository;

    const bucket={
      get:vi.fn(async(key:string)=>{
        if(key==="target.jpg")return {arrayBuffer:async()=>bytes(1)};
        if(key==="refs/paa.jpg")return {arrayBuffer:async()=>bytes(5)};
        if(key==="refs/cfg.jpg")return {arrayBuffer:async()=>bytes(9)};
        return null;
      })
    };

    const aiRun=vi.fn(async(_model:string,input:unknown)=>{
      const request=input as {messages:Array<{content:Array<Record<string,unknown>>}>};
      const content=request.messages[0].content;
      const labels=content
        .filter(item=>item.type==="text")
        .map(item=>String(item.text??""));
      expect(labels.some(label=>label.includes("VERIFIED REFERENCE EXAMPLE — PAA"))).toBe(true);
      expect(labels.some(label=>label.includes("VERIFIED REFERENCE EXAMPLE — CFG"))).toBe(false);
      expect(content.filter(item=>item.type==="image_url")).toHaveLength(2);
      return {
        choices:[{
          finish_reason:"stop",
          message:{
            content:JSON.stringify({
              selected_code:"PAA",
              confidence:0.92,
              needs_review:false,
              reason:"Target is on the corrugated panel field.",
              candidates:[{code:"PAA",confidence:0.92,reason:"Corrugated panel."}]
            })
          }
        }]
      };
    });

    const service=new CedexClassificationService(repo,bucket, {run:aiRun});
    const result=await service.analyseComponent("f1");

    expect(result).toMatchObject({
      selectedCode:"PAA",
      referenceImagesUsed:1,
      referenceImageCodes:["PAA"]
    });
    expect(bucket.get).not.toHaveBeenCalledWith("refs/cfg.jpg");
    expect(saveComponentPrediction).toHaveBeenCalledWith(expect.objectContaining({
      requestContext:expect.objectContaining({
        referenceImagesUsed:1,
        referenceImageIds:["ref-paa"],
        referenceImageCodes:["PAA"]
      })
    }));
  });

  it("keeps classification working when no reference image exists",async()=>{
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f1",survey_id:"s1",container_face:"RIGHT",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      equipmentForFinding:vi.fn(async()=>"GP"),
      components:vi.fn(async()=>[
        {component_code:"PAA",component_name:"Panel Assembly",standard_version:"2025"}
      ]),
      findingPhoto:vi.fn(async(_findingId:string,role:string)=>
        role==="DAMAGE_CLOSEUP"
          ?{id:"close1",r2_key:"target.jpg",content_type:"image/jpeg"}
          :null
      ),
      surveyorDamageBox:vi.fn(async()=>null),
      surveyorLocationPoint:vi.fn(async()=>null),
      componentVisualRules:vi.fn(async()=>[]),
      componentReferenceImages:vi.fn(async()=>[]),
      saveComponentPrediction:vi.fn(async()=>({predictionId:"p1"}))
    } as unknown as CedexRepository;
    const bucket={get:vi.fn(async()=>({arrayBuffer:async()=>bytes(1)}))};
    const ai={run:vi.fn(async()=>({
      choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        selected_code:null,confidence:null,needs_review:true,
        reason:"Ambiguous.",candidates:[]
      })}}]
    }))};

    const result=await new CedexClassificationService(repo,bucket,ai).analyseComponent("f1");
    expect(result.referenceImagesUsed).toBe(0);
    expect(result.analysisStatus).toBe("ABSTAINED");
  });
});

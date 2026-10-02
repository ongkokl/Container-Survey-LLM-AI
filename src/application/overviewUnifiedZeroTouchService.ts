import { fixedCameraProfile } from "../domain/container/fixedCameraProfile";
import { CedexRepository, ComponentVisualRule, DamageVisualRule } from "../infrastructure/d1/cedexRepository";
import { MoondreamDamageMarker } from "../infrastructure/ai/moondreamDamageMarker";
import { FixedCameraCalibrationService } from "./fixedCameraCalibrationService";

const MODEL="@cf/qwen/qwen3.8-27b";
const MAX_COMPLETION_TOKENS=1200;
const SPEED_PROFILE="ZERO_TOUCH_FULL_FALLBACK_1536_1200";
const COMPONENT_REVIEW_THRESHOLD=0.8;
const DAMAGE_REVIEW_THRESHOLD=0.8;
const TARGET_REVIEW_THRESHOLD=0.45;
const CONSERVATIVE_PHOTO_DAMAGE_CODES=new Set(["BN","CK","CO","CU","DT","DY","GD","ML","PF"]);
const COMPONENT_ZONES=["TOP_EDGE","BOTTOM_EDGE","LEFT_EDGE","RIGHT_EDGE","CENTRAL_FIELD"] as const;

type AiRunner={run(model:string,input:unknown):Promise<unknown>};
type DamageBox={x:number;y:number;width:number;height:number};
type Point={x:number;y:number};
type Candidate={code:string;confidence:number|null;reason:string};
type PriorityClass="STRUCTURAL_DEFORMATION"|"MATERIAL_BREAK"|"PREVIOUS_REPAIR"|"SURFACE_DAMAGE"|"NO_RELIABLE_DAMAGE";
type AnalysisStatus="SUGGESTED"|"ABSTAINED"|"INCOMPLETE"|"INVALID_RESPONSE";

function record(value:unknown):Record<string,unknown>|null{
  return value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
}

function dataUri(bytes:ArrayBuffer,type:string){
  let binary="";const data=new Uint8Array(bytes);
  for(let i=0;i<data.length;i+=0x8000)binary+=String.fromCharCode(...data.subarray(i,i+0x8000));
  return `data:${type||"image/jpeg"};base64,${btoa(binary)}`;
}

function parseJson(raw:unknown):Record<string,unknown>|null{
  const envelope=record(raw);
  const first=Array.isArray(envelope?.choices)?record(envelope.choices[0]):null;
  const message=record(first?.message);
  const values=first?[message?.content]:[raw,envelope?.response,envelope?.result,envelope?.output_text];
  for(const value of values){
    const object=record(value);
    if(object&&Object.hasOwn(object,"target_decision"))return object;
    if(typeof value!=="string")continue;
    const text=value.trim().replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"");
    try{
      const parsed=record(JSON.parse(text));
      if(parsed)return parsed;
    }catch{}
  }
  return null;
}

function validConfidence(value:unknown):value is number|null{
  return value===null||(typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=1);
}

function normalizedBox(value:unknown):DamageBox|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  const box={x:Number(v.x),y:Number(v.y),width:Number(v.width),height:Number(v.height)};
  if(![box.x,box.y,box.width,box.height].every(Number.isFinite))return null;
  if(box.x<0||box.y<0||box.width<=0||box.height<=0||box.x+box.width>1.000001||box.y+box.height>1.000001)return null;
  return box;
}

function normalizedPoint(x:unknown,y:unknown):Point|null{
  const point={x:Number(x),y:Number(y)};
  if(![point.x,point.y].every(Number.isFinite)||point.x<0||point.x>1||point.y<0||point.y>1)return null;
  return point;
}

function contextBoxAroundPoint(point:Point,size=0.18):DamageBox{
  const width=Math.min(0.32,Math.max(0.08,size));
  const height=width;
  return {
    x:Math.min(1-width,Math.max(0,point.x-width/2)),
    y:Math.min(1-height,Math.max(0,point.y-height/2)),
    width,
    height
  };
}

function centreOfBox(box:DamageBox):Point{
  return {x:box.x+box.width/2,y:box.y+box.height/2};
}

function captureInfo(value:unknown){
  const meta=record(value);
  return {
    fixedCameraMode:meta?.fixedCameraMode===true,
    fixedCameraId:typeof meta?.fixedCameraId==="string"?meta.fixedCameraId.trim().toUpperCase():null,
    fixedAlignmentReferenceBox:normalizedBox(meta?.fixedAlignmentReferenceBox),
    fixedAlignmentSource:typeof meta?.fixedAlignmentSource==="string"?meta.fixedAlignmentSource:null,
    source:typeof meta?.source==="string"?meta.source:"unknown",
    measurementQuality:typeof meta?.measurementQuality==="string"?meta.measurementQuality:"UNKNOWN"
  };
}

function componentGuidance(rules:ComponentVisualRule[]){
  if(!rules.length)return "Use the visible physical structure and abstain when the component cannot be supported.";
  return rules.slice(0,40).map(rule=>{
    const parts=[`${rule.component_code}: ${rule.visual_definition}`];
    if(rule.positive_cues)parts.push(`Cues=${rule.positive_cues}`);
    if(rule.negative_cues)parts.push(`Avoid=${rule.negative_cues}`);
    return parts.join(" | ");
  }).join("\n");
}

function damageGuidance(rules:DamageVisualRule[]){
  return rules.slice(0,70).map(rule=>{
    const parts=[`${rule.damage_code}: ${rule.visual_definition}`];
    if(rule.positive_cues)parts.push(`Cues=${rule.positive_cues}`);
    if(rule.negative_cues)parts.push(`Avoid=${rule.negative_cues}`);
    if(rule.force_review===1)parts.push("Review=required");
    return parts.join(" | ");
  }).join("\n");
}

function resultCandidates(value:unknown,allowed:Set<string>):Candidate[]{
  if(!Array.isArray(value))return [];
  const out:Candidate[]=[];
  for(const item of value){
    const c=record(item);
    if(!c||typeof c.code!=="string"||!validConfidence(c.confidence)||typeof c.reason!=="string")continue;
    const code=c.code.trim().toUpperCase();
    if(allowed.has(code)&&!out.some(x=>x.code===code)){
      out.push({code,confidence:c.confidence as number|null,reason:c.reason.trim()});
    }
  }
  return out.slice(0,3);
}

function dedupeComponentRules(rules:ComponentVisualRule[]){
  const seen=new Set<string>();
  return rules.filter(rule=>{
    const key=[rule.component_code,rule.visual_definition,rule.positive_cues??"",rule.negative_cues??""].join("|");
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}

function normalizePriorityClass(value:unknown,damageCode:string|null):PriorityClass{
  if(damageCode==="DT")return "STRUCTURAL_DEFORMATION";
  if(damageCode==="IR")return "PREVIOUS_REPAIR";
  if(["CK","CU","PF"].includes(damageCode??""))return "MATERIAL_BREAK";
  const allowed=new Set<PriorityClass>([
    "STRUCTURAL_DEFORMATION","MATERIAL_BREAK","PREVIOUS_REPAIR","SURFACE_DAMAGE","NO_RELIABLE_DAMAGE"
  ]);
  const raw=typeof value==="string"?value as PriorityClass:"NO_RELIABLE_DAMAGE";
  return allowed.has(raw)?raw:"NO_RELIABLE_DAMAGE";
}

export class OverviewUnifiedZeroTouchService{
  constructor(
    private readonly repo:CedexRepository,
    private readonly ai:AiRunner,
    private readonly marker=new MoondreamDamageMarker(ai)
  ){}

  async analyse(input:{
    findingId:string;
    file:File;
    imageWidth:number;
    imageHeight:number;
    captureMetadata?:unknown;
  }){
    const startedAt=Date.now();
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");
    if(context.equipment_type!=="GP")throw new Error("Unified zero-touch POC currently supports GP containers.");
    if(!["LEFT","RIGHT","FRONT"].includes(context.container_face)){
      throw new Error("Unified zero-touch POC currently supports GP side/front views.");
    }

    const capture=captureInfo(input.captureMetadata);
    const camera=capture.fixedCameraMode?fixedCameraProfile(capture.fixedCameraId):null;
    if(!camera||camera.face!==context.container_face){
      throw new Error("Unified zero-touch analysis requires the fixed camera profile that matches this finding face.");
    }

    const calibrationService=new FixedCameraCalibrationService(this.repo);
    const calibration=await calibrationService.get(input.findingId,camera.id);

    const moondreamStartedAt=Date.now();
    const located=await this.marker.locateOverview(
      input.file,
      context.container_face,
      null,
      {skipDoorDetection:true,skipReferenceDetection:!calibration.available}
    );
    const moondreamCandidateMs=Date.now()-moondreamStartedAt;
    const damageCandidates=(Array.isArray(located.damageCandidates)?located.damageCandidates:located.damageBox?[located.damageBox]:[])
      .map(normalizedBox)
      .filter((box):box is DamageBox=>Boolean(box))
      .slice(0,3);

    const aiReferenceBox=normalizedBox(located.referenceBox);
    const edgeReferenceBox=capture.fixedAlignmentReferenceBox;
    const rank=(status:string)=>status==="GREEN"?4:status==="AMBER"?3:status==="RED"?1:status==="UNVERIFIED"?0:-1;
    const aiAlignment=aiReferenceBox
      ?await calibrationService.alignment(input.findingId,camera.id,aiReferenceBox)
      :null;
    const edgeAlignment=edgeReferenceBox
      ?await calibrationService.alignment(input.findingId,camera.id,edgeReferenceBox)
      :null;
    let alignmentReferenceBox=aiReferenceBox??edgeReferenceBox??null;
    let alignment=aiAlignment??edgeAlignment??await calibrationService.alignment(input.findingId,camera.id,null);
    let alignmentSource=aiAlignment?"AI_FACE":edgeAlignment?(capture.fixedAlignmentSource??"FIXED_GEOMETRY_EDGE"):"NONE";
    if(edgeAlignment&&rank(edgeAlignment.status)>rank(alignment.status)){
      alignment=edgeAlignment;
      alignmentReferenceBox=edgeReferenceBox;
      alignmentSource=capture.fixedAlignmentSource??"FIXED_GEOMETRY_EDGE";
    }

    const allowedComponents=await this.repo.components("GP",context.container_face);
    const componentCodes=[...new Set(allowedComponents.map(x=>x.component_code))];
    if(!componentCodes.length)throw new Error("No verified CEDEX components are loaded for this face.");
    const componentSet=new Set(componentCodes);
    const componentRules=dedupeComponentRules((await Promise.all(
      COMPONENT_ZONES.map(zone=>this.repo.componentVisualRules("GP",context.container_face,zone))
    )).flat()).filter(rule=>componentSet.has(rule.component_code));

    const damageEntries=await Promise.all(componentCodes.map(async componentCode=>{
      const allowed=await this.repo.damageCodesForComponent(input.findingId,componentCode);
      const allCodes=[...new Set(allowed.damages.map(x=>x.damage_code))];
      const allSet=new Set(allCodes);
      const rules=(await this.repo.damageVisualRules("GP",componentCode)).filter(x=>allSet.has(x.damage_code));
      const eligibleRules=rules.filter(rule=>
        rule.evidence_requirement==="VISUAL"||
        (rule.damage_code==="IR"&&rule.evidence_requirement==="HISTORY_CONTEXT")
      );
      const eligibleSet=new Set(eligibleRules.map(x=>x.damage_code));
      const eligible=eligibleRules.length
        ?allowed.damages.filter(x=>eligibleSet.has(x.damage_code))
        :allowed.damages.filter(x=>CONSERVATIVE_PHOTO_DAMAGE_CODES.has(x.damage_code));
      return {componentCode,allowed:allowed.damages,rules,eligible,eligibleRules};
    }));
    const byComponent=new Map(damageEntries.map(x=>[x.componentCode,x]));
    const unionDamageCodes=[...new Set(damageEntries.flatMap(x=>x.eligible.map(d=>d.damage_code)))];
    const damageUnionSet=new Set(unionDamageCodes);

    const candidateText=damageCandidates.length
      ?damageCandidates.map((box,index)=>
        `${index}: x=${box.x.toFixed(4)}, y=${box.y.toFixed(4)}, width=${box.width.toFixed(4)}, height=${box.height.toFixed(4)}`
      ).join("\n")
      :"NONE — Moondream returned no candidate boxes. Inspect the full overview directly.";

    const componentText=allowedComponents.map(x=>`${x.component_code}=${x.component_name}`).join(", ");
    const damageMap=damageEntries.filter(x=>x.eligible.length).map(x=>
      `${x.componentCode}: ${x.eligible.map(d=>`${d.damage_code}=${d.damage_name}`).join(", ")}`
    ).join("\n");
    const damageRules=damageEntries.flatMap(x=>x.eligibleRules);

    const prompt=`ZERO-TOUCH UNIFIED OVERVIEW ANALYSIS.
This is a fixed-camera overview of a GP shipping-container ${context.container_face.toLowerCase()} face.
Perform THREE tasks in this ONE response:
1. select/localize the single primary physical damage;
2. identify the CEDEX component at that exact target;
3. classify the visible CEDEX damage for that component.

Moondream candidate boxes (normalized image coordinates):
${candidateText}

PRIMARY DAMAGE PRIORITY:
1 structural deformation: dent, buckle, crease, bent/distorted panel or rail;
2 material break: crack, cut, puncture or tear;
3 visible previous repair / repair patch;
4 gouge, scrape, scratch or paint failure;
5 dirt, staining or discoloration.
A higher-priority physical defect must beat a darker lower-priority surface mark. A row of repeated dents across corrugations is one structural region.
If a Moondream candidate is correct, return target_decision=CANDIDATE and its index.
If the strongest physical damage is elsewhere, or no candidate boxes exist, return target_decision=OVERRIDE_POINT and the centre x/y.
Use target_decision=NONE only if no physical damage is visually supportable.

After selecting the target, classify ONLY that same target.
Component must describe the underlying physical structure, not rust, paint, shadow, patch or damage shape.
Face-valid components: ${componentText}

Component visual guidance:
${componentGuidance(componentRules)}

Component -> photo-eligible damage codes:
${damageMap}

Damage visual guidance:
${damageGuidance(damageRules)}

For panel damage, true crack/cut outranks dent; otherwise permanent displacement/buckle/bend/crease is DT. Surface damage must not outrank clear structural deformation.
The returned damage_code MUST be valid for the returned component_code.
If component or damage is uncertain, return null for that field and set its needs_review=true rather than guessing.
Keep reasons concise (max 15 words each). Return only JSON.`;

    const qwenStartedAt=Date.now();
    const raw=await this.ai.run(MODEL,{
      messages:[{role:"user",content:[
        {type:"text",text:prompt},
        {type:"image_url",image_url:{url:dataUri(await input.file.arrayBuffer(),input.file.type||"image/jpeg")}}
      ]}],
      max_completion_tokens:MAX_COMPLETION_TOKENS,
      reasoning_effort:"low",
      temperature:0,
      response_format:{type:"json_schema",json_schema:{
        name:"overview_unified_zero_touch",
        strict:true,
        schema:{
          type:"object",
          properties:{
            target_decision:{type:"string",enum:["CANDIDATE","OVERRIDE_POINT","NONE"]},
            candidate_index:{type:["integer","null"],minimum:0,maximum:2},
            target_x:{type:["number","null"],minimum:0,maximum:1},
            target_y:{type:["number","null"],minimum:0,maximum:1},
            target_confidence:{type:["number","null"],minimum:0,maximum:1},
            priority_class:{type:"string",enum:["STRUCTURAL_DEFORMATION","MATERIAL_BREAK","PREVIOUS_REPAIR","SURFACE_DAMAGE","NO_RELIABLE_DAMAGE"]},
            target_reason:{type:"string"},
            component_code:{type:["string","null"],enum:[...componentCodes,null]},
            component_confidence:{type:["number","null"],minimum:0,maximum:1},
            component_needs_review:{type:"boolean"},
            component_reason:{type:"string"},
            component_candidates:{type:"array",maxItems:3,items:{type:"object",properties:{
              code:{type:"string",enum:componentCodes},
              confidence:{type:["number","null"],minimum:0,maximum:1},
              reason:{type:"string"}
            },required:["code","confidence","reason"],additionalProperties:false}},
            damage_code:{type:["string","null"],enum:[...unionDamageCodes,null]},
            damage_confidence:{type:["number","null"],minimum:0,maximum:1},
            damage_needs_review:{type:"boolean"},
            damage_reason:{type:"string"},
            damage_candidates:{type:"array",maxItems:3,items:{type:"object",properties:{
              code:{type:"string",enum:unionDamageCodes},
              confidence:{type:["number","null"],minimum:0,maximum:1},
              reason:{type:"string"}
            },required:["code","confidence","reason"],additionalProperties:false}}
          },
          required:[
            "target_decision","candidate_index","target_x","target_y","target_confidence","priority_class","target_reason",
            "component_code","component_confidence","component_needs_review","component_reason","component_candidates",
            "damage_code","damage_confidence","damage_needs_review","damage_reason","damage_candidates"
          ],
          additionalProperties:false
        }
      }}
    });
    const unifiedQwenMs=Date.now()-qwenStartedAt;

    const envelope=record(raw);
    const choice=Array.isArray(envelope?.choices)?record(envelope.choices[0]):null;
    const finishReason=typeof choice?.finish_reason==="string"?choice.finish_reason:null;
    const parsed=parseJson(raw);

    let analysisStatus:AnalysisStatus="INVALID_RESPONSE";
    let targetDecision:"CANDIDATE"|"OVERRIDE_POINT"|"NONE"="NONE";
    let selectedCandidateIndex:number|null=null;
    let point:Point|null=null;
    let damageBox:DamageBox|null=null;
    let targetConfidence:number|null=null;
    let targetReason="AI returned an unreadable unified answer.";
    let componentCode:string|null=null,damageCode:string|null=null;
    let componentConfidence:number|null=null,damageConfidence:number|null=null;
    let componentNeedsReview=true,damageNeedsReview=true;
    let componentReason="Component could not be classified.",damageReason="Damage could not be classified.";
    let componentCandidates:Candidate[]=[],damageCodeCandidates:Candidate[]=[];

    if(finishReason==="length"){
      analysisStatus="INCOMPLETE";
      targetReason="Unified AI response incomplete. Retry the zero-touch analysis.";
    }else if((!finishReason||finishReason==="stop")&&parsed){
      const decision=typeof parsed.target_decision==="string"?parsed.target_decision:"NONE";
      const confidence=validConfidence(parsed.target_confidence)?parsed.target_confidence as number|null:null;
      const index=Number.isInteger(parsed.candidate_index)?Number(parsed.candidate_index):null;
      const overridePoint=normalizedPoint(parsed.target_x,parsed.target_y);
      targetConfidence=confidence;
      targetReason=typeof parsed.target_reason==="string"?parsed.target_reason.trim():"";
      if(decision==="CANDIDATE"&&confidence!==null&&confidence>=TARGET_REVIEW_THRESHOLD&&index!==null&&damageCandidates[index]){
        targetDecision="CANDIDATE";
        selectedCandidateIndex=index;
        damageBox={...damageCandidates[index]};
        point=centreOfBox(damageBox);
      }else if(decision==="OVERRIDE_POINT"&&confidence!==null&&confidence>=TARGET_REVIEW_THRESHOLD&&overridePoint){
        targetDecision="OVERRIDE_POINT";
        point=overridePoint;
        damageBox=contextBoxAroundPoint(point);
      }

      const cc=typeof parsed.component_code==="string"?parsed.component_code.trim().toUpperCase():null;
      const dc=typeof parsed.damage_code==="string"?parsed.damage_code.trim().toUpperCase():null;
      if(damageBox&&(cc===null||componentSet.has(cc))&&
        validConfidence(parsed.component_confidence)&&validConfidence(parsed.damage_confidence)&&
        typeof parsed.component_needs_review==="boolean"&&typeof parsed.damage_needs_review==="boolean"&&
        typeof parsed.component_reason==="string"&&typeof parsed.damage_reason==="string"){
        componentCode=cc;
        componentConfidence=parsed.component_confidence as number|null;
        componentReason=parsed.component_reason.trim()||"Surveyor review required.";
        componentCandidates=resultCandidates(parsed.component_candidates,componentSet);
        const componentForceReview=Boolean(componentCode&&componentRules.some(x=>x.component_code===componentCode&&x.force_review===1));
        componentNeedsReview=Boolean(
          parsed.component_needs_review||
          !componentCode||
          componentConfidence===null||
          componentConfidence<COMPONENT_REVIEW_THRESHOLD||
          componentForceReview
        );

        const entry=componentCode?byComponent.get(componentCode):null;
        const validDamageSet=new Set(entry?.eligible.map(x=>x.damage_code)??[]);
        if(dc&&damageUnionSet.has(dc)&&validDamageSet.has(dc)){
          damageCode=dc;
          damageConfidence=parsed.damage_confidence as number|null;
          damageReason=parsed.damage_reason.trim()||"Surveyor review required.";
          damageCodeCandidates=resultCandidates(parsed.damage_candidates,validDamageSet);
          const damageRule=entry?.rules.find(x=>x.damage_code===damageCode);
          damageNeedsReview=Boolean(
            parsed.damage_needs_review||
            damageConfidence===null||
            damageConfidence<DAMAGE_REVIEW_THRESHOLD||
            damageRule?.force_review===1
          );
          analysisStatus="SUGGESTED";
        }else{
          damageCode=null;
          damageConfidence=null;
          damageNeedsReview=true;
          damageReason=componentCode
            ?"AI damage answer was not valid for the selected component."
            :"Damage classification requires a reliable component.";
          analysisStatus="ABSTAINED";
        }
      }else if(!damageBox){
        analysisStatus="ABSTAINED";
        componentReason="Component classification skipped because no reliable primary damage target was localized.";
        damageReason="Damage classification skipped because no reliable primary damage target was localized.";
      }
    }

    const normalizedPriority=normalizePriorityClass(parsed?.priority_class,damageCode);
    const localizationSource=targetDecision==="CANDIDATE"
      ?"QWEN_PRIMARY_BOX"
      :targetDecision==="OVERRIDE_POINT"
        ?"QWEN_PRIMARY_OVERRIDE_POINT"
        :"NONE";

    const locationGeometryStartedAt=Date.now();
    let calculated:Awaited<ReturnType<FixedCameraCalibrationService["calculate"]>>|null=null;
    if(damageBox&&calibration.available){
      calculated=await calibrationService.calculate({
        findingId:input.findingId,
        cameraId:camera.id,
        damageBox:targetDecision==="CANDIDATE"?damageBox:undefined,
        damagePoint:targetDecision==="OVERRIDE_POINT"?point:undefined,
        alignmentReferenceBox,
        requireAlignment:true
      });
    }
    const locationGeometryMs=Date.now()-locationGeometryStartedAt;
    const locationCode=calculated?.code??null;
    const locationReviewRequired=Boolean(calculated?.reviewRequired||!locationCode);

    const sideFace=context.container_face==="LEFT"||context.container_face==="RIGHT";
    const faceVerification=sideFace?{
      selectedFace:context.container_face,
      detectedFace:context.container_face as "LEFT"|"RIGHT",
      confidence:1,
      status:"MATCH" as const,
      evidence:"FIXED_CAMERA_PROFILE" as const,
      reason:"Container face and orientation come from the fixed POC camera profile."
    }:{
      selectedFace:context.container_face,
      detectedFace:null,
      confidence:1,
      status:"UNVERIFIED" as const,
      evidence:null,
      reason:"Container face and orientation come from the fixed POC camera profile."
    };
    const doorEndDetection={
      visible:false,
      side:camera.doorEndInImage,
      confidence:1,
      expectedSide:camera.doorEndInImage,
      matchesSelectedFace:true,
      suggestedFace:sideFace?context.container_face as "LEFT"|"RIGHT":null,
      doorDominant:false,
      reason:camera.doorEndInImage
        ?"Longitudinal orientation comes from fixed Camera "+camera.id+"."
        :"Face orientation comes from fixed Camera "+camera.id+"."
    };

    const locationReason=calculated?.reason??(
      !damageBox
        ?"Unified Qwen analysis could not support a reliable primary damage target; manual marking is required."
        :!calibration.available
          ?"Fixed Camera "+camera.id+" calibration is not configured for this container geometry."
          :"Automatic CEDEX location is unavailable."
    );
    const locationResponse={
      found:Boolean(damageBox),
      damageBox,
      point,
      localizationSource,
      damageCandidates,
      primaryDamageSelection:{
        attempted:true,
        model:MODEL,
        decision:targetDecision,
        confidence:targetConfidence,
        priorityClass:normalizedPriority,
        reason:targetReason,
        selectedCandidateIndex
      },
      referenceBox:alignmentReferenceBox,
      referenceSource:calibration.available?"FIXED_CAMERA_CALIBRATION":"FIXED_CAMERA_PROFILE",
      geometryScore:null,
      doorEndDetection,
      doorBox:null,
      faceVerification,
      fixedCameraId:camera.id,
      fixedCameraFace:camera.face,
      calibration,
      alignment,
      alignmentSource,
      orientationConflict:false,
      autoUsable:Boolean(locationCode),
      location:calculated?{
        ...calculated,
        code:locationCode,
        reviewRequired:locationReviewRequired,
        reason:locationReason
      }:{
        code:null,
        reviewRequired:true,
        reason:locationReason,
        physicalMeasurement:null
      }
    };

    const locationPrediction=await this.repo.saveLocationPrediction({
      findingId:input.findingId,
      surveyId:context.survey_id,
      modelName:MODEL,
      selectedCode:locationCode,
      status:locationCode?(locationReviewRequired?"REVIEW_REQUIRED":"SUGGESTED"):"FAILED",
      response:locationResponse,
      requestContext:{
        source:"ZERO_TOUCH_UNIFIED_QWEN",
        face:context.container_face,
        lengthFt:context.length_ft,
        isoCode:context.observed_iso_code,
        fixedCameraId:camera.id,
        fixedCameraFace:camera.face,
        calibrationAvailable:Boolean(calibration.available),
        calibrationVersion:calibration.calibrationVersion,
        alignmentStatus:alignment.status,
        alignmentSource,
        localizationSource,
        moondreamCandidateCount:damageCandidates.length,
        selectedCandidateIndex,
        unifiedQwen:true,
        targetConfidence,
        priorityClass:normalizedPriority,
        speedProfile:SPEED_PROFILE,
        aiInputWidth:input.imageWidth,
        aiInputHeight:input.imageHeight,
        aiInputBytes:input.file.size
      }
    });
    const localization={...locationResponse,predictionId:locationPrediction.predictionId,model:MODEL};

    const componentName=componentCode
      ?allowedComponents.find(x=>x.component_code===componentCode)?.component_name??null
      :null;
    const selectedEntry=componentCode?byComponent.get(componentCode):null;
    const damageName=damageCode
      ?selectedEntry?.allowed.find(x=>x.damage_code===damageCode)?.damage_name??null
      :null;
    const needsReview=Boolean(
      componentNeedsReview||
      damageNeedsReview||
      locationReviewRequired||
      !locationCode
    );
    const totalAutoAnalysisMs=Date.now()-startedAt;

    return {
      pocMode:"ZERO_TOUCH_OVERVIEW",
      source:"FULL_OVERVIEW_ORCHESTRATOR",
      classificationMode:"SINGLE_QWEN_LOCALIZATION_COMPONENT_DAMAGE",
      imageScope:"FULL_OVERVIEW",
      speedProfile:SPEED_PROFILE,
      aiInput:{
        width:input.imageWidth,
        height:input.imageHeight,
        bytes:input.file.size,
        longSide:Math.max(input.imageWidth,input.imageHeight)
      },
      damageBox,
      locationCode,
      componentCode,
      componentName,
      componentConfidence,
      componentNeedsReview,
      componentReason,
      componentCandidates,
      selectedCode:damageCode,
      selectedName:damageName,
      confidence:damageConfidence,
      damageNeedsReview,
      damageReason,
      candidates:damageCodeCandidates,
      needsReview,
      analysisStatus,
      model:MODEL,
      finishReason,
      completionTokenLimit:MAX_COMPLETION_TOKENS,
      localization,
      timings:{
        moondreamCandidateMs,
        localizationMs:moondreamCandidateMs,
        classificationAiMs:unifiedQwenMs,
        unifiedQwenMs,
        locationGeometryMs,
        totalClassificationMs:unifiedQwenMs+locationGeometryMs,
        totalAutoAnalysisMs,
        aiInputWidth:input.imageWidth,
        aiInputHeight:input.imageHeight,
        aiInputBytes:input.file.size,
        aiInputLongSide:Math.max(input.imageWidth,input.imageHeight),
        qwenCalls:1,
        sharedQwenLocalizationClassification:true
      }
    };
  }
}

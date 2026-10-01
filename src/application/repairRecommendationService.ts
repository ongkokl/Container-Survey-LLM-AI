import {
  CedexRepository,
  type HistoricalRepairCase,
  type RepairMeasurementInput,
  type RepairMeasurementRecord
} from "../infrastructure/d1/cedexRepository";

const MODEL="@cf/qwen/qwen3.8-27b";
const INITIAL_COMPLETION_TOKENS=1600;
const RETRY_COMPLETION_TOKENS=2200;
const MAX_HISTORY_EXAMPLES=6;

type AiRunner={run(model:string,input:unknown):Promise<unknown>};
type AnalysisStatus="SUGGESTED"|"ABSTAINED"|"INCOMPLETE"|"INVALID_RESPONSE";
type EvidenceSource="MEASUREMENTS"|"IICL_CRITERION"|"GP_XLSX_DESCRIPTION"|"HISTORICAL_CASE";
type Candidate={code:string;confidence:number|null;reason:string;evidenceSources:EvidenceSource[]};

const EVIDENCE_SOURCES=new Set<EvidenceSource>([
  "MEASUREMENTS","IICL_CRITERION","GP_XLSX_DESCRIPTION","HISTORICAL_CASE"
]);

function record(value:unknown):Record<string,unknown>|null{
  return value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
}

function parseJson(raw:unknown):Record<string,unknown>|null{
  const envelope=record(raw);
  const first=Array.isArray(envelope?.choices)?record(envelope.choices[0]):null;
  const message=record(first?.message);
  const values=first?[message?.content]:[raw,envelope?.response,envelope?.result,envelope?.output_text];
  for(const value of values){
    const object=record(value);
    if(object&&Object.hasOwn(object,"selected_code"))return object;
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

function evidenceSources(value:unknown):EvidenceSource[]|null{
  if(!Array.isArray(value))return null;
  const sources=value.filter((item):item is EvidenceSource=>
    typeof item==="string"&&EVIDENCE_SOURCES.has(item as EvidenceSource)
  );
  if(sources.length!==value.length)return null;
  return [...new Set(sources)];
}

function numericDistance(current:number|null,historical:number|null,scale:number){
  if(current===null)return 0;
  if(historical===null)return 0.45;
  return Math.abs(current-historical)/Math.max(scale,Math.abs(current),1);
}

function rankHistoricalCases(
  current:RepairMeasurementRecord,
  cases:HistoricalRepairCase[],
  currentFace:string|null,
  currentLocation:string|null
){
  return cases.map(item=>{
    let distance=0;
    distance+=numericDistance(current.damageLengthCm,item.damageLengthCm,20);
    distance+=numericDistance(current.damageWidthCm,item.damageWidthCm,15);
    distance+=numericDistance(current.damageDepthCm,item.damageDepthCm,2);
    distance+=numericDistance(current.corrugationsAffected,item.corrugationsAffected,2);
    if(current.deformationDirection!=="UNKNOWN"&&item.deformationDirection!==current.deformationDirection)distance+=0.35;
    if(currentFace&&item.containerFace!==currentFace)distance+=0.3;
    if(currentLocation&&item.locationCode){
      if(item.locationCode===currentLocation)distance-=0.15;
      else if(item.locationCode[0]!==currentLocation[0])distance+=0.2;
    }
    const similarityScore=Number((1/(1+Math.max(0,distance))).toFixed(4));
    return {...item,similarityScore};
  }).sort((a,b)=>b.similarityScore-a.similarityScore||b.decisionDate.localeCompare(a.decisionDate))
    .slice(0,MAX_HISTORY_EXAMPLES);
}

function measurementText(m:RepairMeasurementRecord){
  return [
    `length=${m.damageLengthCm??"not measured"} cm`,
    `width=${m.damageWidthCm??"not measured"} cm`,
    `depth=${m.damageDepthCm??"not measured"} cm`,
    `corrugations=${m.corrugationsAffected??"not recorded"}`,
    `direction=${m.deformationDirection}`,
    `IICL depth status=${m.iiclDepthStatus??"not assessed"}`,
    `mapped depth limit=${m.applicableIiclLimitMm??"none"} mm`
  ].join(", ");
}

function historyText(cases:ReturnType<typeof rankHistoricalCases>){
  if(!cases.length)return "No comparable surveyor-confirmed repair cases are available yet.";
  return cases.map((item,index)=>
    `${index+1}. repair=${item.repairCode}; similarity=${item.similarityScore}; face=${item.containerFace??"unknown"}; location=${item.locationCode??"unknown"}; ${measurementText(item)}`
  ).join("\n");
}

export class RepairRecommendationService{
  constructor(private readonly repo:CedexRepository,private readonly ai?:AiRunner){}

  async analyse(findingId:string,measurements?:RepairMeasurementInput){
    const context=await this.repo.findingContext(findingId);
    if(!context)throw new Error("Finding not found.");

    const allowed=await this.repo.repairCodesForFinding(findingId);
    if(!allowed.repairs.length){
      throw new Error(`No verified GP.xlsx repair methods are loaded for ${allowed.equipment} ${allowed.componentCode} + ${allowed.damageCode}.`);
    }

    const allowedCodes=[...new Set(allowed.repairs.map(x=>x.repair_code))];
    const measurement=measurements
      ? await this.repo.saveRepairMeasurements({findingId,measurements})
      : await this.repo.repairMeasurementsForFinding(findingId);

    const stage5Eligible=
      allowed.equipment==="GP"&&
      allowed.componentCode==="PAA"&&
      allowed.damageCode==="DT";

    if(!stage5Eligible){
      const reason="Measurement-aware Qwen repair reasoning is currently validated only for GP/PAA + DT. Select a GP.xlsx-verified repair method manually.";
      await this.repo.saveRepairPrediction({
        findingId,surveyId:context.survey_id,modelName:"RULE_ENGINE_GP_XLSX",
        selectedCode:null,confidence:null,candidates:[],response:{skippedModel:true,reason,allowedRepairCodes:allowedCodes},
        status:"REVIEW_REQUIRED",
        requestContext:{
          equipment:allowed.equipment,componentCode:allowed.componentCode,damageCode:allowed.damageCode,
          allowedRepairCodes:allowedCodes,recommendationMode:"RULES_ONLY_OUTSIDE_STAGE5A",
          measurementCaptured:Boolean(measurement),reviewPolicy:"SURVEYOR_SELECTION_REQUIRED"
        }
      });
      return {
        equipment:allowed.equipment,componentCode:allowed.componentCode,damageCode:allowed.damageCode,
        analysisStatus:"ABSTAINED" as AnalysisStatus,selectedCode:null,confidence:null,needsReview:true,
        reviewPolicy:"SURVEYOR_SELECTION_REQUIRED",recommendationMode:"RULES_ONLY_OUTSIDE_STAGE5A",
        measurementRequired:false,reason,candidates:[],allowedRepairs:allowed.repairs,
        allowedRepairCount:allowed.repairs.length,repairRuleSource:"GP.xlsx",model:null,measurement
      };
    }

    if(!measurement||measurement.damageLengthCm===null||measurement.damageWidthCm===null){
      const reason="Enter damage length and width before running GP/PAA dent repair reasoning.";
      await this.repo.saveRepairPrediction({
        findingId,surveyId:context.survey_id,modelName:"RULE_ENGINE_GP_XLSX",
        selectedCode:null,confidence:null,candidates:[],response:{skippedModel:true,reason,allowedRepairCodes:allowedCodes},
        status:"REVIEW_REQUIRED",
        requestContext:{
          equipment:allowed.equipment,componentCode:allowed.componentCode,damageCode:allowed.damageCode,
          allowedRepairCodes:allowedCodes,recommendationMode:"MEASUREMENTS_REQUIRED",
          measurementRequiredFields:["damageLengthCm","damageWidthCm"],reviewPolicy:"SURVEYOR_SELECTION_REQUIRED"
        }
      });
      return {
        equipment:allowed.equipment,componentCode:allowed.componentCode,damageCode:allowed.damageCode,
        analysisStatus:"ABSTAINED" as AnalysisStatus,selectedCode:null,confidence:null,needsReview:true,
        reviewPolicy:"SURVEYOR_SELECTION_REQUIRED",recommendationMode:"MEASUREMENTS_REQUIRED",
        measurementRequired:true,measurementRequiredFields:["damageLengthCm","damageWidthCm"],reason,
        candidates:[],allowedRepairs:allowed.repairs,allowedRepairCount:allowed.repairs.length,
        repairRuleSource:"GP.xlsx",model:null,measurement
      };
    }

    if(allowedCodes.length===1){
      const selectedCode=allowedCodes[0];
      const reason="GP.xlsx leaves only one valid repair method for the confirmed component and damage.";
      await this.repo.saveRepairPrediction({
        findingId,surveyId:context.survey_id,modelName:"RULE_ENGINE_GP_XLSX",
        selectedCode,confidence:1,candidates:[{code:selectedCode,confidence:1,reason}],
        response:{deterministic:true,reason,allowedRepairCodes:allowedCodes},status:"REVIEW_REQUIRED",
        requestContext:{
          equipment:allowed.equipment,componentCode:allowed.componentCode,damageCode:allowed.damageCode,
          measurement,allowedRepairCodes:allowedCodes,recommendationMode:"DETERMINISTIC_SINGLE_ALLOWED",
          reviewPolicy:"SURVEYOR_CONFIRMATION_REQUIRED"
        }
      });
      return {
        equipment:allowed.equipment,componentCode:allowed.componentCode,damageCode:allowed.damageCode,
        analysisStatus:"SUGGESTED" as AnalysisStatus,selectedCode,confidence:1,needsReview:true,
        reviewPolicy:"SURVEYOR_CONFIRMATION_REQUIRED",recommendationMode:"DETERMINISTIC_SINGLE_ALLOWED",
        measurementRequired:false,reason,candidates:[{code:selectedCode,confidence:1,reason}],
        allowedRepairs:allowed.repairs,allowedRepairCount:allowed.repairs.length,
        repairRuleSource:"GP.xlsx",model:null,measurement,historicalCaseCount:0,historicalExamples:[]
      };
    }

    const historical=await this.repo.historicalRepairCases({
      findingId,equipment:"GP",componentCode:"PAA",damageCode:"DT",
      allowedRepairCodes:allowedCodes,limit:40
    });
    const similar=rankHistoricalCases(measurement,historical,context.container_face,context.final_location_code);
    const historicalCodes=new Set(similar.map(item=>item.repairCode));
    const descriptionsByCode=new Map(
      allowed.repairs.map(item=>[item.repair_code,item.description?.trim()||null] as const)
    );

    if(!similar.length){
      const reason="Available verified evidence does not distinguish the permitted GP.xlsx repair methods. Add comparable confirmed repair cases or verified repair-selection rules, then retry.";
      await this.repo.saveRepairPrediction({
        findingId,surveyId:context.survey_id,modelName:"RULE_ENGINE_GP_XLSX",
        selectedCode:null,confidence:null,candidates:[],
        response:{skippedModel:true,reason,allowedRepairCodes:allowedCodes,groundingStatus:"INSUFFICIENT_EVIDENCE"},
        status:"REVIEW_REQUIRED",
        requestContext:{
          equipment:"GP",componentCode:"PAA",damageCode:"DT",
          containerFace:context.container_face,locationCode:context.final_location_code,
          measurement,allowedRepairCodes:allowedCodes,
          recommendationMode:"GROUNDED_EVIDENCE_INSUFFICIENT",
          historicalCaseCount:historical.length,historicalExamplesUsed:[],
          groundingPolicy:"TRACEABLE_EVIDENCE_ONLY",
          reviewPolicy:"SURVEYOR_SELECTION_REQUIRED"
        }
      });
      return {
        equipment:"GP",componentCode:"PAA",damageCode:"DT",
        analysisStatus:"ABSTAINED" as AnalysisStatus,selectedCode:null,confidence:null,needsReview:true,
        reviewPolicy:"SURVEYOR_SELECTION_REQUIRED",
        recommendationMode:"GROUNDED_EVIDENCE_INSUFFICIENT",
        measurementRequired:false,reason,candidates:[],
        allowedRepairs:allowed.repairs,allowedRepairCount:allowed.repairs.length,
        repairRuleSource:allowed.repairs.every(x=>x.standard_version==="GP.xlsx")?"GP.xlsx":"MIXED",
        model:null,measurement,
        groundingPolicy:"TRACEABLE_EVIDENCE_ONLY",groundingStatus:"INSUFFICIENT_EVIDENCE",
        evidenceSources:[] as EvidenceSource[],
        historicalCaseCount:historical.length,historicalExamples:[]
      };
    }

    if(!this.ai){
      throw new Error("Workers AI is unavailable for measurement-aware repair reasoning.");
    }

    const ruleSignals=[
      "GP.xlsx is the hard applicability filter: only the supplied allowed repair codes may be selected.",
      measurement.iiclDepthStatus==="EXCEEDS_DIMENSIONAL_CRITERION"
        ? `Measured dent depth exceeds the mapped dimensional criterion of ${measurement.applicableIiclLimitMm??"unknown"} mm. Treat this as an escalation signal, not as an automatic repair-code rule.`
        : measurement.iiclDepthStatus==="WITHIN_DIMENSIONAL_CRITERION"
          ? "Measured dent depth is within the mapped dimensional criterion only; this does not by itself mean no repair is required."
          : "No authoritative dent-depth criterion is available from the captured measurements.",
      "Do not invent length/width/depth thresholds or IICL criteria that are not supplied.",
      "Historical repairs are examples of prior surveyor decisions, not authoritative rules. Prefer them only when the cases are genuinely comparable."
    ];

    const repairText=allowed.repairs.map(x=>
      `${x.repair_code} = ${x.repair_name}${x.description?` — ${x.description}`:""}`
    ).join("\n");

    const prompt=`You are assisting a shipping-container surveyor with a repair-method recommendation.
The application has already confirmed:
Equipment: GP
Component: PAA
Damage: DT
Container face: ${context.container_face??"unknown"}
CEDEX location: ${context.final_location_code??"unknown"}
Measurements: ${measurementText(measurement)}

Hard constraints and deterministic rule signals:
${ruleSignals.map((x,i)=>`${i+1}. ${x}`).join("\n")}

Allowed repair methods from GP.xlsx:
${repairText}

Most comparable surveyor-confirmed historical cases:
${historyText(similar)}

Choose only among the GP.xlsx-allowed repair codes.
Every recommendation statement must be traceable only to the supplied measurements, mapped IICL criterion, GP.xlsx repair description text, or the listed historical cases.
Do not use unstated general repair practice. Do not claim "first-line", "least-invasive", "last-resort", practical size limits, feasibility, metal fatigue, tearing, or other conditions unless that exact evidence is supplied above.
Measurements and the mapped IICL depth criterion describe the damage but do not by themselves choose among multiple repair codes.
For a non-null selected_code, HISTORICAL_CASE must be included in evidence_sources and at least one supplied comparable historical case must use that selected code.
If the supplied evidence does not distinguish the allowed methods, return selected_code null, confidence null, evidence_sources [], and an empty candidates array.
Do not invent engineering thresholds. Do not treat historical frequency as a rule.
This is decision support only: needs_review must be true.

Return only JSON with selected_code, confidence, needs_review, reason (maximum 35 words), evidence_sources, and up to 3 candidates with code, confidence, reason and evidence_sources.`;

    const runRepairAi=(maxCompletionTokens:number)=>this.ai!.run(MODEL,{
      messages:[{role:"user",content:prompt}],
      max_completion_tokens:maxCompletionTokens,
      reasoning_effort:"medium",
      temperature:0,
      response_format:{
        type:"json_schema",
        json_schema:{
          name:"repair_recommendation",
          strict:true,
          schema:{
            type:"object",
            properties:{
              selected_code:{type:["string","null"],enum:[...allowedCodes,null]},
              confidence:{type:["number","null"],minimum:0,maximum:1},
              needs_review:{type:"boolean",const:true},
              reason:{type:"string"},
              evidence_sources:{
                type:"array",maxItems:4,uniqueItems:true,
                items:{type:"string",enum:["MEASUREMENTS","IICL_CRITERION","GP_XLSX_DESCRIPTION","HISTORICAL_CASE"]}
              },
              candidates:{
                type:"array",maxItems:3,
                items:{
                  type:"object",
                  properties:{
                    code:{type:"string",enum:allowedCodes},
                    confidence:{type:["number","null"],minimum:0,maximum:1},
                    reason:{type:"string"},
                    evidence_sources:{
                      type:"array",maxItems:4,uniqueItems:true,
                      items:{type:"string",enum:["MEASUREMENTS","IICL_CRITERION","GP_XLSX_DESCRIPTION","HISTORICAL_CASE"]}
                    }
                  },
                  required:["code","confidence","reason","evidence_sources"],
                  additionalProperties:false
                }
              }
            },
            required:["selected_code","confidence","needs_review","reason","evidence_sources","candidates"],
            additionalProperties:false
          }
        }
      }
    });

    let aiAttempts=1;
    let completionTokenLimit=INITIAL_COMPLETION_TOKENS;
    let raw=await runRepairAi(completionTokenLimit);
    let envelope=record(raw);
    let choice=Array.isArray(envelope?.choices)?record(envelope.choices[0]):null;
    let finishReason=typeof choice?.finish_reason==="string"?choice.finish_reason:null;
    const initialFinishReason=finishReason;

    if(finishReason==="length"){
      aiAttempts=2;
      completionTokenLimit=RETRY_COMPLETION_TOKENS;
      raw=await runRepairAi(completionTokenLimit);
      envelope=record(raw);
      choice=Array.isArray(envelope?.choices)?record(envelope.choices[0]):null;
      finishReason=typeof choice?.finish_reason==="string"?choice.finish_reason:null;
    }

    const parsed=parseJson(raw);
    const allowedSet=new Set(allowedCodes);

    let analysisStatus:AnalysisStatus="INVALID_RESPONSE";
    let selectedCode:string|null=null;
    let selectedConfidence:number|null=null;
    let reason="AI returned an unreadable repair recommendation. Select a repair method manually.";
    let candidates:Candidate[]=[];
    let selectedEvidenceSources:EvidenceSource[]=[];

    if(finishReason==="length"){
      analysisStatus="ABSTAINED";
      reason="AI repair recommendation remained incomplete after one automatic retry. Select a GP.xlsx-verified repair method manually.";
    }else if((!finishReason||finishReason==="stop")&&!record(choice?.message)?.refusal&&parsed&&
      (parsed.selected_code===null||typeof parsed.selected_code==="string")&&
      validConfidence(parsed.confidence)&&parsed.needs_review===true&&
      typeof parsed.reason==="string"&&evidenceSources(parsed.evidence_sources)!==null&&
      Array.isArray(parsed.candidates)&&parsed.candidates.length<=3){
      const code=typeof parsed.selected_code==="string"?parsed.selected_code.trim().toUpperCase():null;
      const requestedSelectedSources=evidenceSources(parsed.evidence_sources)??[];
      if(code===null||allowedSet.has(code)){
        const supportedSelectedSources=code===null?[]:requestedSelectedSources.filter(source=>{
          if(source==="MEASUREMENTS")return true;
          if(source==="IICL_CRITERION")return measurement.applicableIiclLimitMm!==null&&
            ["WITHIN_DIMENSIONAL_CRITERION","EXCEEDS_DIMENSIONAL_CRITERION"].includes(measurement.iiclDepthStatus??"");
          if(source==="GP_XLSX_DESCRIPTION")return Boolean(descriptionsByCode.get(code));
          if(source==="HISTORICAL_CASE")return historicalCodes.has(code);
          return false;
        });
        const selectedGrounded=code===null||(
          requestedSelectedSources.length===supportedSelectedSources.length&&
          supportedSelectedSources.includes("HISTORICAL_CASE")&&
          historicalCodes.has(code)
        );

        if(selectedGrounded){
          selectedCode=code;
          selectedConfidence=code===null?null:parsed.confidence as number|null;
          selectedEvidenceSources=code===null?[]:supportedSelectedSources;
          reason=code
            ? `Supplied measurements and comparable surveyor-confirmed ${code} cases support this candidate; surveyor confirmation is required.`
            : "Available verified evidence does not distinguish the permitted repair methods.";

          candidates=(parsed.candidates as unknown[]).flatMap(value=>{
            const item=record(value);
            if(!item||typeof item.code!=="string"||!validConfidence(item.confidence)||
              typeof item.reason!=="string")return [];
            const candidateCode=item.code.trim().toUpperCase();
            const requested=evidenceSources(item.evidence_sources);
            if(!allowedSet.has(candidateCode)||!requested)return [];
            const supported=requested.filter(source=>{
              if(source==="MEASUREMENTS")return true;
              if(source==="IICL_CRITERION")return measurement.applicableIiclLimitMm!==null&&
                ["WITHIN_DIMENSIONAL_CRITERION","EXCEEDS_DIMENSIONAL_CRITERION"].includes(measurement.iiclDepthStatus??"");
              if(source==="GP_XLSX_DESCRIPTION")return Boolean(descriptionsByCode.get(candidateCode));
              if(source==="HISTORICAL_CASE")return historicalCodes.has(candidateCode);
              return false;
            });
            if(requested.length!==supported.length||!supported.includes("HISTORICAL_CASE")||!historicalCodes.has(candidateCode))return [];
            return [{
              code:candidateCode,
              confidence:item.confidence as number|null,
              reason:`Comparable surveyor-confirmed ${candidateCode} cases were supplied for this candidate; surveyor confirmation is required.`,
              evidenceSources:supported
            }];
          });
          if(code&&!candidates.some(x=>x.code===code)){
            candidates.unshift({code,confidence:selectedConfidence,reason,evidenceSources:selectedEvidenceSources});
          }
          candidates=candidates.slice(0,3);
          analysisStatus=code?"SUGGESTED":"ABSTAINED";
        }else{
          analysisStatus="ABSTAINED";
          selectedCode=null;
          selectedConfidence=null;
          selectedEvidenceSources=[];
          candidates=[];
          reason="AI suggestion lacked traceable code-specific evidence. Select a GP.xlsx-verified repair method manually.";
        }
      }
    }

    await this.repo.saveRepairPrediction({
      findingId,surveyId:context.survey_id,modelName:MODEL,
      selectedCode,confidence:selectedConfidence,candidates,response:raw,
      status:analysisStatus==="INVALID_RESPONSE"?"FAILED":"REVIEW_REQUIRED",
      requestContext:{
        equipment:"GP",componentCode:"PAA",damageCode:"DT",
        containerFace:context.container_face,locationCode:context.final_location_code,
        measurement,allowedRepairCodes:allowedCodes,ruleSignals,
        recommendationMode:"MEASUREMENT_RULES_HISTORY_QWEN",
        groundingPolicy:"TRACEABLE_EVIDENCE_ONLY",
        groundingStatus:analysisStatus==="SUGGESTED"?"GROUNDED":"INSUFFICIENT_OR_UNVERIFIED",
        evidenceSources:selectedEvidenceSources,
        historicalCaseCount:historical.length,
        historicalExamplesUsed:similar.map(x=>({
          repairCode:x.repairCode,similarityScore:x.similarityScore,
          damageLengthCm:x.damageLengthCm,damageWidthCm:x.damageWidthCm,damageDepthCm:x.damageDepthCm,
          corrugationsAffected:x.corrugationsAffected,deformationDirection:x.deformationDirection,
          containerFace:x.containerFace,locationCode:x.locationCode
        })),
        reviewPolicy:"SURVEYOR_CONFIRMATION_REQUIRED",
        finishReason,initialFinishReason,aiAttempts,completionTokenLimit,
        retryUsed:aiAttempts>1
      }
    });

    return {
      equipment:"GP",componentCode:"PAA",damageCode:"DT",
      analysisStatus,selectedCode,confidence:selectedConfidence,needsReview:true,
      reviewPolicy:"SURVEYOR_CONFIRMATION_REQUIRED",
      recommendationMode:"MEASUREMENT_RULES_HISTORY_QWEN",
      measurementRequired:false,reason,candidates,
      groundingPolicy:"TRACEABLE_EVIDENCE_ONLY",
      groundingStatus:analysisStatus==="SUGGESTED"?"GROUNDED":"INSUFFICIENT_OR_UNVERIFIED",
      evidenceSources:selectedEvidenceSources,
      allowedRepairs:allowed.repairs,allowedRepairCount:allowed.repairs.length,
      repairRuleSource:allowed.repairs.every(x=>x.standard_version==="GP.xlsx")?"GP.xlsx":"MIXED",
      model:MODEL,measurement,ruleSignals,
      historicalCaseCount:historical.length,
      historicalExamples:similar.map(x=>({
        repairCode:x.repairCode,similarityScore:x.similarityScore,
        lengthCm:x.damageLengthCm,widthCm:x.damageWidthCm,depthCm:x.damageDepthCm,
        corrugationsAffected:x.corrugationsAffected,direction:x.deformationDirection,
        face:x.containerFace,locationCode:x.locationCode
      })),
      finishReason,initialFinishReason,aiAttempts,completionTokenLimit,retryUsed:aiAttempts>1
    };
  }
}

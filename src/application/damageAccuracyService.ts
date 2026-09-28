import type { CedexRepository, DamageAccuracyRow } from "../infrastructure/d1/cedexRepository";

export const GP_PAA_PHOTO_DAMAGE_CODES = [
  "BN","CK","CO","CU","DT","DY","GD","ML","PF"
] as const;

const MIN_CASES_PER_CODE=5;
const REVIEW_THRESHOLD=0.8;

function ratio(n:number,d:number){
  return d>0?Number((n/d).toFixed(4)):null;
}

function average(values:Array<number|null>){
  const nums=values.filter((value):value is number=>typeof value==="number"&&Number.isFinite(value));
  if(!nums.length)return null;
  return Number((nums.reduce((sum,value)=>sum+value,0)/nums.length).toFixed(4));
}

function parseContext(value:string|null){
  if(!value)return {} as Record<string,unknown>;
  try{
    const parsed=JSON.parse(value);
    return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)
      ? parsed as Record<string,unknown>
      : {};
  }catch{
    return {};
  }
}

function candidateCodes(value:string|null){
  return (value??"").split("|").map(code=>code.trim().toUpperCase()).filter(Boolean);
}

function booleanOrNull(value:unknown){
  return typeof value==="boolean"?value:null;
}

type BenchmarkRow=DamageAccuracyRow&{
  aiCode:string|null;
  finalCode:string;
  candidates:string[];
  top1Correct:boolean;
  top3Hit:boolean;
  context:Record<string,unknown>;
  reviewRequired:boolean;
};

function normalizeRow(row:DamageAccuracyRow):BenchmarkRow{
  const aiCode=row.ai_value?.trim().toUpperCase()||null;
  const finalCode=row.final_value.trim().toUpperCase();
  const candidates=candidateCodes(row.candidate_codes);
  const context=parseContext(row.request_context_json);
  const storedNeedsReview=booleanOrNull(context.needsReview);
  const evidenceReview=booleanOrNull(context.evidenceReviewRequired)===true;
  const reviewRequired=storedNeedsReview??(
    evidenceReview ||
    aiCode===null ||
    row.confidence===null ||
    row.confidence<REVIEW_THRESHOLD
  );
  return {
    ...row,
    aiCode,
    finalCode,
    candidates,
    top1Correct:Boolean(aiCode&&aiCode===finalCode),
    top3Hit:candidates.includes(finalCode),
    context,
    reviewRequired
  };
}

function aggregate(rows:BenchmarkRow[]){
  const correct=rows.filter(row=>row.top1Correct).length;
  const top3=rows.filter(row=>row.top3Hit).length;
  const corrections=rows.filter(row=>!row.top1Correct).length;
  const review=rows.filter(row=>row.reviewRequired).length;
  const abstentions=rows.filter(row=>row.aiCode===null).length;
  return {
    samples:rows.length,
    top1Correct:correct,
    top1Accuracy:ratio(correct,rows.length),
    top3Hits:top3,
    top3HitRate:ratio(top3,rows.length),
    corrections,
    correctionRate:ratio(corrections,rows.length),
    reviewRequired:review,
    reviewRequiredRate:ratio(review,rows.length),
    abstentions,
    abstentionRate:ratio(abstentions,rows.length),
    averageConfidence:average(rows.map(row=>row.confidence))
  };
}

function confusionSummary(rows:BenchmarkRow[]){
  const map=new Map<string,{expectedCode:string;aiCode:string|null;count:number}>();
  for(const row of rows){
    if(row.top1Correct)continue;
    const key=`${row.finalCode}->${row.aiCode??"NULL"}`;
    const current=map.get(key);
    if(current)current.count+=1;
    else map.set(key,{expectedCode:row.finalCode,aiCode:row.aiCode,count:1});
  }
  return [...map.values()]
    .sort((a,b)=>b.count-a.count||a.expectedCode.localeCompare(b.expectedCode))
    .slice(0,20);
}

const CONFUSION_GROUPS=[
  {name:"DEFORMATION_SURFACE",codes:["DT","GD","PF"]},
  {name:"FRACTURE_CUT",codes:["CK","CU","GD"]},
  {name:"SURFACE_CONDITION",codes:["CO","DY","PF"]},
  {name:"BURN_SURFACE",codes:["BN","CO","DY"]}
] as const;

export class DamageAccuracyService{
  constructor(private readonly repo:Pick<CedexRepository,"damageAccuracyRows">){}

  async report(limit=500){
    const raw=await this.repo.damageAccuracyRows({equipment:"GP",componentCode:"PAA",limit});
    const rows=raw
      .filter(row=>row.final_value&&row.decision!=="REJECTED")
      .map(normalizeRow);
    const focusSet=new Set<string>(GP_PAA_PHOTO_DAMAGE_CODES);
    const focusRows=rows.filter(row=>focusSet.has(row.finalCode));

    const perCode=GP_PAA_PHOTO_DAMAGE_CODES.map(code=>{
      const codeRows=focusRows.filter(row=>row.finalCode===code);
      return {
        code,
        ...aggregate(codeRows),
        targetMinimum:MIN_CASES_PER_CODE,
        coverageReady:codeRows.length>=MIN_CASES_PER_CODE
      };
    });

    const confidenceBands=[
      {label:"0.90-1.00",min:0.9,max:1.000001},
      {label:"0.80-0.89",min:0.8,max:0.9},
      {label:"<0.80",min:-1,max:0.8}
    ].map(band=>{
      const bandRows=focusRows.filter(row=>typeof row.confidence==="number"&&row.confidence>=band.min&&row.confidence<band.max);
      return {label:band.label,...aggregate(bandRows)};
    });

    const confusionGroups=CONFUSION_GROUPS.map(group=>{
      const groupSet=new Set<string>(group.codes);
      const relevant=focusRows.filter(row=>groupSet.has(row.finalCode));
      const crossConfusions=relevant.filter(row=>!row.top1Correct&&row.aiCode!==null&&groupSet.has(row.aiCode));
      return {
        name:group.name,
        codes:[...group.codes],
        samples:relevant.length,
        withinGroupConfusions:crossConfusions.length,
        withinGroupConfusionRate:ratio(crossConfusions.length,relevant.length)
      };
    });

    return {
      generatedAt:new Date().toISOString(),
      source:"SURVEYOR_CONFIRMED_DAMAGE_DECISIONS",
      equipment:"GP",
      componentCode:"PAA",
      focusCodes:[...GP_PAA_PHOTO_DAMAGE_CODES],
      excludedContextDependentCodes:["CD","CT","IR","ME","MX","NI"],
      recommendedMinimumPerCode:MIN_CASES_PER_CODE,
      recommendedMinimumTotal:MIN_CASES_PER_CODE*GP_PAA_PHOTO_DAMAGE_CODES.length,
      benchmarkReady:perCode.every(row=>row.coverageReady),
      allConfirmedPaa:aggregate(rows),
      photoVisualFocus:aggregate(focusRows),
      perCode,
      confusions:confusionSummary(focusRows),
      confusionGroups,
      confidenceBands,
      reviewThreshold:REVIEW_THRESHOLD
    };
  }
}

import type { CedexRepository, ComponentAccuracyRow } from "../infrastructure/d1/cedexRepository";

export const COMPONENT_ACCURACY_FOCUS_CODES = [
  "LBB","LBR","LBG","LBC","HWR","HWH","HGA","HGB","HGP","PAA",
  "CFG","CPO","CPA"
] as const;

const MIN_CASES_PER_CODE = 5;

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

function bool(value:unknown){
  return value===true;
}

function numberOrNull(value:unknown){
  return typeof value==="number"&&Number.isFinite(value)?value:null;
}

type BenchmarkRow=ComponentAccuracyRow&{
  aiCode:string|null;
  finalCode:string;
  top1Correct:boolean;
  top3Hit:boolean;
  candidates:string[];
  context:Record<string,unknown>;
};

function normalizeRow(row:ComponentAccuracyRow):BenchmarkRow{
  const aiCode=row.ai_value?.trim().toUpperCase()||null;
  const finalCode=row.final_value.trim().toUpperCase();
  const candidates=candidateCodes(row.candidate_codes);
  return {
    ...row,
    aiCode,
    finalCode,
    top1Correct:Boolean(aiCode&&aiCode===finalCode),
    top3Hit:candidates.includes(finalCode),
    candidates,
    context:parseContext(row.request_context_json)
  };
}

function aggregate(rows:BenchmarkRow[]){
  const correct=rows.filter(row=>row.top1Correct).length;
  const top3=rows.filter(row=>row.top3Hit).length;
  const corrections=rows.filter(row=>!row.top1Correct).length;
  return {
    samples:rows.length,
    top1Correct:correct,
    top1Accuracy:ratio(correct,rows.length),
    top3Hits:top3,
    top3HitRate:ratio(top3,rows.length),
    corrections,
    correctionRate:ratio(corrections,rows.length),
    averageConfidence:average(rows.map(row=>row.confidence))
  };
}

function familySlice(rows:BenchmarkRow[], mode:"NARROWED"|"FALLBACK"){
  return rows.filter(row=>{
    const narrowed=bool(row.context.componentFamilyNarrowingUsed);
    const fallback=bool(row.context.componentFamilyFallbackUsed);
    return mode==="NARROWED"?narrowed:fallback;
  });
}

export class ComponentAccuracyService{
  constructor(private readonly repo:Pick<CedexRepository,"componentAccuracyRows">){}

  async report(limit=500){
    const raw=await this.repo.componentAccuracyRows(limit);
    const rows=raw
      .filter(row=>row.final_value&&row.decision!=="REJECTED")
      .map(normalizeRow);
    const focusSet=new Set<string>(COMPONENT_ACCURACY_FOCUS_CODES);
    const focusRows=rows.filter(row=>focusSet.has(row.finalCode));

    const perCode=COMPONENT_ACCURACY_FOCUS_CODES.map(code=>{
      const codeRows=focusRows.filter(row=>row.finalCode===code);
      return {
        code,
        ...aggregate(codeRows),
        targetMinimum:MIN_CASES_PER_CODE,
        coverageReady:codeRows.length>=MIN_CASES_PER_CODE
      };
    });

    const confusionMap=new Map<string,{expectedCode:string;aiCode:string|null;count:number}>();
    for(const row of focusRows){
      if(row.top1Correct)continue;
      const key=`${row.finalCode}->${row.aiCode??"NULL"}`;
      const current=confusionMap.get(key);
      if(current)current.count+=1;
      else confusionMap.set(key,{expectedCode:row.finalCode,aiCode:row.aiCode,count:1});
    }
    const confusions=[...confusionMap.values()]
      .sort((a,b)=>b.count-a.count||a.expectedCode.localeCompare(b.expectedCode))
      .slice(0,20);

    const narrowed=familySlice(focusRows,"NARROWED");
    const fallback=familySlice(focusRows,"FALLBACK");

    const shortlistSizes=focusRows
      .map(row=>numberOrNull(row.context.classificationAllowedComponentCount))
      .filter((value):value is number=>value!==null);
    const fullSizes=focusRows
      .map(row=>numberOrNull(row.context.allowedComponentCount)??numberOrNull(row.context.fullAllowedCount))
      .filter((value):value is number=>value!==null);

    const confidenceBands=[
      {label:"0.90-1.00",min:0.9,max:1.000001},
      {label:"0.80-0.89",min:0.8,max:0.9},
      {label:"<0.80",min:-1,max:0.8}
    ].map(band=>{
      const bandRows=focusRows.filter(row=>typeof row.confidence==="number"&&row.confidence>=band.min&&row.confidence<band.max);
      return {label:band.label,...aggregate(bandRows)};
    });

    return {
      generatedAt:new Date().toISOString(),
      source:"SURVEYOR_CONFIRMED_COMPONENT_DECISIONS",
      focusCodes:[...COMPONENT_ACCURACY_FOCUS_CODES],
      recommendedMinimumPerCode:MIN_CASES_PER_CODE,
      benchmarkReady:perCode.every(row=>row.coverageReady),
      overall:aggregate(rows),
      focus:aggregate(focusRows),
      perCode,
      confusions,
      familyShortlist:{
        narrowed:{...aggregate(narrowed),samplesWithFamilyShortlist:narrowed.length},
        fallback:{...aggregate(fallback),samplesWithFamilyFallback:fallback.length},
        averageClassificationAllowedCount:average(shortlistSizes),
        averageFullAllowedCount:average(fullSizes)
      },
      confidenceBands
    };
  }
}

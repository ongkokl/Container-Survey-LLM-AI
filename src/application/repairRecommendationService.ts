import { CedexRepository } from "../infrastructure/d1/cedexRepository";

type AnalysisStatus="ABSTAINED";

export class RepairRecommendationService{
  constructor(private readonly repo:CedexRepository){}

  async analyse(findingId:string){
    const context=await this.repo.findingContext(findingId);
    if(!context)throw new Error("Finding not found.");

    const allowed=await this.repo.repairCodesForFinding(findingId);
    if(!allowed.repairs.length){
      throw new Error(`No verified GP.xlsx repair methods are loaded for ${allowed.equipment} ${allowed.componentCode} + ${allowed.damageCode}.`);
    }

    // Phase 5 policy: GP.xlsx constrains which repair methods are valid, but the
    // app does not yet have authoritative damage-size/severity criteria. Do not
    // let a vision-language model choose GS/IT/PT/RP/SN/etc from appearance
    // alone. Present the verified methods and require the surveyor to decide.
    const analysisStatus:AnalysisStatus="ABSTAINED";
    const reason="GP.xlsx confirms the valid repair methods, but selecting one requires damage measurements/severity criteria that are not captured yet.";
    const allowedCodes=[...new Set(allowed.repairs.map(x=>x.repair_code))];

    const result={
      equipment:allowed.equipment,
      componentCode:allowed.componentCode,
      damageCode:allowed.damageCode,
      analysisStatus,
      selectedCode:null,
      confidence:null,
      needsReview:true,
      reviewPolicy:"SURVEYOR_SELECTION_REQUIRED",
      recommendationMode:"RULES_ONLY_UNTIL_MEASUREMENTS",
      measurementRequired:true,
      reason,
      candidates:[],
      allowedRepairs:allowed.repairs,
      allowedRepairCount:allowed.repairs.length,
      repairRuleSource:allowed.repairs.every(x=>x.standard_version==="GP.xlsx")?"GP.xlsx":"MIXED",
      model:null
    };

    await this.repo.saveRepairPrediction({
      findingId,
      surveyId:context.survey_id,
      modelName:"RULE_ENGINE_GP_XLSX",
      selectedCode:null,
      confidence:null,
      candidates:[],
      response:{
        skippedModel:true,
        reason,
        allowedRepairCodes:allowedCodes
      },
      status:"REVIEW_REQUIRED",
      requestContext:{
        equipment:allowed.equipment,
        componentCode:allowed.componentCode,
        damageCode:allowed.damageCode,
        allowedRepairCodes:allowedCodes,
        repairRuleSource:"GP.xlsx",
        recommendationMode:"RULES_ONLY_UNTIL_MEASUREMENTS",
        measurementRequired:true,
        reviewPolicy:"SURVEYOR_SELECTION_REQUIRED"
      }
    });

    return result;
  }
}

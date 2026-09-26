import {
  ContainerIdentificationError,
  ContainerIdentificationService
} from "./application/containerIdentificationService";
import {
  DoorIdentificationError,
  DoorIdentificationService
} from "./application/doorIdentificationService";
import { QwenDoorIdentityProvider } from "./infrastructure/ai/qwenDoorIdentityProvider";
import {
  IdentificationAttemptRepository,
  SurveyRepository
} from "./infrastructure/d1/surveyRepository";
import { PhotoStore } from "./infrastructure/r2/photoStore";
import { FindingRepository } from "./infrastructure/d1/findingRepository";
import { FindingCaptureService } from "./application/findingCaptureService";
import { MoondreamDamageMarker } from "./infrastructure/ai/moondreamDamageMarker";
import { CedexRepository } from "./infrastructure/d1/cedexRepository";
import { CedexClassificationService } from "./application/cedexClassificationService";
import { DamageClassificationService } from "./application/damageClassificationService";
import { RepairRecommendationService } from "./application/repairRecommendationService";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Expected application/json request body.");
  }
  return request.json<T>();
}

function identificationService(env: Env): ContainerIdentificationService {
  return new ContainerIdentificationService(new SurveyRepository(env.DB));
}

function doorIdentificationService(env: Env): DoorIdentificationService {
  const ai = env.AI as unknown as {
    run(model: string, input: unknown): Promise<unknown>;
  };

  return new DoorIdentificationService(
    new QwenDoorIdentityProvider(ai),
    new PhotoStore(env.PHOTOS),
    new IdentificationAttemptRepository(env.DB),
    new SurveyRepository(env.DB)
  );
}

function cedexService(env:Env):CedexClassificationService{
  const ai=env.AI as unknown as {run(model:string,input:unknown):Promise<unknown>};
  return new CedexClassificationService(new CedexRepository(env.DB),env.PHOTOS,ai);
}

function findingService(env: Env): FindingCaptureService {
  return new FindingCaptureService(new FindingRepository(env.DB), new PhotoStore(env.PHOTOS));
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({
      ok: true,
      service: "Container Survey LLM AI",
      phase: "POC phase 5 - component, damage and repair recommendation",
      visionModel: "@cf/qwen/qwen3.8-27b",
      time: new Date().toISOString()
    });
  }

  if (request.method === "POST" && url.pathname === "/api/vision/mark-damage") {
    try {
      const form=await request.formData(),file=form.get("photo"),mode=String(form.get("mode")??"point");
      if(!(file instanceof File)) throw new Error("A photo is required.");
      if(file.size>8*1024*1024) throw new Error("Photo must be below 8 MB.");
      const ai=env.AI as unknown as {run(model:string,input:unknown):Promise<unknown>};
      const marker=new MoondreamDamageMarker(ai);
      const result=mode==="box"?await marker.detect(file):await marker.point(file);
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"AI_MARK_FAILED",message:error instanceof Error?error.message:"Unable to locate damage."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/component-suggest") {
    try {
      const body=await readJson<{findingId?:string}>(request);
      const result=await cedexService(env).analyseComponent(body.findingId??"");
      if(result.analysisStatus==="INCOMPLETE"||result.analysisStatus==="INVALID_RESPONSE"){
        return json({ok:false,error:"CEDEX_COMPONENT_"+result.analysisStatus,message:result.reason,result},422);
      }
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"CEDEX_COMPONENT_FAILED",message:error instanceof Error?error.message:"Unable to classify component."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/component-decision") {
    try {
      const body=await readJson<{findingId?:string;finalCode?:string}>(request);
      const repo=new CedexRepository(env.DB);
      return json({ok:true,result:await repo.decideComponent({findingId:body.findingId??"",finalCode:body.finalCode??""})});
    } catch(error) {
      return json({ok:false,error:"CEDEX_COMPONENT_DECISION_FAILED",message:error instanceof Error?error.message:"Unable to save component decision."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/damage-suggest") {
    try {
      const body=await readJson<{findingId?:string}>(request);
      const ai=env.AI as unknown as {run(model:string,input:unknown):Promise<unknown>};
      const service=new DamageClassificationService(new CedexRepository(env.DB),env.PHOTOS,ai);
      const result=await service.analyse(body.findingId??"");
      if(result.analysisStatus==="INCOMPLETE"||result.analysisStatus==="INVALID_RESPONSE"){
        return json({ok:false,error:"CEDEX_DAMAGE_"+result.analysisStatus,message:result.reason,result},422);
      }
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"CEDEX_DAMAGE_FAILED",message:error instanceof Error?error.message:"Unable to classify damage."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/damage-decision") {
    try {
      const body=await readJson<{findingId?:string;finalCode?:string}>(request);
      return json({ok:true,result:await new CedexRepository(env.DB).decideDamage({findingId:body.findingId??"",finalCode:body.finalCode??""})});
    } catch(error) {
      return json({ok:false,error:"CEDEX_DAMAGE_DECISION_FAILED",message:error instanceof Error?error.message:"Unable to save damage decision."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/repair-suggest") {
    try {
      const body=await readJson<{findingId?:string}>(request);
      const service=new RepairRecommendationService(new CedexRepository(env.DB));
      const result=await service.analyse(body.findingId??"");
      if(result.analysisStatus==="INCOMPLETE"||result.analysisStatus==="INVALID_RESPONSE"){
        return json({ok:false,error:"CEDEX_REPAIR_"+result.analysisStatus,message:result.reason,result},422);
      }
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"CEDEX_REPAIR_FAILED",message:error instanceof Error?error.message:"Unable to recommend repair method."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/repair-decision") {
    try {
      const body=await readJson<{findingId?:string;finalCode?:string}>(request);
      return json({ok:true,result:await new CedexRepository(env.DB).decideRepair({findingId:body.findingId??"",finalCode:body.finalCode??""})});
    } catch(error) {
      return json({ok:false,error:"CEDEX_REPAIR_DECISION_FAILED",message:error instanceof Error?error.message:"Unable to save repair decision."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/findings") {
    try {
      const body=await readJson<{surveyId?:string;containerFace?:string}>(request);
      const result=await findingService(env).create(body.surveyId??"",body.containerFace??"");
      return json({ok:true,result},201);
    } catch(error) {
      return json({ok:false,error:"FINDING_CREATE_FAILED",message:error instanceof Error?error.message:"Unable to create finding."},422);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/findings") {
    try {
      const surveyId=url.searchParams.get("surveyId")??"";
      return json({ok:true,result:await findingService(env).list(surveyId)});
    } catch(error) {
      return json({ok:false,error:"FINDING_LIST_FAILED",message:error instanceof Error?error.message:"Unable to list findings."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/findings/photo") {
    try {
      const form=await request.formData();
      const file=form.get("photo");
      if(!(file instanceof File)) throw new Error("A photo is required.");
      const result=await findingService(env).upload({
        surveyId:String(form.get("surveyId")??""),
        findingId:String(form.get("findingId")??""),
        role:String(form.get("role")??""),
        file,
        width:Number(form.get("width"))||null,
        height:Number(form.get("height"))||null
      });
      return json({ok:true,result},201);
    } catch(error) {
      return json({ok:false,error:"PHOTO_UPLOAD_FAILED",message:error instanceof Error?error.message:"Unable to upload photo."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/annotations") {
    try {
      const body=await readJson<{photoId?:string;annotationType?:string;geometryType?:string;geometry?:unknown;createdBy?:"AI"|"SURVEYOR"}>(request);
      const result=await findingService(env).annotate({
        photoId:body.photoId??"",annotationType:body.annotationType??"",
        geometryType:body.geometryType??"",geometry:body.geometry,createdBy:body.createdBy
      });
      return json({ok:true,result},201);
    } catch(error) {
      return json({ok:false,error:"ANNOTATION_FAILED",message:error instanceof Error?error.message:"Unable to save annotation."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/door/identify") {
    try {
      const form = await request.formData();
      const value = form.get("doorPhoto");

      if (!(value instanceof File)) {
        throw new DoorIdentificationError(
          "A door photo is required.",
          "IMAGE_REQUIRED"
        );
      }

      const result = await doorIdentificationService(env).analyse(value);
      return json({ ok: true, result });
    } catch (error) {
      if (error instanceof DoorIdentificationError) {
        return json(
          { ok: false, error: error.code, message: error.message },
          422
        );
      }

      return json(
        {
          ok: false,
          error: "DOOR_OCR_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Unable to analyse the container door photo."
        },
        502
      );
    }
  }

  if (request.method === "POST" && url.pathname === "/api/door/confirm") {
    try {
      const body = await readJson<{
        attemptId?: string;
        containerNo?: string;
        isoSizeType?: string;
        depotCode?: string;
      }>(request);

      const result = await doorIdentificationService(env).confirm({
        attemptId: body.attemptId ?? "",
        containerNo: body.containerNo ?? "",
        isoSizeType: body.isoSizeType ?? "",
        depotCode: body.depotCode
      });

      return json(
        { ok: true, result },
        result.survey.resumed ? 200 : 201
      );
    } catch (error) {
      if (error instanceof DoorIdentificationError) {
        return json(
          { ok: false, error: error.code, message: error.message },
          422
        );
      }

      return json(
        {
          ok: false,
          error: "DOOR_CONFIRM_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Unable to confirm the container identity."
        },
        500
      );
    }
  }

  if (request.method === "POST" && url.pathname === "/api/container/validate") {
    try {
      const body = await readJson<{
        containerNo?: string;
        isoSizeType?: string;
        depotCode?: string;
      }>(request);

      const result = await identificationService(env).validate({
        containerNo: body.containerNo ?? "",
        isoSizeType: body.isoSizeType ?? "",
        depotCode: body.depotCode
      });

      return json({ ok: true, result });
    } catch (error) {
      if (error instanceof ContainerIdentificationError) {
        return json(
          { ok: false, error: error.code, message: error.message },
          422
        );
      }

      return json(
        {
          ok: false,
          error: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Invalid request."
        },
        400
      );
    }
  }

  if (request.method === "POST" && url.pathname === "/api/surveys/start") {
    try {
      const body = await readJson<{
        containerNo?: string;
        isoSizeType?: string;
        depotCode?: string;
      }>(request);

      const result = await identificationService(env).startOrResume({
        containerNo: body.containerNo ?? "",
        isoSizeType: body.isoSizeType ?? "",
        depotCode: body.depotCode
      });

      return json({ ok: true, result }, result.survey.resumed ? 200 : 201);
    } catch (error) {
      if (error instanceof ContainerIdentificationError) {
        return json(
          { ok: false, error: error.code, message: error.message },
          422
        );
      }

      return json(
        {
          ok: false,
          error: "START_SURVEY_FAILED",
          message: error instanceof Error ? error.message : "Unable to start survey."
        },
        500
      );
    }
  }

  return json({ ok: false, error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;

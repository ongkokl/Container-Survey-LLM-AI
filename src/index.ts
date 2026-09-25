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

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({
      ok: true,
      service: "Container Survey LLM AI",
      phase: "POC phase 2 - door OCR",
      visionModel: "@cf/qwen/qwen3.8-27b",
      time: new Date().toISOString()
    });
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

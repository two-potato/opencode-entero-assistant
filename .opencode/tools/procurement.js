import { tool } from "@opencode-ai/plugin";
import {
  rankEnteroResults,
  validateResearchResult,
} from "../../src/workflow/contracts.mjs";

function json(value) {
  return JSON.stringify(value, null, 2);
}

function parseJson(value, name) {
  try {
    return JSON.parse(value);
  } catch {
    const error = new Error(`${name} must contain valid JSON`);
    error.code = "WORKFLOW_INPUT_INVALID";
    throw error;
  }
}

function safeError(error) {
  return json({
    error: {
      code: typeof error?.code === "string" ? error.code : "WORKFLOW_UNKNOWN_ERROR",
      message: typeof error?.message === "string" ? error.message : "Workflow validation failed",
    },
  });
}

export const validate_research = tool({
  description: "Validate and normalize a completed internet product-research JSON contract.",
  args: {
    research_json: tool.schema.string().min(2).max(50000),
  },
  async execute(args) {
    try {
      return json(validateResearchResult(parseJson(args.research_json, "research_json")));
    } catch (error) {
      return safeError(error);
    }
  },
});

export const rank_offers = tool({
  description: "Filter and rank verified Entero candidate JSON against a normalized request and validated research.",
  args: {
    request_json: tool.schema.string().min(2).max(30000),
    research_json: tool.schema.string().min(2).max(50000),
    candidates_json: tool.schema.string().min(2).max(100000),
  },
  async execute(args) {
    try {
      return json(rankEnteroResults({
        request: parseJson(args.request_json, "request_json"),
        research: parseJson(args.research_json, "research_json"),
        candidates: parseJson(args.candidates_json, "candidates_json"),
      }));
    } catch (error) {
      return safeError(error);
    }
  },
});

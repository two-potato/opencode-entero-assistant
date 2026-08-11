import { tool } from "@opencode-ai/plugin"
import {
  readEnteroNextPage,
  readEnteroProduct,
  searchEntero,
} from "../../src/entero/client.mjs"

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function safeError(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown; sourceUrl?: unknown }
  return json({
    error: {
      code: typeof candidate?.code === "string" ? candidate.code : "ENTERO_UNKNOWN_ERROR",
      message: typeof candidate?.message === "string" ? candidate.message : "Entero request failed",
      sourceUrl: typeof candidate?.sourceUrl === "string" ? candidate.sourceUrl : null,
    },
  })
}

export const search = tool({
  description: "Search public Entero product pages through the closed read-only adapter.",
  args: {
    query: tool.schema.string().min(2).max(200),
    category_id: tool.schema.number().int().positive().optional(),
    page: tool.schema.number().int().min(1).max(5).default(1),
    max_price: tool.schema.number().int().positive().optional(),
    limit: tool.schema.number().int().min(1).max(10).default(5),
  },
  async execute(args) {
    try {
      return json(await searchEntero({
        query: args.query,
        categoryId: args.category_id,
        page: args.page,
        maxPrice: args.max_price,
        limit: args.limit,
      }))
    } catch (error) {
      return safeError(error)
    }
  },
})

export const read_product = tool({
  description: "Read and verify one public Entero /item/<numeric-id> product page.",
  args: {
    item: tool.schema.string().min(1).max(200),
  },
  async execute(args) {
    try {
      return json(await readEnteroProduct(args.item))
    } catch (error) {
      return safeError(error)
    }
  },
})

export const next_page = tool({
  description: "Read the next Entero search page represented by an adapter-issued cursor.",
  args: {
    cursor: tool.schema.string().min(1).max(2000),
    max_price: tool.schema.number().int().positive().optional(),
    limit: tool.schema.number().int().min(1).max(10).default(5),
  },
  async execute(args) {
    try {
      return json(await readEnteroNextPage(args.cursor, {
        maxPrice: args.max_price,
        limit: args.limit,
      }))
    } catch (error) {
      return safeError(error)
    }
  },
})

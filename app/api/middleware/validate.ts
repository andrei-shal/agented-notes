import type { MiddlewareHandler } from "hono";
import type { ZodSchema } from "zod";

/**
 * Hono middleware that validates the incoming request body against a Zod
 * schema.
 *
 * On success the parsed (and typed) value is set on `c.var.valid` so downstream
 * handlers can access it via `c.get("valid")`.
 *
 * On failure a `400` response is returned with per-field error details:
 * ```json
 * {
 *   "error": "Validation failed",
 *   "code": "VALIDATION_ERROR",
 *   "details": [
 *     { "field": "email", "message": "Invalid email address" }
 *   ]
 * }
 * ```
 */
export function zodValidator(schema: ZodSchema): MiddlewareHandler {
  return async (c, next) => {
    const contentType = c.req.header("content-type") ?? "";

    let raw: unknown;
    if (contentType.includes("application/json")) {
      try {
        raw = await c.req.json();
      } catch {
        return c.json(
          { error: "Invalid JSON body", code: "INVALID_JSON" },
          400,
        );
      }
    } else {
      return c.json(
        { error: "Unsupported content type", code: "UNSUPPORTED_CONTENT_TYPE" },
        415,
      );
    }

    const result = schema.safeParse(raw);
    if (!result.success) {
      const details = result.error.errors.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));

      return c.json(
        {
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          details,
        },
        400,
      );
    }

    c.set("valid", result.data);
    await next();
  };
}

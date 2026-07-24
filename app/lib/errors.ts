import type { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends Error {
  public readonly statusCode: ContentfulStatusCode;
  public readonly code: string;

  constructor(statusCode: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

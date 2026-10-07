export class ApiError extends Error {
  constructor(
    public readonly statusCode: 400 | 403 | 404 | 409,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

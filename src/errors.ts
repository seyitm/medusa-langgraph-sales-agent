export type ErrorCode =
  | "AUTH_FAILED"
  | "CONTEXT_MISMATCH"
  | "CART_REQUIRED"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "APPROVAL_STALE"
  | "APPROVAL_EXPIRED"
  | "MEDUSA_UNAVAILABLE"
  | "MODEL_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError("INTERNAL_ERROR", "An unexpected error occurred", 500, false, {
    cause: error,
  });
}

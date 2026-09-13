export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503 = 400,
  ) {
    super(message);
  }
}
export function required<T>(
  value: T | null | undefined,
  code = 'NOT_FOUND',
  message = 'Resource not found',
): T {
  if (value == null) throw new AppError(code, message, 404);
  return value;
}

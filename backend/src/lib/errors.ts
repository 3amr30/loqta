/** Typed application error rendered by the error handler as the standard
 *  envelope: { error: { code, message, details? } } */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ApiError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public errors?: any[];

  constructor(statusCode: number, message: string, errors?: any[], isOperational = true, stack = '') {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errors = errors;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  static badRequest(message: string, errors?: any[]) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Unauthorized', errors?: any[]) {
    return new ApiError(401, message, errors);
  }

  static forbidden(message = 'Forbidden', errors?: any[]) {
    return new ApiError(403, message, errors);
  }

  static notFound(message = 'Resource not found', errors?: any[]) {
    return new ApiError(404, message, errors);
  }

  static conflict(message: string, errors?: any[]) {
    return new ApiError(409, message, errors);
  }

  static internal(message = 'Internal server error', errors?: any[]) {
    return new ApiError(500, message, errors);
  }
}


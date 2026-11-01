/** Standard API response envelope used by the API, dashboard and mobile app. */
export type ApiSuccess<T> = { ok: true; data: T };
export type ApiError = { ok: false; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export type HealthStatus = {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  database: 'up' | 'down';
};

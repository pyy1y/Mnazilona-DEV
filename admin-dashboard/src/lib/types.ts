import { AxiosError } from 'axios';

export interface ApiErrorResponse {
  message?: string;
  error?: string;
}

export type ApiError = AxiosError<ApiErrorResponse>;

export function getErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const error = err as ApiError;
  return error?.response?.data?.message || error?.message || fallback;
}

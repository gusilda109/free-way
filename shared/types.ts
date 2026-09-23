import type { Category, Condition, Status } from './catalog';

/** Публичные поля точки. created_by никогда не отдается клиенту. */
export interface ObstacleDTO {
  id: string;
  lat: number;
  lon: number;
  category: Category;
  condition: Condition;
  description: string;
  observed_at: string;
  status: Exclude<Status, 'hidden'>;
  created_at: string;
}

export interface ObstacleListResponse {
  items: ObstacleDTO[];
  truncated: boolean;
}

export interface CreateObstacleRequest {
  id: string;
  lat: number;
  lon: number;
  category: Category;
  condition: Condition;
  description: string;
  photo_path: string;
  observed_at: string;
}

export interface ReportResponse {
  report_count: number;
  status: Status;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteRequest {
  start: LatLon;
  end: LatLon;
}

export interface RouteResponse {
  /** LineString в формате GeoJSON: координаты [lon, lat]. */
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  distance: number;
  duration: number;
}

export type ErrorCode =
  | 'NETWORK_ERROR'
  | 'LIMIT_EXCEEDED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'DATABASE_ERROR'
  | 'PHOTO_INVALID'
  | 'PHOTO_TOO_LARGE'
  | 'STORAGE_ERROR'
  | 'STORAGE_FULL'
  | 'NOT_FOUND'
  | 'ALREADY_REPORTED'
  | 'RATE_LIMITED'
  | 'ROUTE_INVALID'
  | 'ROUTE_NOT_FOUND'
  | 'ROUTE_RATE_LIMITED'
  | 'ROUTE_UNAVAILABLE';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}

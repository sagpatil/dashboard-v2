import { NETWORKS } from '../../shared/networks.ts';

// JSON schemas shared by routes; they drive both validation and the OpenAPI document

export const networkParams = {
  type: 'object',
  required: ['network'],
  properties: { network: { type: 'string', enum: NETWORKS, description: 'Stellar network' } },
} as const;

export const errorResponse = {
  type: 'object',
  description: 'Error',
  required: ['error', 'message'],
  properties: {
    error: { type: 'string', description: 'HTTP status text' },
    message: { type: 'string' },
  },
} as const;

// Upstream payload passed through as-is; documented but not re-serialized
export const passthrough = (description: string) =>
  ({ description, type: 'object', additionalProperties: true }) as const;

export const passthroughList = (description: string) =>
  ({ description, type: 'array', items: { type: 'object', additionalProperties: true } }) as const;

export const ledger = {
  type: 'object',
  additionalProperties: true,
  properties: {
    sequence: { type: 'integer' },
    hash: { type: 'string' },
    paging_token: { type: 'string' },
    closed_at: { type: 'string', format: 'date-time' },
    successful_transaction_count: { type: 'integer' },
    failed_transaction_count: { type: 'integer' },
    operation_count: { type: 'integer' },
    protocol_version: { type: 'integer' },
  },
} as const;

export const commonErrors = {
  400: errorResponse,
  429: errorResponse,
  502: errorResponse,
  503: errorResponse,
} as const;

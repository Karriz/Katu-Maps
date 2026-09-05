import { apiHttpError, fetchWithTimeout } from './ApiRequest';
import { serviceConfig } from './ServiceConfig';

export type JsonRecord = Record\u003cstring, unknown\u003e;

export function digitrafficHeaders() {
  return {
    Accept: 'application/json',
    'Digitraffic-User': serviceConfig.clientId,
  };
}

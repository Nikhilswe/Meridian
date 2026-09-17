/**
 * Config namespaces known to the app. The ConfigResolver (backend/src/config)
 * resolves a (env, namespace, key) triple with wildcard fallback:
 *   1. <env>.<namespace>.<key>   e.g. prod.rateLimit.ticketCreateMax
 *   2. <env>.*.<key>             e.g. prod.*.ticketCreateMax
 *   3. *.<namespace>.<key>       e.g. *.rateLimit.ticketCreateMax
 *   4. *.*.<key>                 e.g. *.*.ticketCreateMax
 * First match wins. This lets ops override one env/namespace/key combination
 * without duplicating every other value.
 */
export type ConfigEnv = "local" | "beta" | "prod" | "*";

export interface ConfigKeyRef {
  namespace: string;
  key: string;
}

import { ValidationError } from "../domain/errors";

/**
 * Express's ParamsDictionary has an index signature, which under this repo's
 * strict `noUncheckedIndexedAccess` setting makes `req.params.id` come back
 * typed `string | undefined` even though a matched `:id` route segment is
 * always present at runtime. This narrows it in one place with a clear
 * error instead of sprinkling non-null assertions through every route.
 */
export function requireRouteParam(value: string | undefined, name: string): string {
  if (!value) {
    throw new ValidationError(`Missing required route parameter "${name}"`);
  }
  return value;
}

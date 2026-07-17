---
name: Orval codegen pitfalls
description: Gotchas when regenerating the API client/zod packages from openapi.yaml
---

- Orval appends `export * from './generated/...';` lines to `lib/api-zod/src/index.ts` using exact string match with **single quotes**. Hand-written double-quoted lines don't match, so orval re-appends duplicates → TS2308. Keep index.ts lines single-quoted.
- Adding a query parameter to an operation that previously had only path params creates a name collision: the zod path-params schema `<Op>Params` (in generated/api) clashes with the generated query-params *type* `<Op>Params` (in generated/types). Resolve with an explicit re-export in index.ts choosing the zod schema.
- Adding params to an operation changes the generated hook signature (`useX(domain, params?, options?)`) — every existing call site must insert `undefined` for params or options land in the wrong slot.

**How to apply:** whenever editing `lib/api-spec/openapi.yaml` and running codegen, check these three before assuming codegen "just works."

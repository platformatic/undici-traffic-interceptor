# UNDICI-TRAFFIC-INTERCEPTOR DEVELOPMENT GUIDE

## Commands
- Build: `pnpm build`
- Test (all): `pnpm test`
- Test (single): `node --test --experimental-strip-types test/specific-file.test.ts`
- Lint: `pnpm lint`
- Fix lint: `pnpm lint:fix`
- Typecheck: `pnpm typecheck`
- Full check: `pnpm check` (runs lint, typecheck, test)

## Code Style
- **TypeScript**: Strict mode, ESM modules
- **Imports**: Use .ts extension (e.g., `import { x } from './lib/file.ts'`)
- **Naming**: PascalCase for classes/types, camelCase for functions/variables
- **Types**: Explicit parameter & return types
- **Classes**: Private members with private keyword
- **Error handling**: Descriptive constant error messages
- **Testing**: Node test runner, `describe`/`test` blocks, assert module

Package manager: pnpm (Node.js >=20.0.0)
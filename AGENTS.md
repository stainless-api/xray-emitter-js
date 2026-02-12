## Agent guidelines

### Command reference

- **Tests**: use `pnpm test` to run the test suite.
- **Lint**: use `pnpm lint` to run oxlint and check for TS errors.
- **Format**: use `pnpm format` to auto-format code.

### Running checks

- **Required commands**: `pnpm test`, `pnpm lint`, `pnpm format`.
- **Completion rule**: run all required commands before declaring done, unless told otherwise (or if you didn't touch any TypeScript code/tests), and confirm in the final response that they ran.

### Sandbox/permissions

If your execution environment has a sandbox/permission model, run these commands **unsandboxed** (full permissions) so results match local dev and CI.

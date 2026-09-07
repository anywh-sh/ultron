// Ambient matcher types (toBeInTheDocument etc.) for *.test.tsx under src/.
// The runtime matcher registration lives in tests/setup.ts (vitest.config.ts
// setupFiles), but that file sits outside tsconfig.json's "include", so its
// import alone doesn't extend the ambient types tsc sees while checking
// src/ — this file does, without touching compilerOptions.types (which
// would stop TS from auto-including @types/react et al.).
/// <reference types="@testing-library/jest-dom" />

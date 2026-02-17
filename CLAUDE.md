# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run tests
bun test

# Run a single test file
bun test tests/index.test.ts

# Build the package
bunx pkgroll

# Lint/format with Biome
bunx biome check src/
bunx biome check --write src/

# Type-check (no emit)
bunx tsc --noEmit
```

## Architecture

This is `@gramio/scenes` — a GramIO plugin that implements a finite-step scene/conversation system for Telegram bots.

### Core Concepts

**Scene** (`src/scene.ts`): A chainable class representing a multi-step conversation flow. Scenes are built via:
- `.params<T>()` / `.state<T>()` — declare typed params (passed at enter) and state (accumulated across steps)
- `.step(updateName, handler)` — add a step that only runs when the user is on that step index
- `.ask(key, validator, message)` — convenience shorthand for a step that validates input via a Standard Schema validator and stores the result into state
- `.on(updateName, handler)` / `.use(handler)` — low-level middleware (delegates to an internal `Composer`)
- `.extend(plugin)` — pick up types from a GramIO plugin (type-only currently)

**Storage** (`@gramio/storage`): Scene state is persisted per-user under the key `@gramio/scenes:{userId}` as `ScenesStorageData` containing `{ name, params, state, stepId, previousStepId, firstTime }`.

**Plugin entrypoints** (`src/index.ts`):
- `scenes(scenes[], options?)` — the standard GramIO plugin. Registers an `.on(...)` handler that intercepts all updates for users currently in a scene and runs the matching scene's composed middleware. Also adds a `.derive(["message", "callback_query"], ...)` that exposes `context.scene` with `enter`/`exit`.
- `scenesDerives(scenesOrOptions, options?)` — alternative plugin that exposes `context.scene` (including `current`) on a wider set of update types via derive, without a built-in interception handler. Useful when you need scene context in handlers registered independently.

**Utility helpers** (`src/utils.ts`): Internal functions that produce the `context.scene` object:
- `getSceneHandlers` — returns `EnterExit` or `PossibleInUnknownScene` depending on `withCurrentScene`
- `getInActiveSceneHandler` — builds the full `scene` object (state, params, step, update, enter, exit, reenter) available inside a running scene
- `getStepDerives` — produces `scene.step` with `go`, `next`, `previous`, navigation
- `validateScenes` — throws on duplicate scene names

**Types** (`src/types.ts`): Core interfaces including `ScenesStorageData`, `InActiveSceneHandlerReturn`, `PossibleInUnknownScene`, `SceneStepReturn`, `EnterExit`.

### Type System Pattern

The `Scene` class uses generic accumulation: `step()` infers the return type of each handler and accumulates `UpdateData<T>` into the `State` generic. `Modify<Base, Mod>` (from `types.ts`) is used throughout to merge and override nested generic types while preserving unmodified keys.

### Step Execution Flow

1. User sends a message → `scenes` plugin `.on(...)` handler fires
2. Storage is checked for active scene data by `userId`
3. If found, `context.scene` is set to the active handler object and `scene.run()` is called
4. `scene.run()` calls `scene.compose()` which runs the internal `Composer` middleware chain
5. Each `.step()` handler checks `context.scene.step.id === stepId` before executing
6. Handlers call `context.scene.update(state)` to advance the step and persist state, or `context.scene.exit()` to leave the scene

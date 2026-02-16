# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

@gramio/scenes is a plugin for GramIO (Telegram bot framework) that implements conversation scenes with step-based navigation and state management. The plugin enables building complex multi-step dialogs with type-safe state and params.

## Development Commands

### Building
```bash
bunx pkgroll              # Build the project (outputs to dist/)
```

### Type Checking
```bash
tsc --noEmit              # Type check without emitting files
```

### Linting
```bash
bun biome check           # Check code with Biome linter
bun biome check --write   # Auto-fix linting issues
```

### Testing
```bash
bun test                  # Run tests with Bun test runner
```

### Publishing
The project publishes to both NPM and JSR (Deno registry). Publishing is done via GitHub Actions workflow (`.github/workflows/publish.yml`), not locally.

## Architecture

### Core Components

#### Scene Class (`src/scene.ts`)
The Scene class provides a builder pattern for defining conversation flows:
- **Builder methods**: `.params<T>()`, `.state<T>()`, `.extend()` - Set up type constraints
- **Handler methods**: `.on()`, `.use()`, `.step()` - Register update handlers
- **Special methods**: `.onEnter()`, `.ask()` - Scene lifecycle and validation helpers
- **Step system**: Each scene has numbered steps (0, 1, 2...) that execute in sequence
- **Internal structure**: Uses `this['~']` to store internal data (params, state, composer, enter handler)

#### Plugin Functions (`src/index.ts`)
Two main exports:
- **`scenes(scenes, options?)`**: Main plugin that handles scene routing and middleware
  - Listens for updates and routes to active scenes based on storage
  - Injects `context.scene` with enter/exit methods
  - Manages scene lifecycle (enter, step navigation, exit)

- **`scenesDerives(scenes, options)`**: Derives-only version for cross-plugin usage
  - Provides `context.scene` in derived context
  - Use when you need scene methods in other plugins without middleware
  - Set `withCurrentScene: true` to access `context.scene.current` in non-scene handlers

#### Storage and State (`src/utils.ts`, `src/types.ts`)
- **Storage key pattern**: `@gramio/scenes:${userId}`
- **ScenesStorageData structure**:
  ```typescript
  {
    name: string           // Scene name
    params: any            // Immutable scene parameters
    state: any             // Mutable scene state
    stepId: number         // Current step index
    previousStepId: number // Previous step index
    firstTime: boolean     // Whether this is first time at this step
  }
  ```

- **Scene handlers** (`getInActiveSceneHandler`, `getSceneEnter`, etc.):
  - `context.scene.enter(scene, params?)` - Enter a new scene
  - `context.scene.exit()` - Exit current scene (deletes storage)
  - `context.scene.reenter()` - Re-enter current scene with same params
  - `context.scene.update(state, options?)` - Update state and optionally advance step
  - `context.scene.step.next()` - Go to next step
  - `context.scene.step.previous()` - Go to previous step
  - `context.scene.step.go(id, firstTime?)` - Go to specific step

#### Step Execution Flow
1. Plugin middleware checks storage for active scene
2. If scene exists, finds matching Scene instance and calls `scene.run()`
3. `scene.run()` invokes `scene.compose()` which runs the internal composer
4. Composer executes matching step handlers based on `context.scene.step.id`
5. Step handlers typically check `firstTime` flag and either send prompt or process input
6. Handlers call `context.scene.update()` to save state and advance to next step

### Type System Patterns

The codebase uses advanced TypeScript patterns:
- **Conditional types**: Scene types change based on builder method calls
- **Type modification**: `Modify<Base, Mod>` utility for precise type updates
- **Type inference**: `.step()` return types infer state from `UpdateData<T>`
- **Standard Schema**: Integration via `@standard-schema/spec` for validation

## Important Implementation Details

### Scene Registration
All scenes must be registered in the `scenes()` plugin options. Attempting to enter an unregistered scene throws an error with a helpful message.

### Step Handler Matching
Step handlers only execute when:
1. The update type matches (e.g., `"message"`)
2. `context.scene.step.id === stepId` (exact match)
3. Or `context.scene.step.id > stepId` (for next() propagation)

### First Time Flag
The `firstTime` flag indicates the first visit to a step. Common pattern:
```typescript
.step("message", (context) => {
  if (context.scene.step.firstTime) return context.send("Enter your name:");
  // Process input
  return context.scene.update({ name: context.text });
})
```

### Storage Synchronization
Scene state lives in two places during execution:
1. In-memory `sceneData` object (passed to handlers)
2. External storage (persisted via `storage.set()`)

The `.update()` method synchronizes both. After step execution, `scene.run()` ensures `firstTime` is set to `false` in storage.

### Async Enter Hook
The `.onEnter()` hook executes during `scene.enter()` after the scene is initialized but before `firstTime` is set to `false`. This allows initialization logic to run on scene entry.

## Code Style

- Use Biome for linting (configured in `biome.json`)
- Non-null assertions allowed (`noNonNullAssertion: off`)
- Parameter reassignment allowed (`noParameterAssign: off`)
- Banned types allowed for flexibility (`noBannedTypes: off`)
- TypeScript strict mode enabled

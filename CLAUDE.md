# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@gramio/scenes` is a plugin for GramIO (Telegram bot framework) that implements conversation scenes. As of the current redesign, **`Scene` extends `EventComposer`** — every Scene instance has the full bot-level DSL (`.command`, `.callbackQuery`, `.hears`, `.on`, `.use`, `.derive`, `.guard`, `.branch`, …), and each step is itself a sub-composer with lifecycle hooks plus the same DSL.

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
bun test                  # Run all tests with Bun test runner
bun test tests/builder-smoke.test.ts   # Run a specific file
bun test -t "guard"                    # Run by test-name filter
```

### Publishing
The project publishes to both NPM and JSR (Deno registry). Publishing is done via GitHub Actions workflow (`.github/workflows/publish.yml`), not locally.

## Architecture

### Module map

```
src/
├── scene.ts             ← Scene class. Extends SceneComposerBase.
├── scene-composer.ts    ← createComposer() instance with gramio _composerMethods table → SceneComposerBase.
├── step-composer.ts     ← createComposer() instance with gramio methods + step lifecycle (.enter/.exit/.fallback/.message/.events/.updates).
├── scene-internals.ts   ← Shared types: SceneStepEntry, SceneInternals, SceneLifecycleHandler.
├── types.ts             ← Public types: ScenesStorageData, EnterExit, InActiveSceneHandlerReturn, ParentSceneFrame.
├── utils.ts             ← Runtime: getSceneEnter / getSceneExit / getSceneEnterSub / getSceneExitSub, getStepDerives, validateScenes, events list.
└── index.ts             ← Plugin entry: scenes() and scenesDerives() functions.
```

### `Scene` class (`src/scene.ts`)

`Scene<Params, Errors, State, Derives>` extends `SceneComposerBase` (a `createComposer`-produced class seeded with the gramio `_composerMethods` table). Inheritance gives it the full Composer + gramio surface "for free":

- Inherited from base Composer: `.use`, `.derive`, `.decorate`, `.guard`, `.branch`, `.route`, `.fork`, `.tap`, `.lazy`, `.group`, `.extend`, `.when`, `.as`, `.onError`, `.error`, `.macro`.
- Inherited from gramio methods: `.command`, `.callbackQuery`, `.hears`, `.reaction`, `.inlineQuery`, `.chosenInlineResult`, `.startParameter`.

Scene-specific additions:
- `.params<T>() / .state<T>() / .exitData<T>()` — type-only chain methods, return re-typed Scene<...>.
- `.onEnter(handler)` — fires once on scene entry (after derive/decorate).
- `.onExit(handler)` — fires when leaving the scene (exit / exitSub / reenter).
- `.step(...)` — registers a step (3 overload paths: see below).
- `.ask(key, schema, prompt, opts?)` — sugar over a legacy event-filtered step.
- `.extend(...)` — overrides parent to (a) preserve `Scene<...>` return type and (b) merge step lists when the argument is another Scene.

### Two parallel slots: `~` and `~scene`

- `this["~"]` — composer's own slot (middlewares, name, errors, macros, extended set). Inherited from base Composer.
- `this["~scene"]` — Scene-specific data: `steps[]`, `stepsCount`, `enter` (onEnter), `exit` (onExit), `isModule`, plus type-only carriers for params/state/exitData.

The slots are independent so the composer pkg doesn't need augmentation.

### Step API: three overload paths

```typescript
// Builder, numeric (autoincrement)
scene.step((c) => c.enter(...).on("message", ...))

// Builder, named
scene.step("intro", (c) => c.enter(...).on("message", ...))

// Legacy event-filtered (back-compat)
scene.step("message", (ctx, next) => {...})
scene.step(["message", "callback_query"], (ctx) => {...})
```

**Disambiguation** at runtime (`scene.ts` `step(...)` impl):
- 1 arg, function → builder, numeric id (autoincrement via `this.stepsCount++`).
- 2 args, first is array → legacy event-filtered.
- 2 args, first is string IN the `events` list (`utils.ts:events`) → legacy event-filtered (back-compat).
- 2 args, first is any other string → named builder step.

`_registerBuilderStep` creates a fresh `StepComposer`, runs the builder against it, and pushes a `SceneStepEntry` to `~scene.steps`.

`_registerLegacyEventStep` adds a gated `.use()` middleware to `this["~"].middlewares` that checks `context.scene.step.id === stepId` and `context.is(updateName)`.

### `StepComposer` (`src/step-composer.ts`)

Built via `createComposer` with a methods table merged from `_composerMethods` and `stepLifecycleMethods`. Lifecycle methods store data on the StepComposer's `~step` slot (separate from `~`):

- `.enter(handler)`, `.exit(handler)`, `.fallback(handler)`, `.message(text|fn)`, `.events([...])`, `.updates<T>()`.

`buildStepEntry(id, composer)` is exported to translate a configured StepComposer into a `SceneStepEntry`.

### Runtime dispatch (`scene.dispatchActive`)

The plugin (`index.ts`) calls `scene.dispatchActive(ctx, storage, key, data, passthrough?)` once it has the storage data for the active scene.

Three execution paths:

1. **Builder step + firstTime**:
   - Run setup chain (filter `~.middlewares` + step composer's `~.middlewares` for `derive` / `decorate` / `guard` types). Run via `compose(setupFns)(ctx, () => proceed=true)`.
   - If `!proceed` (a guard stopped the chain) → return without flipping firstTime.
   - If `!data.entered` and scene has `~scene.enter` → call onEnter (visible derives ✓).
   - Run step's `.message` (if defined) and `.enter` (if defined).
   - Persist `{...data, firstTime: false, entered: true}`.

2. **No builder step found (legacy mode)**:
   - If `!data.entered` and scene has `~scene.enter` → run scene's `derive`/`decorate` middleware then onEnter.
   - Call inherited `dispatch(ctx, onNext, passthrough)` to run the full composer chain (legacy gated steps fire here).
   - In `onNext`, persist `firstTime: false, entered: true`.

3. **Builder step, subsequent update (firstTime=false)**:
   - Build combined chain: scene-level middlewares (with cross-bot dedup filter) → wrapper that runs step composer's middleware.
   - If step chain takes ownership (a handler matched, no `next()`) → done.
   - Else if `~step.fallback` exists → fire it; consume the update.
   - Else → call terminal (passthrough to outer bot chain).

### `entered` flag

Storage carries a `entered: boolean` flag distinguishing "scene first entry" (fire onEnter) from "step.go() with firstTime=true" (don't re-fire). Set false in `getSceneEnter` / `getSceneEnterSub`, flipped true after dispatchActive runs onEnter.

Existing storage data without the field treats it as falsy — correct default for legacy data because they have firstTime=false, so the gate naturally skips re-fire.

### Step navigation (`getStepDerives` in `utils.ts`)

`step.next()` / `step.previous()`:
- If `~scene.steps` is non-empty (builder mode) → walk the array by index. Throws when no next/previous exists.
- Else (legacy numeric-only) → `stepId ± 1`.

`step.go(idOrName)` accepts `string | number`.

### `scene.extend(otherScene)` — step merge

Override of the inherited `extend()`:
1. Calls `super.extend(other)` for composer-level merge (middlewares, derives, plugins tracked, errors, macros).
2. Detects Scene by checking `"~scene" in other`. Non-Scene paths skip step merge.
3. For each entry in `other["~scene"].steps`:
   - Numeric id → renumber to next available `this.stepsCount++`.
   - String id → throw on collision; else append.
4. Copy `~scene.enter` / `~scene.exit` only if target has none (A wins).

### Step modules (unnamed Scene)

`new Scene()` (no name) → `~scene.isModule = true`. `validateScenes` throws if a module is registered in `scenes([...])`. The intended use is `.extend(module)` — module's steps and middleware merge into named scenes.

### Storage shape (`types.ts`)

```typescript
interface ScenesStorageData<Params=any, State=any> {
    name: string;
    params: Params;
    state: State;
    stepId: string | number;
    previousStepId: string | number;
    firstTime: boolean;
    entered?: boolean;                   // true once scene.onEnter has fired
    parentStack?: ParentSceneFrame[];    // sub-scene stack
}
```

Storage key format: `@gramio/scenes:<userId>`.

## Type System Patterns

- **Modify\<Base, Mod>** utility (in `types.ts`) — `Omit<Base, keyof Mod> & Mod`. Used by `params/state/exitData/step/ask/extend` chain methods to surgically replace one slot of the `Derives` type while preserving the rest.
- **State inference**: legacy `.step(updateName, handler)` extracts `UpdateData<T>` from the handler's return type. Builder steps use the explicit `c.updates<T>()` carrier; auto-inference through builder return types is a future improvement.
- **`Derives` generic**: tracks `{ global: { scene: ... }, message: {...}, callback_query: {...}, ... }`. `.extend(plugin)` and `.extend(composer)` merge plugin/composer derives into this slot.

## Important Implementation Details

### Cross-bot dedup

When a named plugin/composer is extended into both the bot AND a scene, scene's `dispatchActive` filters out middleware whose `plugin` field matches a bot-level `extended` entry (subsequent-update branch). Without this, derives would fire twice per update.

### `.derive()` visibility in `.onEnter`

`.onEnter` fires AFTER scene-level `derive`/`decorate` middleware applies, so derived ctx fields are visible. This is true for both builder mode (setup chain runs first inside dispatchActive) and legacy mode (a wrapper runs derives ahead of the inherited dispatch chain).

### Passthrough semantics

By default `passthrough: true` — updates not handled by the active step fall through to the outer bot chain. This lets bot-level `.command("cancel")` and `.on("message")` work even while a user is in a scene. Inside dispatchActive, the terminal is the bot's outer `next()`. When the step chain falls through and there's no `.fallback`, terminal fires.

### Naming: `dispatch` / `dispatchActive` (renamed from `compose` / `run`)

Scene's runtime entry points were renamed to avoid collision with the inherited `Composer.compose()` and `Composer.run(ctx, next?)` methods (which have completely different signatures). Internal callers (`utils.ts`, `index.ts`) use `dispatch` / `dispatchActive`. Composer's own `compose()` / `run(ctx)` methods are still available unchanged for callers that want middleware-runner semantics.

## Common Patterns When Editing

- **Adding a new step lifecycle hook**: add a `defineComposerMethods` entry in `step-composer.ts`'s `stepLifecycleMethods`, expose it on `StepInternals`, surface it in `buildStepEntry`, and call it from the appropriate place in `dispatchActive`. ~30 lines total.
- **Adding scene-level method**: add as a regular instance method on `Scene` class. Type return as `Scene<...new generics...>` using the `Modify<>` pattern when needed.
- **Modifying dispatch flow**: there are 3 paths in `dispatchActive`. Changes to one path usually need parallel changes to the others. The setup-types whitelist (`derive`/`decorate`/`guard`) defines what runs on first entry vs later.
- **Storage migration**: `ScenesStorageData` is exported and persisted. Adding optional fields is back-compat. Removing or renaming required fields is a breaking change for users with persistent storage (Redis etc.).

## Code Style

- Biome for linting (`biome.json`)
- Non-null assertions allowed (`noNonNullAssertion: off`)
- Parameter reassignment allowed (`noParameterAssign: off`)
- Banned types allowed for flexibility (`noBannedTypes: off`)
- TypeScript strict mode enabled

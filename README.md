# @gramio/scenes

<div align="center">

[![npm](https://img.shields.io/npm/v/@gramio/scenes?logo=npm&style=flat&labelColor=000&color=3b82f6)](https://www.npmjs.org/package/@gramio/scenes)
[![npm downloads](https://img.shields.io/npm/dw/@gramio/scenes?logo=npm&style=flat&labelColor=000&color=3b82f6)](https://www.npmjs.org/package/@gramio/scenes)
[![JSR](https://jsr.io/badges/@gramio/scenes)](https://jsr.io/@gramio/scenes)
[![JSR Score](https://jsr.io/badges/@gramio/scenes/score)](https://jsr.io/@gramio/scenes)

</div>

Step-based conversation scenes for [GramIO](https://gramio.dev). Build multi-step dialogs with type-safe state, params, validation, and reusable sub-scenes.

## Installation

```bash
npm install @gramio/scenes
# or
bun add @gramio/scenes
```

## Quick start

```typescript
import { Bot } from "gramio";
import { Scene, scenes } from "@gramio/scenes";

const greetingScene = new Scene("greeting")
    .step("message", async (ctx) => {
        if (ctx.scene.step.firstTime) return ctx.send("What is your name?");
        return ctx.scene.update({ name: ctx.text });
    })
    .step("message", async (ctx) => {
        if (ctx.scene.step.firstTime) return ctx.send("How old are you?");
        const age = Number(ctx.text);
        return ctx.scene.update({ age });
    })
    .step("message", async (ctx) => {
        if (ctx.scene.step.firstTime)
            return ctx.send(`Hello, ${ctx.scene.state.name}! You are ${ctx.scene.state.age}.`);
    });

const bot = new Bot(process.env.BOT_TOKEN!)
    .extend(scenes([greetingScene]))
    .command("start", (ctx) => ctx.scene.enter(greetingScene));

bot.start();
```

---

## Core concepts

### Scene

A `Scene` is a named sequence of step handlers. Each step handles one user interaction.

```typescript
const scene = new Scene("my-scene")
    .step("message", async (ctx, next) => {
        // runs when an incoming message matches step index
    });
```

### The step handler contract

Every step handler receives `(ctx, next)` where `ctx.scene` exposes the scene API.

The `firstTime` flag drives the two-phase pattern every step follows:

```typescript
.step("message", async (ctx) => {
    if (ctx.scene.step.firstTime) {
        // Phase 1: first visit → send a prompt and wait
        return ctx.send("Enter your email:");
    }
    // Phase 2: user replied → process input and advance
    return ctx.scene.update({ email: ctx.text });
})
```

`firstTime` is `true` only on the very first visit to a step. After the step handler runs, the plugin sets it to `false` in storage so the next incoming message sees `firstTime = false`.

---

## Scene builder API

### `.params<T>()`

Declares the type of immutable parameters passed at scene entry. Purely a TypeScript hint — no runtime effect.

```typescript
const scene = new Scene("checkout")
    .params<{ productId: number }>()
    .step("message", (ctx) => {
        ctx.scene.params.productId; // number
    });
```

### `.state<T>()`

Declares the initial shape of mutable scene state.

```typescript
const scene = new Scene("register")
    .state<{ name: string; email: string }>()
    .step("message", (ctx) => {
        ctx.scene.state.name; // string
    });
```

### `.onEnter(handler)`

Runs once when the scene is entered, before the first step executes. Useful for sending a welcome message or initialising state.

```typescript
const scene = new Scene("quiz")
    .onEnter(async (ctx) => {
        await ctx.send("Welcome to the quiz! Let's begin.");
    })
    .step("message", (ctx) => { /* step 0 */ });
```

### `.step(updateName, handler)`

Registers a handler that runs when `ctx.scene.step.id` matches the step's index. Supports all GramIO update types as first argument (e.g. `"message"`, `"callback_query"`, or an array).

```typescript
.step(["message", "callback_query"], async (ctx) => {
    if (ctx.scene.step.firstTime) return ctx.send("Choose:", keyboard);
    const choice = ctx.is("callback_query") ? ctx.data : ctx.text;
    return ctx.scene.update({ choice });
})
```

### `.ask(key, validator, prompt, options?)`

Shorthand for a validated input step. Sends `prompt` on first visit, validates the input with a [Standard Schema](https://standardschema.dev/) validator on subsequent visits, stores the result under `key` in state, and advances automatically.

```typescript
import { z } from "zod";

const scene = new Scene("profile")
    .ask("name", z.string().min(2), "Enter your name (≥ 2 chars):")
    .ask("age", z.coerce.number().int().min(0), "Enter your age:", {
        onInvalidInput: (issues) => `Invalid: ${issues[0].message}`,
    })
    .step("message", (ctx) => {
        if (ctx.scene.step.firstTime)
            return ctx.send(`Saved: ${ctx.scene.state.name}, ${ctx.scene.state.age}`);
    });
```

### `.extend(pluginOrComposer)`

Injects a GramIO plugin or `EventComposer` into the scene's middleware chain, making its derives available inside step handlers.

---

## Context API inside scenes

`ctx.scene` is available in every step handler.

### `ctx.scene.state`

The current mutable state object. Updated via `ctx.scene.update()`.

### `ctx.scene.params`

The immutable parameters passed at `ctx.scene.enter(scene, params)`.

### `ctx.scene.step`

| Property / method | Description |
|---|---|
| `step.id` | Current step index (0-based) |
| `step.previousId` | Previous step index |
| `step.firstTime` | `true` on the first visit to this step |
| `step.next()` | Advance to `step.id + 1` immediately |
| `step.previous()` | Go back to `step.id - 1` immediately |
| `step.go(n, firstTime?)` | Jump to step `n` (default `firstTime = true`) |

### `ctx.scene.update(state, options?)`

Merges `state` into `ctx.scene.state` (shallow assign) and advances to the next step by default.

```typescript
// advance to next step (default)
await ctx.scene.update({ name: ctx.text });

// jump to a specific step
await ctx.scene.update({ name: ctx.text }, { step: 3 });

// update state without changing step
await ctx.scene.update({ name: ctx.text }, { step: undefined });

// advance but mark the target step as not firstTime
await ctx.scene.update({}, { step: 2, firstTime: false });
```

### `ctx.scene.enter(scene, params?)`

Enter a different scene, replacing the current one. The current scene is discarded.

```typescript
await ctx.scene.enter(anotherScene, { userId: 42 });
```

### `ctx.scene.exit()`

Exit the current scene. Clears storage. The next message will not be routed to any scene.

### `ctx.scene.reenter()`

Restart the current scene from step 0, resetting state, while keeping the original params.

---

## Sub-scenes (`enterSub` / `exitSub`)

Sub-scenes let scene A **pause**, delegate to scene B, and **resume** exactly where it left off once B finishes. The parent's state is preserved; the child can merge additional data back into it on exit.

### How it works

1. Parent calls `ctx.scene.enterSub(subScene)` from a step — this saves the current step and state onto an internal stack and runs the sub-scene from scratch.
2. The sub-scene runs through its own steps normally.
3. When the sub-scene is done, it calls `ctx.scene.exitSub(returnData?)` — this pops the parent frame off the stack, optionally merges `returnData` into the parent state, and **re-runs the parent's paused step with `firstTime = false`**.

```typescript
const phoneVerification = new Scene("phone-verify")
    .step("message", async (ctx) => {
        if (ctx.scene.step.firstTime) return ctx.send("Enter the SMS code:");
        if (ctx.text !== "1234") return ctx.send("Wrong code, try again:");
        // done — return to parent, inject the verified phone
        return ctx.scene.exitSub({ phone: "+7 999 123-45-67" });
    });

const registration = new Scene("registration")
    .step("message", async (ctx) => {
        if (ctx.scene.step.firstTime) return ctx.send("Enter your name:");
        return ctx.scene.update({ name: ctx.text });
    })
    .step("message", async (ctx) => {
        if (ctx.scene.step.firstTime)
            // pause registration and run phone verification
            return ctx.scene.enterSub(phoneVerification);

        // firstTime = false here means we just returned from the sub-scene
        // ctx.scene.state now contains both { name } and { phone }
        return ctx.send(`Done! ${ctx.scene.state.name} / ${ctx.scene.state.phone}`);
    });

const bot = new Bot(process.env.BOT_TOKEN!)
    .extend(scenes([registration, phoneVerification]))
    .command("start", (ctx) => ctx.scene.enter(registration));
```

### Step resume semantics

`enterSub` saves the **same** `stepId` that called it. When `exitSub` restores the parent:
- `step.id` is the same step that launched the sub-scene
- `step.firstTime` is `false`
- The handler runs its "input processing" branch immediately

### Merging state

`exitSub(returnData?)` performs a **shallow merge** of `returnData` on top of the saved parent state:

```typescript
// parent state before sub: { name: "Alice" }
// sub calls:
await ctx.scene.exitSub({ phone: "+7999" });
// parent state on resume: { name: "Alice", phone: "+7999" }
```

If `returnData` is omitted, the parent state is restored as-is.

### N-level nesting

Sub-scenes can themselves call `enterSub`, creating an arbitrarily deep stack. Each `exitSub` unwinds exactly one level:

```
registration  ──enterSub──►  phone-verify  ──enterSub──►  captcha
                                                                │
                             ◄──exitSub──────────────────────  │
◄──exitSub────────────────                                    exitSub
```

```typescript
const captcha = new Scene("captcha")
    .step("message", async (ctx) => {
        if (ctx.scene.step.firstTime) return ctx.send("Solve: 2 + 2 = ?");
        if (ctx.text !== "4") return ctx.send("Wrong!");
        return ctx.scene.exitSub({ captchaPassed: true });
    });

const phoneVerify = new Scene("phone-verify")
    .step("message", async (ctx) => {
        if (ctx.scene.step.firstTime)
            return ctx.scene.enterSub(captcha); // go one level deeper
        // resumed from captcha
        if (!ctx.scene.state.captchaPassed) return ctx.scene.exit();
        return ctx.scene.exitSub({ phone: "+7999" });
    });
```

### `exitSub` without a parent

If `exitSub` is called on a scene that was entered normally (not via `enterSub`), it behaves exactly like `exit()` — the scene is cleared and the next message hits non-scene handlers.

---

## Plugin registration

All scenes (parents and sub-scenes) must be registered together in `scenes([...])`:

```typescript
bot.extend(scenes([registration, phoneVerification, captcha]));
```

Trying to `enter` or `enterSub` a scene not in the list throws an error with the scene name.

### Update passthrough

By default, when a user is inside a scene and sends an update that the current step does not handle — a text message while the step is waiting for a `callback_query`, or a global `/cancel` while inside a form — that update **falls through** to the outer bot chain. Global commands and `.on()` handlers keep working during a scene:

```typescript
const form = new Scene("form")
    .step("message", (ctx) => {
        if (ctx.scene.step.firstTime) return ctx.send("Enter your name:");
        return ctx.scene.update({ name: ctx.text });
    })
    .step("callback_query", (ctx) => {
        if (ctx.scene.step.firstTime)
            return ctx.send("Pick size:", { reply_markup: sizeKb });
        return ctx.scene.update({ size: ctx.data });
    });

bot
    .extend(scenes([form]))
    .command("cancel", (ctx) => ctx.scene.exit())    // works even inside the scene
    .command("help", (ctx) => ctx.send("Help text")) // works even inside the scene
    .on("message", (ctx) => ctx.send("Please use the buttons above"));
    //          ^ fires when a user types text during the callback_query step
```

When a fallthrough happens, the scene's `firstTime` flag is **preserved** — the user does not lose their place in the current step, they just didn't "answer" it yet.

Set `passthrough: false` to restore the legacy "greedy" behavior, where the scene consumes every update for the active user regardless of step match. Useful when you deliberately want to isolate a user inside the scene:

```typescript
bot.extend(scenes([form], { passthrough: false }));
// Now /cancel, /help, and the .on("message") handler above
// will NOT fire while the user is inside `form`.
```

### Options

```typescript
bot.extend(
    scenes([registration], {
        storage: redisStorage({ /* ... */ }),
        passthrough: true, // default
    }),
);
```

| Option        | Type        | Default             | Description                                                                                        |
| ------------- | ----------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| `storage`     | `Storage`   | `inMemoryStorage()` | Where scene state is persisted. See [Custom storage](#custom-storage).                             |
| `passthrough` | `boolean`   | `true`              | Whether updates that do not match the current step fall through to outer handlers. See above.     |

---

## `scenesDerives`

Use `scenesDerives` when you need `ctx.scene.enter` in a plugin that runs **before** the main scene middleware (e.g. a session plugin that auto-enters a scene):

```typescript
import { scenesDerives } from "@gramio/scenes";
import { inMemoryStorage } from "@gramio/storage";

const storage = inMemoryStorage();

// Shared derive — provides ctx.scene.enter everywhere
const sceneDerives = scenesDerives([myScene], { storage });

// Main scene router — must use the same storage
const scenePlugin = scenes([myScene], { storage });

bot.extend(sceneDerives).extend(scenePlugin);
```

To access `ctx.scene.current` outside of active scene handlers, pass `withCurrentScene: true`:

```typescript
const sceneDerives = scenesDerives(
    { scenes: [myScene], storage, withCurrentScene: true }
);

bot.extend(sceneDerives).on("message", async (ctx) => {
    if (ctx.scene.current?.is(myScene)) {
        // ctx.scene.current.state is typed to myScene's state
    }
});
```

---

## Custom storage

By default scenes use in-memory storage (lost on restart). Pass any `@gramio/storage`-compatible adapter:

```typescript
import { redisStorage } from "@gramio/storage-redis";

bot.extend(scenes([myScene], {
    storage: redisStorage({ host: "localhost", port: 6379 }),
}));
```

---

## Storage data shape

```typescript
interface ScenesStorageData {
    name: string;           // scene name
    params: unknown;        // immutable params passed at enter()
    state: unknown;         // mutable state updated via update()
    stepId: number;         // current step index
    previousStepId: number; // previous step index
    firstTime: boolean;     // true on first visit to current step
    parentStack?: ParentSceneFrame[]; // set by enterSub()
}

interface ParentSceneFrame {
    name: string;
    params: unknown;
    state: unknown;
    stepId: number;
    previousStepId: number;
    parentStack?: ParentSceneFrame[]; // for N-level nesting
}
```

Storage key format: `@gramio/scenes:<userId>`.

---

## Full API reference

See the [official plugin documentation](https://gramio.dev/plugins/official/scenes).

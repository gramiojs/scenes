# @gramio/scenes

<div align="center">

[![npm](https://img.shields.io/npm/v/@gramio/scenes?logo=npm&style=flat&labelColor=000&color=3b82f6)](https://www.npmjs.org/package/@gramio/scenes)
[![npm downloads](https://img.shields.io/npm/dw/@gramio/scenes?logo=npm&style=flat&labelColor=000&color=3b82f6)](https://www.npmjs.org/package/@gramio/scenes)
[![JSR](https://jsr.io/badges/@gramio/scenes)](https://jsr.io/@gramio/scenes)
[![JSR Score](https://jsr.io/badges/@gramio/scenes/score)](https://jsr.io/@gramio/scenes)

</div>

Step-based conversation scenes for [GramIO](https://gramio.dev). Each `Scene` **is an `EventComposer`** — every step is a sub-composer with its own lifecycle hooks plus the full bot DSL (`.command`, `.callbackQuery`, `.hears`, `.on`, `.use`, `.derive`, `.guard`, `.branch`, …). Scenes compose into one another, so reusable step modules are first-class.

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

const greeting = new Scene("greeting")
    .step("intro", (c) => c
        .enter((ctx) => ctx.send("Hi! What's your name?"))
        .on("message", (ctx) => ctx.scene.update({ name: ctx.text! })),
    )
    .step("age", (c) => c
        .enter((ctx) => ctx.send(`Nice, ${ctx.scene.state.name}! How old are you?`))
        .on("message", (ctx) => ctx.scene.update({ age: Number(ctx.text) })),
    )
    .step("done", (c) => c
        .enter((ctx) => {
            ctx.send(`${ctx.scene.state.name}, ${ctx.scene.state.age}. 👋`);
            return ctx.scene.exit();
        }),
    );

const bot = new Bot(process.env.BOT_TOKEN!)
    .extend(scenes([greeting]))
    .command("start", (ctx) => ctx.scene.enter(greeting));

bot.start();
```

Each `.step(name, c => c…)` call defines a step whose body is a **sub-composer**. Inside the builder you have:

- **Lifecycle hooks** — `.enter` (runs once on first visit), `.exit` (runs when leaving), `.message` (sugar over `.enter(ctx => ctx.send(text))`), `.fallback` (catch-all when nothing else matched), `.events([...])` (narrow accepted events), `.updates<T>()` (type-only state-shape declaration)
- **Full GramIO DSL** — `.on`, `.command`, `.callbackQuery`, `.hears`, `.use`, `.derive`, `.guard`, `.branch`, `.when`, `.macro`, `.extend`, …

---

## Core concepts

### Scene IS an EventComposer

Every method you can call on a `Bot` works on a `Scene` too — including all gramio sugars (`.command`, `.callbackQuery`, `.hears`, `.derive`, `.guard`, …). Handlers registered directly on the scene act as **scene-global** middleware that runs on every update while the user is inside the scene:

```typescript
const checkout = new Scene("checkout")
    .derive(async (ctx) => ({ user: await db.users.find(ctx.from!.id) }))
    .guard((ctx) => ctx.user?.role === "customer")
    .command("cancel", (ctx) => ctx.scene.exit())     // global escape from any step
    .step("review", (c) => c
        .message((ctx) => `Order looks good, ${ctx.user.name}?`)
        .on("message", (ctx) => ctx.scene.update({ ack: true })),
    )
    .step("complete", (c) => c
        .enter((ctx) => ctx.send("Done! 🎉")),
    );
```

### Step builder

```typescript
new Scene("greet").step("intro", (c) => c
    .events(["message", "callback_query"])     // optional — defaults to message+callback_query
    .enter((ctx) => ctx.send("Hi!"))            // runs once on firstTime
    .command("skip", (ctx) => ctx.scene.step.next())
    .callbackQuery("back", (ctx) => ctx.scene.step.previous())
    .on("message", (ctx) => ctx.scene.update({ name: ctx.text! }))
    .fallback((ctx) => ctx.send("I didn't understand that"))
    .exit((ctx) => analytics.track("intro_completed")),
);
```

| Method                 | When it fires                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `.enter(handler)`      | Once on the first visit to this step (replaces the legacy `if (firstTime)` check).   |
| `.message(text\|fn)`   | Sugar over `.enter(ctx => ctx.send(text))`. Factory form receives ctx.               |
| `.exit(handler)`       | When the user leaves this step (`step.next/previous/go`, scene `exit`, `reenter`).   |
| `.fallback(handler)`   | When no other handler in the step claimed the update.                                |
| `.events([...])`       | Narrow which event types this step accepts (default: `message` + `callback_query`).  |
| `.updates<T>()`        | Type-only — declare what state shape this step contributes.                          |
| `.command(name, fn)`   | Match `/name` while in this step.                                                    |
| `.callbackQuery(t, fn)`| Match a button click (string / RegExp / `CallbackData`).                             |
| `.hears(t, fn)`        | Match by text (string / array / RegExp / predicate).                                 |
| `.on(event, fn)`       | Generic event handler.                                                               |
| `.use/.derive/.guard/...` | Standard composer middleware, scoped to this step.                                |

### Step ids: numeric or named

```typescript
new Scene("flow")
    .step((c) => c.message("step 0"))      // numeric id 0
    .step("review", (c) => c.message("…")) // named id "review"
    .step((c) => c.message("step 2"));     // numeric id 2 (numbering continues)
```

Navigate by either:

```typescript
ctx.scene.step.next();      // → next entry in the list
ctx.scene.step.previous();  // → previous entry
ctx.scene.step.go("review"); // → named jump
ctx.scene.step.go(2);        // → numeric jump
```

`scene.step.id` and `scene.step.previousId` are typed `string | number`.

---

## Reusable step modules — `scene.extend(otherScene)`

A `Scene` without a name is a **step module** — it can't be entered directly, but its steps and middleware merge into any named scene via `.extend()`:

```typescript
// Reusable confirmation block
const confirm = new Scene().step("confirm", (c) => c
    .enter((ctx) => ctx.send("Are you sure?", confirmKeyboard))
    .callbackQuery("yes", (ctx) => ctx.scene.step.next())
    .callbackQuery("no", (ctx) => ctx.scene.exit()),
);

// Reusable contact-info collection
const contact = new Scene()
    .step("phone", (c) => c.message("Phone?").on("message", (ctx) =>
        ctx.scene.update({ phone: ctx.text! })))
    .step("email", (c) => c.message("Email?").on("message", (ctx) =>
        ctx.scene.update({ email: ctx.text! })));

// Compose into multiple full scenes
const checkout = new Scene("checkout")
    .step("review", (c) => c.message("Review?").on("message", (ctx) =>
        ctx.scene.update({ ack: true })))
    .extend(contact)         // inlines phone + email steps
    .extend(confirm)         // inlines confirm step
    .step("complete", (c) => c.message("Done! 🎉"));

const support = new Scene("support")
    .step("describe", (c) => c.message("Describe the issue:").on("message", (ctx) =>
        ctx.scene.update({ issue: ctx.text! })))
    .extend(contact)         // same module, different scene
    .step("submit", (c) => c.message("Ticket created!"));
```

### Merge semantics

When you call `scene.extend(otherScene)`:

- **Composer middleware** (derives, decorates, guards, on-handlers) merges in registration order.
- **Numeric step ids** are **renumbered** — they get the next available number in the target scene.
- **Named step ids** must not collide — the call **throws** if the target already has a step with that name.
- **`onEnter` / `onExit`** — A wins; B's hooks copy only if A has none.
- **`params` / `state` / `exitData`** — type-level intersection.

Plugin and `EventComposer` paths still work — `scene.extend(plugin)` and `scene.extend(composer)` skip step-merge and behave like the parent `Composer.extend`.

### Module enforcement

Trying to register a module directly throws:

```typescript
const m = new Scene().step("x", (c) => c.message("hi"));
bot.extend(scenes([m])); // ❌ "Cannot register an unnamed Scene (step module) directly."
```

---

## Validated input — `.ask(key, schema, prompt)`

Sugar over `.step` for prompt-then-validate-then-store flows. Uses [Standard Schema](https://standardschema.dev/) — works with Zod, Sury, Valibot, etc.

```typescript
import { z } from "zod";

const profile = new Scene("profile")
    .ask("name", z.string().min(2), "Enter your name (≥ 2 chars):")
    .ask("age", z.coerce.number().int().min(0), "Enter your age:", {
        onInvalidInput: (issues) => `❌ ${issues[0].message}\nTry again:`,
    })
    .step("done", (c) => c.enter((ctx) =>
        ctx.send(`Saved: ${ctx.scene.state.name}, ${ctx.scene.state.age}`)));
```

`ctx.scene.state.name` and `ctx.scene.state.age` are inferred and typed automatically.

---

## Scene lifecycle — `onEnter` / `onExit`

```typescript
new Scene("checkout")
    .derive(async (ctx) => ({ user: await db.users.find(ctx.from!.id) }))
    .onEnter((ctx) => analytics.track("checkout_start", { userId: ctx.user.id }))
    .onExit((ctx) => analytics.track("checkout_end"))
    .step("review", (c) => c.message("Order looks good?").on("message", (ctx) =>
        ctx.scene.update({ ack: true })))
    .step("done", (c) => c.message("Done!"));
```

- **`.onEnter(handler)`** — fires once when the user enters the scene. Runs **after** scene-level `.derive()` / `.decorate()` apply, so derived ctx fields (`ctx.user`, `ctx.config`, …) are visible. Does NOT fire on `step.go()` transitions within the same scene.
- **`.onExit(handler)`** — fires once when the user leaves the scene (via `ctx.scene.exit()`, `ctx.scene.exitSub()`, or `ctx.scene.reenter()`), before storage cleanup.

---

## Type-safe state, params, and exit data

```typescript
const checkout = new Scene("checkout")
    .params<{ productId: number }>()
    .state<{ qty: number }>()
    .exitData<{ orderId: string }>()
    .step("review", (c) => c
        .enter((ctx) => {
            ctx.scene.params.productId; // number
            ctx.scene.state.qty;        // number
            return ctx.send("…");
        })
        .on("message", (ctx) => ctx.scene.exitSub({ orderId: "ord_42" })),
    );

await ctx.scene.enter(checkout, { productId: 7 });
```

Step builder return values can also extend state via `c.updates<T>()` (type-only, no-op at runtime):

```typescript
.step("name", (c) => c
    .updates<{ name: string }>()  // declare what this step contributes
    .message("Enter name:")
    .on("message", (ctx) => ctx.scene.update({ name: ctx.text! })))
```

---

## `ctx.scene.update(state, options?)` — auto-advance

```typescript
// most common: merge state and advance to the next step
await ctx.scene.update({ name: ctx.text });

// jump to a specific step (named or numeric)
await ctx.scene.update({ name: ctx.text }, { step: "confirm" });
await ctx.scene.update({}, { step: 5 });

// merge state without changing step
await ctx.scene.update({ name: ctx.text }, {});

// jump but suppress next step's enter hook
await ctx.scene.update({}, { step: "review", firstTime: false });
```

**Default advance behaviour**:
1. If `options.step` is set → jump there.
2. Else, if scene has builder steps → walk the steps array by index (named & numeric).
3. Else (legacy numeric-only mode) → `stepId + 1`.
4. On the last step → just persist state, no transition.

---

## Sub-scenes — `enterSub` / `exitSub`

Sub-scenes pause the parent, run a child scene, then resume the parent at the same step with `firstTime = false`. The child can merge data back into the parent.

```typescript
const phoneVerify = new Scene("phone-verify")
    .exitData<{ phone: string }>()
    .step("ask", (c) => c
        .enter((ctx) => ctx.send("Enter SMS code:"))
        .on("message", (ctx) => {
            if (ctx.text !== "1234") return ctx.send("Wrong code, try again:");
            return ctx.scene.exitSub({ phone: "+7 999 123-45-67" });
        }),
    );

const registration = new Scene("registration")
    .step("name", (c) => c
        .message("Enter your name:")
        .on("message", (ctx) => ctx.scene.update({ name: ctx.text! })))
    .step("verify", (c) => c
        .enter((ctx) => ctx.scene.enterSub(phoneVerify))
        // resumed here after exitSub — state has both `name` and merged `phone`
        .on("message", (ctx) => ctx.send(
            `Done! ${ctx.scene.state.name} / ${ctx.scene.state.phone}`,
        )),
    );

bot
    .extend(scenes([registration, phoneVerify]))
    .command("start", (ctx) => ctx.scene.enter(registration));
```

Sub-scenes nest arbitrarily deep — each `exitSub` unwinds one level. `exitSub` on a scene entered normally (not via `enterSub`) behaves as `exit()`.

---

## `ctx.scene` API reference

### `state`, `params`

The current mutable state and immutable params (set at `enter()`).

### `step.id` / `step.previousId` / `step.firstTime`

Step navigation state. `id` and `previousId` are `string | number`.

### `step.next() / step.previous() / step.go(id, firstTime?)`

Step navigation. `next` / `previous` walk the builder-step array (or numeric arithmetic in legacy-only scenes). `go` accepts both string and number ids.

### `update(state, options?)`

Merge state and (by default) advance to the next step. See above.

### `enter(scene, params?)` / `exit()` / `reenter(params?)`

Scene-level lifecycle.

### `enterSub(scene, params?)` / `exitSub(returnData?)`

Sub-scene lifecycle. `exitData<T>()` types the `returnData` argument.

---

## Plugin registration

```typescript
bot.extend(scenes([registration, phoneVerify, captcha], {
    storage: redisStorage({ host: "localhost", port: 6379 }),
    passthrough: true, // default
}));
```

| Option        | Type      | Default             | Description                                                                                  |
| ------------- | --------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `storage`     | `Storage` | `inMemoryStorage()` | Where scene state is persisted.                                                              |
| `passthrough` | `boolean` | `true`              | If true, updates not handled by the active step fall through to outer `bot.command/.on/...`. |

### Update passthrough

By default, when a user is inside a scene and sends an update the active step doesn't handle, the update **falls through** to the outer bot chain. So scene-level `.command("cancel")`, bot-level `.command("help")`, and `.on("message")` keep working during a scene.

Set `passthrough: false` to make scenes greedy — every update for the active user is consumed by the scene chain regardless of step match.

### `scenesDerives`

Use `scenesDerives` when you need `ctx.scene.enter` (or `ctx.scene.current`) inside a plugin that runs **before** the scenes router:

```typescript
import { scenes, scenesDerives } from "@gramio/scenes";
import { inMemoryStorage } from "@gramio/storage";

const storage = inMemoryStorage();

bot
    .extend(scenesDerives([myScene], { storage, withCurrentScene: true }))
    .on("message", (ctx) => {
        if (ctx.scene.current?.is(myScene)) {
            // ctx.scene.current.state typed to myScene's state
        }
    })
    .extend(scenes([myScene], { storage })); // same storage required
```

---

## Custom storage

Any `@gramio/storage`-compatible adapter:

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
    name: string;                       // scene name
    params: unknown;                    // immutable params passed at enter()
    state: unknown;                     // mutable state updated via update()
    stepId: string | number;            // current step id (named or numeric)
    previousStepId: string | number;    // previous step id
    firstTime: boolean;                 // true on first visit to current step
    entered?: boolean;                  // true after onEnter has fired (set by runtime)
    parentStack?: ParentSceneFrame[];   // set by enterSub()
}

interface ParentSceneFrame {
    name: string;
    params: unknown;
    state: unknown;
    stepId: string | number;
    previousStepId: string | number;
    parentStack?: ParentSceneFrame[];   // for N-level nesting
}
```

Storage key format: `@gramio/scenes:<userId>`.

---

## Legacy step API (backwards compatible)

The original `.step("message", handler)` form still works — useful for existing code and one-shot steps:

```typescript
const greeting = new Scene("greeting")
    .step("message", (ctx) => {
        if (ctx.scene.step.firstTime) return ctx.send("What's your name?");
        return ctx.scene.update({ name: ctx.text });
    });
```

The first argument disambiguates:

- **String matching a known event name** (`"message"`, `"callback_query"`, …) → legacy event-filtered step.
- **Any other string** → named builder step (`.step(name, c => c…)`).
- **Array of event names** → legacy event-filtered step.
- **Function** → builder step (numeric, autoincrement).

You can mix both forms in the same scene; they coexist.

---

## Full API reference

See the [official plugin documentation](https://gramio.dev/plugins/official/scenes).

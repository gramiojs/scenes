# @gramio/scenes

<div align="center">

[![npm](https://img.shields.io/npm/v/@gramio/scenes?logo=npm&style=flat&labelColor=000&color=3b82f6)](https://www.npmjs.org/package/@gramio/scenes)
[![npm downloads](https://img.shields.io/npm/dw/@gramio/scenes?logo=npm&style=flat&labelColor=000&color=3b82f6)](https://www.npmjs.org/package/@gramio/scenes)
[![JSR](https://jsr.io/badges/@gramio/scenes)](https://jsr.io/@gramio/scenes)
[![JSR Score](https://jsr.io/badges/@gramio/scenes/score)](https://jsr.io/@gramio/scenes)

</div>

Multi-step, type-safe conversation scenes for [GramIO](https://gramio.dev). A `Scene` **is an `EventComposer`** — you get the full bot DSL (`.command / .callbackQuery / .hears / .on / .use / .derive / .guard / …`) plus per-step lifecycle hooks. Scenes compose into one another, so common flows (confirm-prompt, collect-contact, captcha) become reusable modules.

## Install

```bash
bun add @gramio/scenes
# or
npm install @gramio/scenes
```

---

## Mental model in 30 seconds

```
┌───────────────────────────────────────────────────────────────────┐
│  Scene  =  EventComposer  +  ordered list of Steps  +  lifecycle  │
│                                                                   │
│      onEnter ─►  [ Step 1 ]  ─►  [ Step 2 ]  ─►  …  ─►  onExit    │
│                     │                │                            │
│                     │  per-step:  .enter / .message / .exit       │
│                     │             .on / .command / .callback…     │
│                     │             .fallback / .events             │
│                                                                   │
│   ctx.scene  =  state, params, step navigation, enter/exit subs   │
└───────────────────────────────────────────────────────────────────┘
```

- **Scene** is the top-level container. Holds state shape, params shape, and a list of steps. Has its own derives/guards/handlers that apply everywhere inside it (scene-global).
- **Step** is a sub-composer. Has lifecycle hooks (`.enter`, `.exit`, `.fallback`) **and** the full event DSL (`.on`, `.command`, `.callbackQuery`, `.hears`). One step = one screen / question / interaction point.
- **`ctx.scene`** is the per-update handle: typed `state`, typed `params`, step navigation, enter/exit sub-scenes.

State and step transitions are persisted in `Storage` keyed by user id — refresh-safe across bot restarts.

---

## 5-minute example

```typescript
import { Bot } from "gramio";
import { Scene, scenes } from "@gramio/scenes";

const greeting = new Scene("greeting")
    .step("ask-name", (c) => c
        .enter((ctx) => ctx.send("Hi! What's your name?"))
        .on("message", (ctx) => ctx.scene.update({ name: ctx.text! })))
    .step("ask-age", (c) => c
        .enter((ctx) => ctx.send(`Nice, ${ctx.scene.state.name}! How old are you?`))
        .on("message", (ctx) => ctx.scene.update({ age: Number(ctx.text) })))
    .step("done", (c) => c.enter((ctx) => {
        ctx.send(`${ctx.scene.state.name}, ${ctx.scene.state.age}. 👋`);
        return ctx.scene.exit();
    }));

const bot = new Bot(process.env.BOT_TOKEN!)
    .extend(scenes([greeting]))
    .command("start", (ctx) => ctx.scene.enter(greeting));

bot.start();
```

Notice what you **didn't** write:
- No `.state<T>()` — state shape is inferred from `update({ name, age })` calls.
- No `firstTime` check — `.enter` does that for you.
- No manual `stepId` arithmetic — `update()` auto-advances.

---

## Update flow — what happens when a message arrives

```
Telegram update
      │
      ▼
┌─────────────────────┐
│ bot.extend(scenes)  │   plugin loads ScenesStorageData for ctx.from.id
└──────────┬──────────┘
           │
           ▼
   has active scene?           ─── no ──►   pass to outer bot chain
           │
           │ yes
           ▼
┌─────────────────────┐
│  scene.dispatch     │   • inject ctx.scene
│                     │   • run scene-level derive/decorate/guard
└──────────┬──────────┘
           │
           ▼
   firstTime on this step?
           │
   ┌───────┴────────┐
   │ yes            │ no
   ▼                ▼
.enter()        scene-level handlers (.on / .command / …)
.message()      then step handlers (.on / .command / …)
                then .fallback() if nothing matched
                                │
                                ▼
                  did handler call ctx.scene.update / exit / step.go ?
                                │
                                ▼
                  persist new ScenesStorageData → wait for next update
```

- **`firstTime`** is the storage flag the plugin flips after the first dispatch on each step. Builder API uses it implicitly via `.enter`. Legacy API exposes it as `ctx.scene.step.firstTime`.
- **Passthrough**: if nothing inside the scene chain claimed the update, it falls through to the outer `bot.command / bot.on / …` (default behaviour; disable with `scenes(_, { passthrough: false })`).

---

## What goes where — the decision guide

| Concern | Put it on … | Why |
|---|---|---|
| One-time setup before any step (analytics, fetch user record) | **`scene.derive` + `scene.onEnter`** | derives run once at scene entry; `.onEnter` sees them. |
| Global escape hatch (`/cancel`, `/help`) that works in any step | **`scene.command` / `scene.callbackQuery`** | scene-level handlers run on every update inside the scene. |
| Role check / gate the whole scene | **`scene.guard`** | predicate runs once at scene entry. |
| One question / screen / interaction | **`scene.step(name, c => c…)`** | one step = one screen. Name it for `step.go("name")` jumps. |
| Send a prompt when the user lands on a step | **`c.enter` / `c.message`** | runs once on first visit; replaces `if (firstTime)` boilerplate. |
| Handle the answer to that prompt | **`c.on / c.command / c.callbackQuery / c.hears`** | per-step handlers narrow `ctx` to the right event type. |
| Catch-all if user sends something unexpected | **`c.fallback`** | runs only when no other step handler claimed the update. |
| Cleanup when leaving a step (analytics, log) | **`c.exit`** | runs once when navigating away from this step. |
| Validate-and-store a single field (prompt → schema → state) | **`scene.ask(key, schema, prompt)`** | Standard-Schema sugar over `.step`. |
| Reusable block of steps (confirmation, contact form, captcha) | **`new Scene().step(…).step(…)`** (no name) **+ `parent.extend(module)`** | nameless scene = step module. Cannot be entered directly. |
| Dive into a child flow, return with data | **`ctx.scene.enterSub(child)` + `child.exitSub({…})`** | child's exitData merges into parent's state. |

---

## State, params, exit-data — type contracts

```typescript
const checkout = new Scene("checkout")
    .params<{ productId: number }>()       // immutable, set at .enter(checkout, {…})
    .state<{ qty: number }>()              // mutable; widened by update() calls
    .exitData<{ orderId: string }>()       // typed return for exitSub() from this scene
    .step("review", (c) => c
        .enter((ctx) => {
            ctx.scene.params.productId;    // number — typed
            ctx.scene.state.qty;           // number — typed
            return ctx.send("…");
        })
        .on("message", (ctx) =>
            ctx.scene.exitSub({ orderId: "ord_42" })));   // shape enforced

await ctx.scene.enter(checkout, { productId: 7 });
```

| Type method | What it sets | Where you see it |
|---|---|---|
| `.params<T>()` | immutable args passed when entering | `ctx.scene.params` and on `ctx.scene.enter(scene, params)` |
| `.state<T>()` | mutable shape (extra to anything auto-inferred from `update()`) | `ctx.scene.state` |
| `.exitData<T>()` | what this scene returns to its parent when exiting as a sub-scene | `ctx.scene.exitSub(returnData)` typed arg |

**You rarely need `.state<T>()`.** State is auto-widened from every `ctx.scene.update({…})` call inside step handlers. Only declare it when (a) you want a field typed before any `update()` runs, (b) you're receiving fields from a sub-scene's `exitSub` (the parent-side mirror — see below).

---

## ctx.scene.update — the most-used method

```typescript
// merge state and advance to next step (most common)
await ctx.scene.update({ name: ctx.text });

// jump to a specific step (named or numeric)
await ctx.scene.update({ name: ctx.text }, { step: "confirm" });
await ctx.scene.update({}, { step: 5 });

// merge state, stay on the same step
await ctx.scene.update({ name: ctx.text }, {});

// jump but suppress the next step's .enter
await ctx.scene.update({}, { step: "review", firstTime: false });
```

**Resolution order for advancing**:
1. `options.step` set → jump there.
2. There are builder steps → walk array by index (named & numeric mixed).
3. Legacy numeric-only mode → `stepId + 1`.
4. Last step → just persist state, no transition.

---

## Reusable step modules

A `new Scene()` **without a name** is a step module. It can't be entered, only `.extend()`-ed:

```typescript
// Module: yes/no confirmation
const confirm = new Scene().step("confirm", (c) => c
    .enter((ctx) => ctx.send("Are you sure?", confirmKeyboard))
    .callbackQuery("yes", (ctx) => ctx.scene.step.next())
    .callbackQuery("no", (ctx) => ctx.scene.exit()));

// Module: contact-info collection
const contact = new Scene()
    .step("phone", (c) => c.message("Phone?")
        .on("message", (ctx) => ctx.scene.update({ phone: ctx.text! })))
    .step("email", (c) => c.message("Email?")
        .on("message", (ctx) => ctx.scene.update({ email: ctx.text! })));

// Compose modules into real scenes
const checkout = new Scene("checkout")
    .step("review", (c) => c.message("Review your cart?")
        .on("message", (ctx) => ctx.scene.update({ ack: true })))
    .extend(contact)                 // adds phone + email steps
    .extend(confirm)                 // adds confirm step
    .step("complete", (c) => c.message("Done! 🎉"));

const support = new Scene("support")
    .step("describe", (c) => c.message("Describe the issue:")
        .on("message", (ctx) => ctx.scene.update({ issue: ctx.text! })))
    .extend(contact)                 // SAME module, different host
    .step("submit", (c) => c.message("Ticket created!"));
```

### Merge rules

When `parent.extend(module)`:
- **Numeric step ids** are **renumbered** to fit parent.
- **Named step ids** must not collide — throws on duplicate.
- **Composer middleware** (`.derive / .use / .guard / .on / …`) merges in registration order.
- **`onEnter` / `onExit`** — parent wins; module's hooks copy only if parent has none.
- **`params` / `state` / `exitData`** — type-level intersection.

Plugin and bare-composer paths still work: `scene.extend(plugin)` / `scene.extend(composer)` skip step-merge and behave like the parent `Composer.extend`.

### Module enforcement

Trying to register a module via `scenes([module])` throws — modules must be `.extend()`-ed into a named scene.

---

## Sub-scenes — `enterSub` / `exitSub`

Sub-scenes are for nesting flows. Parent pauses, child runs, child returns data → parent resumes at the same step with merged state.

```
┌── parent scene ──────────────────────────────────────────┐
│                                                          │
│   step "ask-address"                                     │
│      .enter ──► ctx.scene.enterSub(pickAddress)          │
│                              │                           │
│                              ▼                           │
│   ┌── pickAddress (child) ──────────────────────────┐    │
│   │   step "ask"                                    │    │
│   │      .enter ──► "Enter your address"            │    │
│   │      .on(message) ──► exitSub({ address })      │    │
│   └────────────────────────────┬────────────────────┘    │
│                                │ merges { address }      │
│                                │ into parent.state       │
│                                ▼                         │
│   step "ask-address" RESUMES with firstTime=false        │
│      .on(message) ──► sees ctx.scene.state.address       │
│                       advances via ctx.scene.step.next() │
└──────────────────────────────────────────────────────────┘
```

```typescript
const pickAddress = new Scene("pickAddress")
    .exitData<{ address: string }>()      // child declares return shape
    .step("ask", (c) => c
        .enter((ctx) => ctx.send("Enter your address:"))
        .on("message", (ctx) => {
            if (!ctx.text) return ctx.send("Send text please");
            return ctx.scene.exitSub({ address: ctx.text });
        }));

const checkout = new Scene("checkout")
    .state<{ address: string }>()         // parent declares what it expects
    .step("ask-address", (c) => c
        .enter((ctx) => ctx.scene.enterSub(pickAddress))
        .on("message", (ctx) => {
            // child's exitSub merged { address } into ctx.scene.state.
            // The same update is re-dispatched here with firstTime=false;
            // advance only when we see the field arrive.
            if (ctx.scene.state.address) return ctx.scene.step.next();
        }))
    .step("confirm", (c) => c
        .enter((ctx) => ctx.send(`Deliver to ${ctx.scene.state.address}?`))
        .on("message", (ctx) => ctx.scene.exit()));

bot
    .extend(scenes([checkout, pickAddress]))
    .command("checkout", (ctx) => ctx.scene.enter(checkout));
```

**Quirk to know**: when the child `exitSub`s, the parent's step resumes at the same step with `firstTime = false`. The triggering update is re-dispatched into the parent, so the parent's `.on("message", …)` handler fires. Always guard your "resumed" branch by checking the field the child injected (see `if (ctx.scene.state.address)` above).

Sub-scenes nest arbitrarily deep — each `exitSub` unwinds one level. Calling `exitSub` on a scene entered normally (not via `enterSub`) behaves like `exit()`.

### Typing the sub-scene contract

The type-level connection between `child.exitData<T>()` and `parent.state` is **not automatic** — write both. The pattern:

1. Child: `.exitData<{ field: T }>()`  ← types `ctx.scene.exitSub(returnData)` to require that shape.
2. Parent: `.state<{ field: T }>()`  ← types `ctx.scene.state.field` in the resume branch.

---

## Validated input — `.ask(key, schema, prompt)`

Sugar over `.step` for the very common prompt → validate → store pattern. Uses [Standard Schema](https://standardschema.dev/) (Zod, Sury, Valibot, ArkType, …).

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

`ctx.scene.state.name` and `ctx.scene.state.age` are inferred from the schema output types — no `.state<T>()` needed.

---

## Step builder — full reference

```typescript
new Scene("greet").step("intro", (c) => c
    .events(["message", "callback_query"])   // optional — narrow accepted events
    .enter((ctx) => ctx.send("Hi!"))         // runs once on first visit
    .command("skip", (ctx) => ctx.scene.step.next())
    .callbackQuery("back", (ctx) => ctx.scene.step.previous())
    .on("message", (ctx) => ctx.scene.update({ name: ctx.text! }))
    .fallback((ctx) => ctx.send("I didn't understand that"))
    .exit((ctx) => analytics.track("intro_completed")));
```

| Method                   | Runs when                                                                 |
| ------------------------ | ------------------------------------------------------------------------- |
| `.enter(handler)`        | First visit to this step (replaces `if (firstTime)`)                      |
| `.message(text\|fn)`     | Sugar — `c.message("Hi")` ≡ `c.enter(ctx => ctx.send("Hi"))`              |
| `.exit(handler)`         | Leaving this step (`step.next/previous/go`, `scene.exit`, `reenter`)      |
| `.fallback(handler)`     | No other handler in this step claimed the update                          |
| `.events([...])`         | Narrow accepted events (default: `message` + `callback_query`)            |
| `.command(name, fn)`     | `/name` while in this step                                                |
| `.callbackQuery(t, fn)`  | Button click (string / RegExp / `CallbackData`)                           |
| `.hears(t, fn)`          | Text match (string / array / RegExp / predicate)                          |
| `.on(event, fn)`         | Generic event handler                                                     |
| `.use/.derive/.guard/…`  | Standard composer middleware, scoped to this step                         |
| `.updates<T>()`          | Type-only — declare state contribution (rarely needed; auto-inferred)     |

### Step ids: numeric or named

```typescript
new Scene("flow")
    .step((c) => c.message("step 0"))            // numeric id 0
    .step("review", (c) => c.message("review"))  // named id "review"
    .step((c) => c.message("step 2"));           // numeric id 2 (numbering continues)
```

Navigate by either name or number:

```typescript
ctx.scene.step.next();         // → next entry in the list
ctx.scene.step.previous();     // → previous entry
ctx.scene.step.go("review");   // → named jump
ctx.scene.step.go(2);          // → numeric jump
```

---

## Scene lifecycle — `onEnter` / `onExit`

```typescript
new Scene("checkout")
    .derive(async (ctx) => ({ user: await db.users.find(ctx.from!.id) }))
    .onEnter((ctx) => analytics.track("checkout_start", { userId: ctx.user.id }))
    .onExit((ctx) => analytics.track("checkout_end"))
    .step("review", (c) => c.message("Order looks good?")
        .on("message", (ctx) => ctx.scene.update({ ack: true })))
    .step("done", (c) => c.message("Done!"));
```

- **`.onEnter(handler)`** fires once when the user enters the scene. Runs **after** scene-level `.derive()` / `.decorate()` apply, so derived ctx fields (`ctx.user`, `ctx.config`, …) are visible. Does NOT re-fire on `step.go()` transitions within the scene.
- **`.onExit(handler)`** fires once when the user leaves the scene via `ctx.scene.exit()`, `ctx.scene.exitSub()`, or `ctx.scene.reenter()`, before storage cleanup.

---

## `ctx.scene` API reference

```typescript
ctx.scene.state                              // mutable state (typed)
ctx.scene.params                             // immutable params (typed)

ctx.scene.step.id                            // current step id        (string | number)
ctx.scene.step.previousId                    // previous step id       (string | number)
ctx.scene.step.firstTime                     // first dispatch on this step?
ctx.scene.step.next()                        // advance
ctx.scene.step.previous()                    // back
ctx.scene.step.go(id, firstTime?)            // jump (accepts string | number)

ctx.scene.update(state, options?)            // merge state, optionally jump
                                             //   options.step: string | number
                                             //   options.firstTime: boolean

ctx.scene.enter(scene, params?)              // open a top-level scene
ctx.scene.exit()                             // leave current scene
ctx.scene.reenter(params?)                   // exit + re-enter, clean state

ctx.scene.enterSub(scene, params?)           // dive into a sub-scene
ctx.scene.exitSub(returnData?)               // return to parent, merge data
```

`scene.enter / scene.enterSub` enforce params shape at the call site if the scene declared `.params<T>()`. `scene.exitSub` enforces returnData shape if the scene declared `.exitData<T>()`.

---

## Plugin registration

```typescript
bot.extend(scenes([greeting, checkout, support], {
    storage: redisStorage({ host: "localhost", port: 6379 }),
    passthrough: true,    // default
}));
```

| Option        | Type      | Default             | Description                                                                                                  |
| ------------- | --------- | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `storage`     | `Storage` | `inMemoryStorage()` | Where scene state is persisted (in-memory loses state on restart; use Redis / file / etc. for production).   |
| `passthrough` | `boolean` | `true`              | If `true`, updates the active step doesn't claim fall through to outer bot handlers (`bot.command`, `bot.on`). Set `false` to make scenes greedy. |

### `scenesDerives` — when you need `ctx.scene` before the router

Use `scenesDerives` to inject `ctx.scene.enter` / `ctx.scene.current` into handlers that run **before** the scenes router (e.g. a global onboarding gate):

```typescript
import { scenes, scenesDerives } from "@gramio/scenes";
import { inMemoryStorage } from "@gramio/storage";

const storage = inMemoryStorage();      // share the SAME storage across both

bot
    .extend(scenesDerives([myScene], { storage, withCurrentScene: true }))
    .on("message", (ctx) => {
        if (ctx.scene.current?.is(myScene)) {
            // ctx.scene.current.state typed to myScene's state
        }
    })
    .extend(scenes([myScene], { storage }));
```

---

## Storage data shape

```typescript
interface ScenesStorageData {
    name: string;                       // scene name
    params: unknown;                    // immutable, passed at enter()
    state: unknown;                     // mutable, updated via update()
    stepId: string | number;            // current step
    previousStepId: string | number;
    firstTime: boolean;                 // first dispatch on current step
    entered?: boolean;                  // true once onEnter has fired
    parentStack?: ParentSceneFrame[];   // set by enterSub() — supports N-level nesting
}

interface ParentSceneFrame {
    name: string;
    params: unknown;
    state: unknown;
    stepId: string | number;
    previousStepId: string | number;
    parentStack?: ParentSceneFrame[];
}
```

Storage key: `@gramio/scenes:<userId>`. Schema changes are back-compat (new optional fields only) so persistent stores survive upgrades.

---

## Legacy step API (still supported)

The original `.step("message", handler)` form keeps working — useful for one-shot steps and existing code:

```typescript
const greeting = new Scene("greeting")
    .step("message", (ctx) => {
        if (ctx.scene.step.firstTime) return ctx.send("What's your name?");
        return ctx.scene.update({ name: ctx.text });
    });
```

Disambiguation when calling `.step(...)`:

| Form                                                       | Resolved as                                |
| ---------------------------------------------------------- | ------------------------------------------ |
| `.step((c) => …)`                                          | Builder step, numeric id (autoincrement)   |
| `.step("any-name", (c) => …)`                              | Builder step, named id                     |
| `.step("message" \| "callback_query" \| …, handler)`       | Legacy event-filtered step                 |
| `.step(["message", "callback_query"], handler)`            | Legacy event-filtered step (multi-event)   |

Reserved first-argument names are the Telegram event taxonomy (`message`, `callback_query`, `channel_post`, `inline_query`, …). Don't name a builder step the same as an event — TS will pick the legacy overload and your `c.enter(...)` will fail to type-check.

You can mix legacy and builder steps in the same scene; they coexist on the same step list.

---

## Full API reference & guides

See the [official plugin docs](https://gramio.dev/plugins/official/scenes).

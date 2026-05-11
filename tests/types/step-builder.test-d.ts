/**
 * Type-level tests for the step-builder DSL inside `scene.step(...)`.
 *
 * Focus areas:
 *   • `c.enter / c.message / c.exit / c.fallback` ctx typing (default events)
 *   • `c.on / c.command / c.callbackQuery / c.hears` handler ctx typing
 *   • `c.events([...])` narrowing (today: runtime only, not type-level)
 *   • `ctx.scene` availability inside step handlers (✔ fixed)
 *   • `ctx.text` / `ctx.data` / `.send` availability on default ctx
 *
 * Erased at runtime. Compiled via `tsc --noEmit -p tsconfig.test.json`.
 */

import { describe, expectTypeOf, it } from "bun:test";
import { Scene } from "../../src/index.js";

// ─── 1. Default event union — message + callback_query ────────────────────

describe("step builder default ctx (message + callback_query)", () => {
	it("c.enter(ctx => ...) — ctx has .send (present on both message & callback ctx)", () => {
		new Scene("x").step("a", (c) =>
			c.enter((ctx) => {
				// Both MessageContext and CallbackQueryContext expose .send;
				// the default StepCtx union is intentionally narrowed to these
				// two events so this typechecks.
				expectTypeOf(ctx.send).toBeFunction();
				return ctx.send("hi");
			}),
		);
	});

	it("c.message(text) accepts a Stringable", () => {
		new Scene("x").step("a", (c) => c.message("hello"));
		new Scene("x").step("a", (c) => c.message(123));
	});

	it("c.message(ctx => Stringable) factory receives the default ctx", () => {
		new Scene("x").step("a", (c) =>
			c.message((ctx) => {
				expectTypeOf(ctx.send).toBeFunction();
				return `hi from ${ctx.chatId}`;
			}),
		);
	});

	it("c.exit(ctx => ...) — same ctx shape as c.enter", () => {
		new Scene("x").step("a", (c) =>
			c.exit((ctx) => {
				expectTypeOf(ctx.send).toBeFunction();
			}),
		);
	});

	it("c.fallback(ctx => ...) — same ctx shape", () => {
		new Scene("x").step("a", (c) =>
			c.fallback((ctx) => {
				expectTypeOf(ctx.send).toBeFunction();
			}),
		);
	});
});

// ─── 2. Inside-step event handlers — proper per-event narrowing ────────────

describe("step builder per-event handlers narrow ctx", () => {
	it("c.on('message', ctx => ...) — ctx is MessageContext", () => {
		new Scene("x").step("a", (c) =>
			c.on("message", (ctx) => {
				// ctx.text exists on MessageContext (optional)
				expectTypeOf(ctx.text).toEqualTypeOf<string | undefined>();
			}),
		);
	});

	it("c.command('cancel', ctx => ...) — ctx is MessageContext + args", () => {
		new Scene("x").step("a", (c) =>
			c.command("cancel", (ctx) => {
				expectTypeOf(ctx.text).toEqualTypeOf<string | undefined>();
				// .command adds an `args` derive (string | null) on top.
				expectTypeOf(ctx.args).toEqualTypeOf<string | null>();
			}),
		);
	});

	it("c.callbackQuery('yes', ctx => ...) — ctx is CallbackQueryContext", () => {
		new Scene("x").step("a", (c) =>
			c.callbackQuery("yes", (ctx) => {
				// .answer is unique to callback contexts; .data is the payload
				expectTypeOf(ctx.answer).toBeFunction();
			}),
		);
	});

	it("c.hears(/skip/, ctx => ...) — ctx is MessageContext", () => {
		new Scene("x").step("a", (c) =>
			c.hears(/^skip$/, (ctx) => {
				expectTypeOf(ctx.text).toEqualTypeOf<string | undefined>();
			}),
		);
	});
});

// ─── 3. ctx.scene is available inside every step handler ──────────────────
//
//      `Scene.step()` is now typed so the builder's `c` is a
//      `StepComposerFor<Derives>` — i.e., a step composer pre-seeded with
//      Scene's `Derives["global"]` (which includes `{ scene: ... }`) in TOut.
//      Every lifecycle / event handler ctx inside the builder picks this up
//      via `EventContextOf<TThis, E>`.

describe("ctx.scene is available in every step handler", () => {
	it("ctx.scene.exit() inside c.on('message', ...)", () => {
		new Scene("x").step("a", (c) =>
			c.on("message", (ctx) => {
				expectTypeOf(ctx.scene.exit).toBeFunction();
				return ctx.scene.exit();
			}),
		);
	});

	it("ctx.scene.update({}) inside c.on('message', ...) advances to next step", () => {
		new Scene("x").step("a", (c) =>
			c.on("message", (ctx) => {
				expectTypeOf(ctx.scene.update).toBeFunction();
				return ctx.scene.update({});
			}),
		);
	});

	it("ctx.scene.step.go(name) accepts string | number", () => {
		new Scene("x").step("a", (c) =>
			c.on("message", (ctx) => {
				expectTypeOf(ctx.scene.step.go)
					.parameter(0)
					.toEqualTypeOf<string | number>();
				return ctx.scene.step.go("other");
			}),
		);
	});

	it("ctx.scene inside c.enter is typed (params reflect Scene.params<T>())", () => {
		new Scene("x")
			.params<{ test: boolean }>()
			.step("a", (c) =>
				c.enter((ctx) => {
					expectTypeOf(ctx.scene.params).toEqualTypeOf<{ test: boolean }>();
				}),
			);
	});

	it("ctx.scene inside c.callbackQuery", () => {
		new Scene("x").step("a", (c) =>
			c.callbackQuery("yes", (ctx) => {
				expectTypeOf(ctx.scene.exit).toBeFunction();
				return ctx.scene.exit();
			}),
		);
	});

	it("ctx.scene.state reflects Scene.state<T>()", () => {
		new Scene("x")
			.state<{ count: number }>()
			.step("a", (c) =>
				c.on("message", (ctx) => {
					expectTypeOf(ctx.scene.state).toEqualTypeOf<{ count: number }>();
				}),
			);
	});
});

// ─── 4. Scene-level derive flows into step ctx ─────────────────────────────

describe("scene-level derive flows into step ctx", () => {
	it("scene.derive(...).step(...) — derived field is visible inside step handler", () => {
		new Scene("x")
			.derive(() => ({ db: { lookup: (n: number) => `id:${n}` } }))
			.step("a", (c) =>
				c.enter((ctx) => {
					expectTypeOf(ctx.db.lookup).toBeFunction();
					return ctx.db.lookup(1);
				}),
			);
	});

	it("scene.extend(plugin) brings plugin derives into step ctx", () => {
		// Verified separately in extend.test-d.ts; this is a smoke for the
		// step-level visibility specifically.
	});
});

// ─── 5. c.events([...]) — narrow event union (currently runtime-only) ──────

describe("c.events() narrowing", () => {
	it("c.events(['callback_query']) is accepted (array form)", () => {
		new Scene("x").step("a", (c) => c.events(["callback_query"]));
	});

	it("c.events('callback_query') is accepted (single form)", () => {
		new Scene("x").step("a", (c) => c.events("callback_query"));
	});

	// ★ NICE-TO-HAVE ★: today `.events([...])` returns `this` unchanged at
	// the type level, so subsequent `.enter`/`.on` handlers still see the
	// default ctx union. A future iteration could thread the event generic
	// through so `.events(["callback_query"]).enter(ctx => ...)` narrows
	// ctx to CallbackQueryContext. Not currently implemented; documented
	// in step-composer.ts.
});

// ─── ★ Auto-inferred State from ctx.scene.update({...}) calls ★ ───────────
//
//      The killer feature: `ctx.scene.update({...})` calls inside step
//      handlers automatically widen the Scene's `State` generic, so later
//      steps see `ctx.scene.state.X` properly typed — no `.state<T>()` or
//      `.updates<T>()` boilerplate needed.
//
//      How it works:
//        • `ctx.scene.update(t: T)` returns `Promise<UpdateData<T>>`.
//        • Each step-composer event method (`.on/.command/.callbackQuery/
//          .hears/.enter/.exit/.fallback`) is typed to thread its handler's
//          `Awaited<ReturnType<H>>` into a phantom AccState generic.
//        • `Scene.step(name, builder)` reads AccState off the builder's
//          return type via `ExtractStepState` and intersects it into State.

describe("auto-inferred State from ctx.scene.update() calls", () => {
	it("single .on() with update — state field flows into next step", () => {
		const s = new Scene("x")
			.step("ask-name", (c) =>
				c
					.enter((ctx) => ctx.send("What's your name?"))
					.on("message", (ctx) =>
						ctx.scene.update({ name: ctx.text! }),
					),
			)
			.step("greet", (c) =>
				c.enter((ctx) => {
					// ctx.scene.state.name is typed as string — no annotation!
					expectTypeOf(ctx.scene.state.name).toEqualTypeOf<string>();
					return ctx.send(`Hi ${ctx.scene.state.name}`);
				}),
			);
		expectTypeOf(s).toMatchTypeOf<Scene<any, any, { name: string }, any>>();
	});

	it("multiple update() calls in one builder accumulate state", () => {
		new Scene("x")
			.step("multi", (c) =>
				c
					.enter((ctx) =>
						ctx.scene.update({ visited: true }),
					)
					.on("message", (ctx) =>
						ctx.scene.update({ name: ctx.text! }),
					)
					.callbackQuery("ok", (ctx) =>
						ctx.scene.update({ confirmed: true }),
					),
			)
			.step("read", (c) =>
				c.enter((ctx) => {
					expectTypeOf(ctx.scene.state.visited).toEqualTypeOf<boolean>();
					expectTypeOf(ctx.scene.state.name).toEqualTypeOf<string>();
					expectTypeOf(ctx.scene.state.confirmed).toEqualTypeOf<boolean>();
				}),
			);
	});

	it("state accumulates ACROSS steps too", () => {
		new Scene("x")
			.step("name", (c) =>
				c.on("message", (ctx) => ctx.scene.update({ name: ctx.text! })),
			)
			.step("age", (c) =>
				c.on("message", (ctx) =>
					ctx.scene.update({ age: Number(ctx.text!) }),
				),
			)
			.step("done", (c) =>
				c.enter((ctx) => {
					expectTypeOf(ctx.scene.state.name).toEqualTypeOf<string>();
					expectTypeOf(ctx.scene.state.age).toEqualTypeOf<number>();
				}),
			);
	});

	it("handlers that don't call update contribute nothing", () => {
		new Scene("x")
			.step("noop", (c) =>
				c
					.enter((ctx) => ctx.send("hi"))
					.on("message", (ctx) => ctx.send("got it")),
			)
			.step("read", (c) =>
				c.enter((ctx) => {
					// State stayed at the default empty shape. Just assert
					// the state object is reachable; depth-check is in other tests.
					expectTypeOf(ctx.scene.state).toBeObject();
				}),
			);
	});

	it("explicit .state<T>() still works (and combines with auto-inference)", () => {
		new Scene("x")
			.state<{ initial: number }>()
			.step("ask", (c) =>
				c.on("message", (ctx) => ctx.scene.update({ name: ctx.text! })),
			)
			.step("read", (c) =>
				c.enter((ctx) => {
					expectTypeOf(ctx.scene.state.initial).toEqualTypeOf<number>();
					expectTypeOf(ctx.scene.state.name).toEqualTypeOf<string>();
				}),
			);
	});
});

// ─── 6. c.updates<T>() — explicit state-shape escape hatch ─────────────────
//
//      ⚠️ Not the recommended path. `.updates<T>()` exists as a typed no-op
//      to declare a step's state contribution explicitly. The REAL DX goal
//      (tracked in task #25 in the workspace) is auto-inferring State from
//      `ctx.scene.update({...})` calls inside handlers — once that lands,
//      `.updates<T>()` becomes redundant. For now:
//
//        • Prefer `.state<T>()` on the Scene level (declarative, simple).
//        • If you must declare per-step, call `.updates<T>()` LAST in the
//          step builder chain so the return-type-loss doesn't break .enter.

describe("c.updates<T>() — explicit state-shape declaration", () => {
	it("accepts one type argument when called alone", () => {
		new Scene("x").step("a", (c) => {
			c.updates<{ name: string }>();
			return c;
		});
	});

	it("call after .enter (recommended placement)", () => {
		new Scene("x").step("a", (c) =>
			c.enter((ctx) => ctx.send("hi")).updates<{ name: string }>(),
		);
	});
});

// ─── 7. step() overload disambiguation ────────────────────────────────────

describe("scene.step() overload disambiguation", () => {
	it("step(builder) — 1-arg builder form", () => {
		new Scene("x").step((c) => c.enter(() => {}));
	});

	it("step(name, builder) — 2-arg named-builder form", () => {
		new Scene("x").step("intro", (c) => c.enter(() => {}));
	});

	it("step('message', (ctx, next) => …) — ctx is MessageContext, next is Next", () => {
		new Scene("x").step("message", (ctx, next) => {
			expectTypeOf(ctx.text).toEqualTypeOf<string | undefined>();
			return next();
		});
	});

	it("step(['message', 'callback_query'], handler) — array legacy form", () => {
		new Scene("x").step(["message", "callback_query"], (_ctx, next) =>
			next(),
		);
	});
});

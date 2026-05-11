/**
 * Type-level tests for the `Scene` class generic chain.
 *
 * Goal: prove (or surface, where broken) that `.params<T>()`, `.state<T>()`,
 * `.exitData<T>()`, `.onEnter`, `.onExit`, `.step(...)`, `.ask(...)` flow
 * types through the chain correctly and that `Scene<...>` is preserved
 * across chained composer-level calls.
 *
 * Erased at runtime — only need to compile under
 * `tsc --noEmit -p tsconfig.test.json`. `bun test` does NOT run these
 * (filenames end `.test-d.ts`, not `.test.ts`).
 *
 * Marker conventions:
 *   • `expectTypeOf<X>().toEqualTypeOf<Y>()` — locked-in working contract.
 *   • `// @ts-expect-error TODO(types): …` — known-broken contract; the
 *     comment is the fix prescription. When the bug is fixed, TS will
 *     surface the directive as unused → delete it.
 */

import { describe, expectTypeOf, it } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Scene } from "../../src/index.js";
import type {
	InActiveSceneHandlerReturn,
	SceneEnterHandler,
} from "../../src/types.js";

// ─── helpers ────────────────────────────────────────────────────────────────

type SceneParams<S> = S extends Scene<infer P, any, any, any> ? P : never;
type SceneState<S> = S extends Scene<any, any, infer St, any> ? St : never;

/**
 * Build a fake Standard Schema whose `~standard.types.output` is `T`. The
 * `types` field is what `StandardSchemaV1.InferOutput<S>` looks at, so we
 * MUST include it for `.ask()` inference to work in tests.
 */
const mkSchema = <T>(): StandardSchemaV1<unknown, T> =>
	({
		"~standard": {
			version: 1,
			vendor: "test",
			types: { input: null as unknown, output: null as unknown as T },
			validate: () => ({ value: null as unknown as T }),
		},
	}) as StandardSchemaV1<unknown, T>;

// ─── 1. Default generics ───────────────────────────────────────────────────

describe("Scene<> default generics", () => {
	it("Params defaults to never; State defaults to {}", () => {
		const s = new Scene("x");
		expectTypeOf<SceneParams<typeof s>>().toEqualTypeOf<never>();
		expectTypeOf<SceneState<typeof s>>().toEqualTypeOf<Record<string, never>>();
	});

	it("Nameless Scene is still typed as Scene (module marker is runtime-only)", () => {
		const mod = new Scene();
		expectTypeOf(mod).toMatchTypeOf<Scene<any, any, any, any>>();
	});
});

// ─── 2. .params<T>() ───────────────────────────────────────────────────────

describe("Scene.params<T>()", () => {
	it("sets Params; doesn't disturb State", () => {
		const s = new Scene("x").params<{ orderId: string }>();
		expectTypeOf<SceneParams<typeof s>>().toEqualTypeOf<{ orderId: string }>();
		expectTypeOf<SceneState<typeof s>>().toEqualTypeOf<Record<string, never>>();
	});

	it("Last .params<T>() wins", () => {
		const s = new Scene("x").params<{ a: number }>().params<{ b: string }>();
		expectTypeOf<SceneParams<typeof s>>().toEqualTypeOf<{ b: string }>();
	});
});

// ─── 3. .state<T>() ────────────────────────────────────────────────────────

describe("Scene.state<T>()", () => {
	it("sets State", () => {
		const s = new Scene("x").state<{ count: number }>();
		expectTypeOf<SceneState<typeof s>>().toEqualTypeOf<{ count: number }>();
	});

	it("stacks with .params<T>()", () => {
		const s = new Scene("x")
			.params<{ id: string }>()
			.state<{ count: number }>();
		expectTypeOf<SceneParams<typeof s>>().toEqualTypeOf<{ id: string }>();
		expectTypeOf<SceneState<typeof s>>().toEqualTypeOf<{ count: number }>();
	});
});

// ─── 4. Scene-only chained methods preserve Scene<...> ─────────────────────
//
//      Methods declared directly on the Scene class (.params/.state/
//      .exitData/.onEnter/.onExit/.step/.ask/.extend) return `Scene<...>`.

describe("Scene-declared methods preserve Scene<...>", () => {
	it(".onEnter ⇒ Scene<...>", () => {
		const s = new Scene("x").onEnter(() => {});
		s.step("a", (c) => c);
		s.ask("q", mkSchema<string>(), "?");
	});

	it(".onExit ⇒ Scene<...>", () => {
		const s = new Scene("x").onExit(() => {});
		s.step("a", (c) => c);
	});

	it(".step(name, builder) ⇒ Scene<...>", () => {
		const s = new Scene("x").step("a", (c) => c);
		s.onEnter(() => {});
		s.step("b", (c) => c);
	});

	it(".ask(...) ⇒ Scene<...>", () => {
		const s = new Scene("x").ask("name", mkSchema<string>(), "?");
		s.onEnter(() => {});
		s.step("after", (c) => c);
	});
});

// ─── 5. Inherited composer methods: which preserve Scene<...> ──────────────
//
//      Mixed picture:
//        ✔ `.use/.guard/.command/.callbackQuery/.hears/.branch/...` correctly
//          return `this`, so `.onEnter/.step/.ask` remain callable after them.
//        ✘ `.derive(handler)` widens the Derives generic and returns the bare
//          `EventComposer<…>` instead of `Scene<…>`. After it, Scene-specific
//          methods are LOST from the type. Fix prescription below.

describe("Inherited composer methods keep Scene<...>", () => {
	it(".command() ⇒ Scene<...>", () => {
		const s = new Scene("x").command("ping", () => {});
		s.onEnter(() => {});
		s.step("a", (c) => c);
	});

	it(".callbackQuery() ⇒ Scene<...>", () => {
		const s = new Scene("x").callbackQuery("yes", () => {});
		s.step("a", (c) => c);
	});

	it(".hears() ⇒ Scene<...>", () => {
		const s = new Scene("x").hears(/^skip$/, () => {});
		s.step("a", (c) => c);
	});

	it(".guard() ⇒ Scene<...>", () => {
		const s = new Scene("x").guard(() => true);
		s.step("a", (c) => c);
	});

	it(".use() ⇒ Scene<...>", () => {
		const s = new Scene("x").use((_, next) => next());
		s.step("a", (c) => c);
	});
});

describe(".derive() preserves Scene<...> in the chain (fixed)", () => {
	// Scene overrides `.derive` to delegate to super and re-type the return
	// as `Scene<Params, Errors, State, Modify<Derives, { global: D }>>`,
	// preserving every scene-level method (.onEnter / .step / .ask / .params)
	// in the chain.
	it(".derive() keeps .onEnter / .step / .ask callable", () => {
		const s = new Scene("x").derive(() => ({ a: 1 as const }));
		s.onEnter(() => {});
		s.step("a", (c) => c);
		s.ask("q", mkSchema<string>(), "?");
	});

	it(".derive() then later steps see the derived field in ctx", () => {
		new Scene("x")
			.derive(() => ({ db: { lookup: (n: number) => `id:${n}` } }))
			.step("a", (c) =>
				c.enter((ctx) => {
					expectTypeOf(ctx.db.lookup).toBeFunction();
					return ctx.send(`hi ${ctx.db.lookup(1)}`);
				}),
			);
	});
});

// ─── 6. .ask(key, schema, …) infers state ──────────────────────────────────

describe("Scene.ask(key, schema, …)", () => {
	it("merges { [key]: inferred } into State (default schema output type)", () => {
		const s = new Scene("x").ask("name", mkSchema<string>(), "What?");
		expectTypeOf<SceneState<typeof s>>().toMatchTypeOf<{ name: string }>();
	});

	it("multiple .ask() calls accumulate state keys", () => {
		const s = new Scene("x")
			.ask("name", mkSchema<string>(), "?")
			.ask("age", mkSchema<number>(), "?");
		expectTypeOf<SceneState<typeof s>>().toMatchTypeOf<{
			name: string;
			age: number;
		}>();
	});
});

// ─── 7. legacy step(event, handler) ctx (fixed) ───────────────────────────
//
//      The legacy overload now correctly types `ctx` as
//      `ContextType<Bot, "message"> & Derives["global"] & Derives["message"]`
//      so `ctx.scene.params/.state/.update/.exit/.step.go` and `ctx.text`
//      are all available.
//
//      Fix: moved the legacy overload ABOVE the named-builder overload in
//      scene.ts; TS tries it first, and `T extends UpdateName` cleanly
//      excludes non-event strings so they fall through to the named-builder
//      overload as expected.

describe("legacy step(event, handler) — ctx is properly typed", () => {
	it("ctx.scene.params reflects Params", () => {
		new Scene("x").params<{ userId: number }>().step("message", (ctx) => {
			expectTypeOf(ctx.scene.params).toEqualTypeOf<{ userId: number }>();
		});
	});

	it("ctx.scene.state reflects State", () => {
		new Scene("x").state<{ name: string }>().step("message", (ctx) => {
			expectTypeOf(ctx.scene.state).toEqualTypeOf<{ name: string }>();
		});
	});

	it("ctx.scene.step.go accepts string | number", () => {
		new Scene("x").step("message", (ctx) => {
			expectTypeOf(ctx.scene.step.go)
				.parameter(0)
				.toEqualTypeOf<string | number>();
		});
	});

	it("ctx.scene.update({}) is callable", () => {
		new Scene("x").step("message", (ctx) => {
			void ctx.scene.update({ foo: 1 });
		});
	});

	it("ctx.scene.update accepts { step } target (string or number)", () => {
		new Scene("x").step("message", (ctx) => {
			void ctx.scene.update({ k: 1 }, { step: "named-step" });
			void ctx.scene.update({ k: 1 }, { step: 3 });
		});
	});

	it("ctx.text is available (MessageContext)", () => {
		new Scene("x").step("message", (ctx) => {
			expectTypeOf(ctx.text).toEqualTypeOf<string | undefined>();
		});
	});
});

// ─── 8. InActiveSceneHandlerReturn — public ctx.scene shape ────────────────

describe("InActiveSceneHandlerReturn (public ctx.scene shape)", () => {
	type Scn = InActiveSceneHandlerReturn<{ p: 1 }, { s: 2 }, { ed: 3 }>;

	it("exposes typed params and state", () => {
		expectTypeOf<Scn["params"]>().toEqualTypeOf<{ p: 1 }>();
		expectTypeOf<Scn["state"]>().toEqualTypeOf<{ s: 2 }>();
	});

	it("step.id / step.previousId widened to string | number", () => {
		expectTypeOf<Scn["step"]["id"]>().toEqualTypeOf<string | number>();
		expectTypeOf<Scn["step"]["previousId"]>().toEqualTypeOf<string | number>();
	});

	it("step.firstTime is boolean", () => {
		expectTypeOf<Scn["step"]["firstTime"]>().toEqualTypeOf<boolean>();
	});

	it("step.go accepts string | number; .next/.previous accept no args", () => {
		expectTypeOf<Scn["step"]["go"]>()
			.parameter(0)
			.toEqualTypeOf<string | number>();
		expectTypeOf<Scn["step"]["next"]>().parameters.toEqualTypeOf<[]>();
		expectTypeOf<Scn["step"]["previous"]>().parameters.toEqualTypeOf<[]>();
	});

	it("exitSub takes the declared ExitData (optional)", () => {
		expectTypeOf<Scn["exitSub"]>()
			.parameter(0)
			.toEqualTypeOf<{ ed: 3 } | undefined>();
	});

	it("reenter takes the declared Params (optional)", () => {
		expectTypeOf<Scn["reenter"]>()
			.parameter(0)
			.toEqualTypeOf<{ p: 1 } | undefined>();
	});

	it("update returns a Promise — chainable", () => {
		expectTypeOf<Scn["update"]>().returns.toEqualTypeOf<Promise<{}>>();
	});

	it("enter returns Promise<void>", () => {
		expectTypeOf<Scn["enter"]>().returns.toEqualTypeOf<Promise<void>>();
	});

	it("exit returns boolean | Promise<boolean>", () => {
		expectTypeOf<Scn["exit"]>().returns.toEqualTypeOf<
			boolean | Promise<boolean>
		>();
	});
});

// ─── 9. SceneEnterHandler — params enforcement ────────────────────────────

// SceneEnterHandler now reads Params from the Scene GENERIC (not the
// `~scene.params` runtime carrier), and is split into two overloads so
// each case is checked cleanly:
//   • Scene<never, …>  → `enter(scene)` accepted, `enter(scene, x)` rejected
//   • Scene<Params, …> → `enter(scene, params)` required, params shape enforced
describe("SceneEnterHandler params resolution", () => {
	const enter = {} as SceneEnterHandler;

	it("Scene without .params<T>() accepts [scene] alone", () => {
		const plain = new Scene("plain");
		expectTypeOf(enter).toBeCallableWith(plain);
	});

	it("Scene with .params<T>() requires the params positional arg", () => {
		const typed = new Scene("typed").params<{ id: number }>();
		expectTypeOf(enter).toBeCallableWith(typed, { id: 1 });

		// @ts-expect-error params required when declared
		enter(typed);
	});

	it("params SHAPE is enforced on enter(scene, params)", () => {
		const typed = new Scene("typed").params<{ id: number }>();

		// @ts-expect-error params field-type mismatch (id must be number)
		enter(typed, { id: "wrong-type-id" });
	});
});

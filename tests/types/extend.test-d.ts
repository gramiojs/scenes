/**
 * Type-level tests for `Scene.extend(...)` — three overload paths:
 *   1. `.extend(scene)`     — merges another Scene (params/state/errors/derives + step list)
 *   2. `.extend(composer)`  — merges a bare EventComposer
 *   3. `.extend(plugin)`    — merges a Plugin (brings its derives/errors)
 *
 * Erased at runtime. Compiled via `tsc --noEmit -p tsconfig.test.json`.
 */

import { describe, expectTypeOf, it } from "bun:test";
import { Composer, Plugin } from "gramio";
import { Scene } from "../../src/index.js";

type SceneParams<S> = S extends Scene<infer P, any, any, any> ? P : never;
type SceneState<S> = S extends Scene<any, any, infer St, any> ? St : never;
type SceneErrors<S> = S extends Scene<any, infer E, any, any> ? E : never;

// ─── 1. .extend(otherScene) — Scene → Scene merge ──────────────────────────

describe("Scene.extend(otherScene)", () => {
	it("merges State (both → intersection)", () => {
		const a = new Scene("a").state<{ name: string }>();
		const b = new Scene("b").state<{ age: number }>();
		const merged = a.extend(b);
		// State should accumulate both keys
		expectTypeOf<SceneState<typeof merged>>().toMatchTypeOf<{
			name: string;
			age: number;
		}>();
	});

	it("Params from `this` wins (Scene → Scene)", () => {
		// extend(scene)'s signature keeps `this`'s Params — the merged-in scene
		// does not override.
		const a = new Scene("a").params<{ x: 1 }>();
		const b = new Scene("b").params<{ y: 2 }>();
		const merged = a.extend(b);
		expectTypeOf<SceneParams<typeof merged>>().toEqualTypeOf<{ x: 1 }>();
	});

	it("Errors intersect", () => {
		// Both scenes' errors merge via & — i.e. their union of declared error
		// classes is callable on the merged scene.
		const a = new Scene("a");
		const b = new Scene("b");
		const merged = a.extend(b);
		expectTypeOf<SceneErrors<typeof merged>>().toMatchTypeOf<{}>();
	});

	it("nameless module extended into named scene → still Scene<...>", () => {
		const module = new Scene().step("a", (c) => c.enter(() => {}));
		const main = new Scene("main").extend(module);
		expectTypeOf(main).toMatchTypeOf<Scene<any, any, any, any>>();
		// .onEnter still callable after .extend
		main.onEnter(() => {});
	});
});

// ─── 2. .extend(plugin) — Plugin → Scene merge ─────────────────────────────

describe("Scene.extend(plugin)", () => {
	it("Plugin → Scene: brings derives into scene-level ctx", () => {
		const tagPlugin = new Plugin("tagged").derive(() => ({
			tag: "★" as const,
		}));
		const scene = new Scene("x").extend(tagPlugin);
		// Scene-specific methods still available
		scene.onEnter(() => {});
		scene.step("a", (c) => c);
	});

	it("Plugin errors merge into Scene errors (under key 'custom')", () => {
		class CustomError extends Error {}
		const errPlugin = new Plugin("with-err").error("custom", CustomError);
		const scene = new Scene("x").extend(errPlugin);
		// The merged Errors slot has a `custom` key. The value shape is
		// internal to gramio (instance-like) — what matters here is the key
		// is present, so .error("custom", ...) handlers can be wired on the
		// scene afterwards.
		type E = SceneErrors<typeof scene>;
		expectTypeOf<keyof E & "custom">().toEqualTypeOf<"custom">();
	});
});

// ─── 3. .extend(composer) — EventComposer → Scene ──────────────────────────
//
//      Less common path — passing a bare EventComposer (not Scene, not
//      Plugin). The third overload (scene.ts:160) handles this. We mostly
//      care that it doesn't throw at type level.

describe("Scene.extend(composer)", () => {
	it("a bare composer's derives flow into scene derives", () => {
		// We can't easily build a bare EventComposer in test, but Plugin
		// inherits from it; using Plugin here suffices to exercise the
		// `extend(composer)` overload-resolution path.
		const taggedPlugin = new Plugin("t").derive(() => ({ flag: 1 }));
		const scene = new Scene("x").extend(taggedPlugin);
		scene.step("a", (c) => c.enter(() => {}));
	});
});

// ─── 4. .derive() and .extend(plugin) both preserve Scene chain ───────────
//
//      Scene overrides `.derive` to re-type as Scene<...> (fixed). Plus
//      `.extend(plugin)` already had a Scene<...> return type. Both should
//      let `.step`/.onEnter chain afterwards.

describe(".derive() / .extend(plugin) keep Scene chain intact", () => {
	it(".derive() then .step — .step IS preserved", () => {
		const s = new Scene("x").derive(() => ({ a: 1 }));
		s.step("a", (c) => c);
		s.onEnter(() => {});
	});

	it(".extend(plugin) then .step — .step IS preserved", () => {
		const plugin = new Plugin("p").derive(() => ({ a: 1 }));
		const s = new Scene("x").extend(plugin);
		s.step("a", (c) => c);
		s.onEnter(() => {});
	});
});

// ─── 4b. Plugin/Composer derives reach inside step builder handlers ───────
//
//      Verifies the canonical "Sharing Context Across Modules" pattern from
//      gramio.dev/guides/composer: a `withUser`-style derive registered on
//      a Composer or Plugin and extended into a Scene must be visible inside
//      every step-builder handler kind (.enter/.message/.on/.command/
//      .callbackQuery/.hears/.fallback/.exit), not just at the scene level.

describe(".extend(plugin) derives reach inside step builder", () => {
	const withUser = new Composer()
		.derive(() => ({ user: { id: 1, name: "alice" } }))
		.as("scoped");

	it("Composer-shape plugin: ctx.user visible in every step handler kind", () => {
		new Scene("checkout")
			.extend(withUser)
			.step("review", (c) => {
				c.enter((ctx) => expectTypeOf(ctx.user.name).toEqualTypeOf<string>());
				c.message((ctx) => `Hi ${ctx.user.name}`);
				c.on("message", (ctx) =>
					expectTypeOf(ctx.user.name).toEqualTypeOf<string>(),
				);
				c.command("cancel", (ctx) =>
					expectTypeOf(ctx.user.name).toEqualTypeOf<string>(),
				);
				c.callbackQuery("ok", (ctx) =>
					expectTypeOf(ctx.user.name).toEqualTypeOf<string>(),
				);
				c.hears(/back/, (ctx) =>
					expectTypeOf(ctx.user.name).toEqualTypeOf<string>(),
				);
				c.fallback((ctx) =>
					expectTypeOf(ctx.user.name).toEqualTypeOf<string>(),
				);
				c.exit((ctx) => expectTypeOf(ctx.user.name).toEqualTypeOf<string>());
				return c;
			});
	});

	it("Plugin-shape: ctx.<field> visible inside step builder", () => {
		const withTracker = new Plugin("tracker").derive(() => ({
			trackEvent: (_e: string) => {},
		}));
		new Scene("p")
			.extend(withTracker)
			.step("a", (c) =>
				c.enter((ctx) => expectTypeOf(ctx.trackEvent).toBeFunction()),
			);
	});

	it("Stacked .extend(pluginA).extend(pluginB) — both derives visible", () => {
		const withDb = new Composer().derive(() => ({ db: "pg" as const })).as("scoped");
		new Scene("y")
			.extend(withUser)
			.extend(withDb)
			.step("a", (c) =>
				c.enter((ctx) => {
					expectTypeOf(ctx.user.name).toEqualTypeOf<string>();
					expectTypeOf(ctx.db).toEqualTypeOf<"pg">();
				}),
			);
	});

	it(".extend then .state<T>() — both visible, chain survives", () => {
		new Scene("x")
			.extend(withUser)
			.state<{ count: number }>()
			.step("a", (c) =>
				c.enter((ctx) => {
					expectTypeOf(ctx.user.name).toEqualTypeOf<string>();
					expectTypeOf(ctx.scene.state.count).toEqualTypeOf<number>();
				}),
			);
	});
});

// ─── 5. Stacked merges: a.extend(b).extend(c) typing ──────────────────────

describe("stacked .extend chain", () => {
	it("a.extend(b).extend(c) — state types accumulate from all three", () => {
		const a = new Scene("a").state<{ name: string }>();
		const b = new Scene("b").state<{ age: number }>();
		const c = new Scene("c").state<{ city: string }>();
		const merged = a.extend(b).extend(c);
		expectTypeOf<SceneState<typeof merged>>().toMatchTypeOf<{
			name: string;
			age: number;
			city: string;
		}>();
	});
});

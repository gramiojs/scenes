/**
 * Type-level tests for the bot ⇄ scenes plugin integration.
 *
 * The whole point of `bot.extend(scenes([...]))` is that the bot's `ctx`
 * acquires a `ctx.scene.enter(...)` entry point. This is the FIRST type
 * users hit when adopting scenes — if it's broken, every code sample in
 * the docs is wrong.
 *
 * Erased at runtime. Compiled via `tsc --noEmit -p tsconfig.test.json`.
 */

import { describe, expectTypeOf, it } from "bun:test";
import { Bot } from "gramio";
import { Scene, scenes, scenesDerives } from "../../src/index.js";

// ─── 1. scenes([...]) accepts heterogeneous scenes ─────────────────────────

describe("scenes([...]) accepts the scenes array", () => {
	it("accepts a single typed Scene", () => {
		const a = new Scene("a").params<{ id: number }>();
		expectTypeOf(scenes).toBeCallableWith([a]);
	});

	it("accepts multiple scenes with different param/state shapes", () => {
		const a = new Scene("a").params<{ id: number }>();
		const b = new Scene("b").state<{ count: number }>();
		// AnyScene = Scene<any, any, any, any> swallows individual generics,
		// so heterogeneous arrays type-check. (The downside: the bot side
		// can't recover which scene needs which params — see §2 below.)
		scenes([a, b]);
	});
});

// ─── 2. ★ BUG ★ bot.extend(scenes([...])) doesn't add ctx.scene ────────────
//
//      After `.extend(scenes([myScene]))`, the bot's handlers should see
//      `ctx.scene.enter(myScene)` typed. Today the plugin's derive return
//      shape uses `any`, so `ctx.scene` exists but has type `any` — no
//      autocomplete, no enforcement of scene-name correctness, no params
//      shape checking.
//
//      Fix prescription:
//      The `scenes()` Plugin's derive on `["message", "callback_query"]`
//      returns `{ scene: ... }` typed as `Omit<EnterExit, "exit">`
//      (index.ts:142). That's far too loose — it should be typed as a
//      union over the registered scene shapes:
//        scene: {
//          enter<S extends typeof RegisteredScenes[number]>(scene: S, ...): Promise<void>;
//          exit(): MaybePromise<boolean>;
//        }
//      and the `scenes()` overload should preserve the literal scene-array
//      type so this can be inferred. Today everything devolves to `any`.

describe("bot.extend(scenes([scene])) — ctx.scene type quality", () => {
	it("on('message') ctx has SOME .scene member after extending scenes", () => {
		const myScene = new Scene("my");
		const bot = new Bot("token").extend(scenes([myScene]));

		bot.on("message", (ctx) => {
			// .scene IS present — but typed loosely.
			expectTypeOf(ctx.scene).not.toBeUndefined();
			// .scene.enter exists
			expectTypeOf(ctx.scene.enter).toBeFunction();
		});
	});

	it("★ BUG ★ ctx.scene.enter doesn't enforce the scene argument type", () => {
		const myScene = new Scene("my").params<{ id: number }>();
		const bot = new Bot("token").extend(scenes([myScene]));

		bot.on("message", (ctx) => {
			// EXPECTED contract:
			//   ctx.scene.enter(myScene, { id: 1 })   ✓
			//   ctx.scene.enter(myScene)              ✗ params missing
			//   ctx.scene.enter(unrelatedScene)       ✗ unknown scene
			//
			// REALITY: enter accepts anything (typed `any`).

			// This call SHOULD typecheck but DOES work — that's fine.
			ctx.scene.enter(myScene, { id: 1 });

			// @ts-expect-error TODO(types): see header above. Currently
			// .enter swallows all args without complaint.
			expectTypeOf(ctx.scene.enter).not.toBeCallableWith(myScene);
		});
	});
});

// ─── 3. scenesDerives — same loose typing path ─────────────────────────────

describe("scenesDerives()", () => {
	it("accepts a scenes array and a storage option", () => {
		const myScene = new Scene("my");
		const _bot = new Bot("token").extend(
			scenesDerives([myScene], {
				storage: undefined as any,
				withCurrentScene: false,
			}),
		);
	});

	it("withCurrentScene: true requires scenes to be passed", () => {
		// Runtime throws if you set withCurrentScene without scenes. Type
		// level today doesn't enforce this — captured below as a nice-to-have.

		const _validUse = scenesDerives({
			scenes: [new Scene("x")],
			storage: undefined as any,
			withCurrentScene: true,
		});

		// ★ NICE-TO-HAVE ★: TS could enforce that `scenes` is non-empty
		// when `withCurrentScene: true`. Not currently done.
	});
});

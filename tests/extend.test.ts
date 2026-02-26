import { describe, expect, expectTypeOf, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot, Composer, Plugin } from "gramio";
import { Scene, scenes } from "../src/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a bot with the scenes plugin and an optional `.on("message")` handler.
 * Cast to `any` to avoid the structural mismatch between the gramio@0.5 used
 * here and the gramio@0.4 bundled inside @gramio/test.
 */
function makeEnv(
	sceneList: Scene<any, any, any, any>[],
	onMessage?: (ctx: any) => Promise<void>,
) {
	const bot = new Bot("test_token").extend(scenes(sceneList as any[]));
	if (onMessage) bot.on("message", onMessage);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return new TelegramTestEnvironment(bot as any);
}

// ─── Type tests ──────────────────────────────────────────────────────────────

describe("Scene.extend() — types", () => {
	it("EventComposer derive is typed in step handler", () => {
		const withLocale = new Composer({ name: "withLocale" })
			.derive(() => ({ locale: "en" as "en" | "ru" }))
			.as("scoped");

		new Scene("locale-typed")
			.extend(withLocale)
			.step("message", (ctx) => {
				expectTypeOf(ctx.locale).toEqualTypeOf<"en" | "ru">();
			});
	});

	it("AnyPlugin derive is typed in step handler", () => {
		const plugin = new Plugin("plugin-typed").derive(() => ({
			pluginValue: 42 as number,
		}));

		new Scene("plugin-typed")
			.extend(plugin)
			.step("message", (ctx) => {
				expectTypeOf(ctx.pluginValue).toEqualTypeOf<number>();
			});
	});

	it("multiple EventComposer extends merge derives", () => {
		const withA = new Composer({ name: "withA" })
			.derive(() => ({ a: "hello" as string }))
			.as("scoped");

		const withB = new Composer({ name: "withB" })
			.derive(() => ({ b: 42 as number }))
			.as("scoped");

		new Scene("multi-extend-typed")
			.extend(withA)
			.extend(withB)
			.step("message", (ctx) => {
				expectTypeOf(ctx.a).toEqualTypeOf<string>();
				expectTypeOf(ctx.b).toEqualTypeOf<number>();
			});
	});

	it("UExposed from EventComposer is accessible in any update handler", () => {
		const withUser = new Composer({ name: "withUser-types" })
			.derive(() => ({ user: { id: 1, name: "Test" } }))
			.as("scoped");

		new Scene("user-typed").extend(withUser).step("message", (ctx) => {
			expectTypeOf(ctx.user).toEqualTypeOf<{ id: number; name: string }>();
		});
	});

	it("extend() returns a Scene, not the Composer", () => {
		const withX = new Composer({ name: "withX" })
			.derive(() => ({ x: 1 }))
			.as("scoped");

		// Type-level: Scene<..., { global: { x: number } }> — chaining works
		const scene = new Scene("chain-typed").extend(withX);
		// Runtime-level: still a Scene instance
		expect(scene).toBeInstanceOf(Scene);
	});
});

// ─── Runtime tests ───────────────────────────────────────────────────────────

describe("Scene.extend() — runtime: derive lands on context", () => {
	it("derive value is available in step handler on scene enter", async () => {
		let capturedUser: { id: number; name: string } | undefined;

		const withUser = new Composer({ name: "rt-withUser" })
			.derive(() => ({ user: { id: 99, name: "Alice" } }))
			.as("scoped");

		const testScene = new Scene("rt-user-scene")
			.extend(withUser)
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					capturedUser = ctx.user;
					return ctx.send("ok");
				}
			});

		const env = makeEnv([testScene], async (ctx) => ctx.scene.enter(testScene));
		await env.createUser().sendMessage("hi");

		expect(capturedUser).toEqual({ id: 99, name: "Alice" });
	});

	it("derive value is re-computed on every step run", async () => {
		const values: number[] = [];

		const withVersion = new Composer({ name: "rt-withVersion" })
			.derive(() => ({ version: 7 }))
			.as("scoped");

		const testScene = new Scene("rt-version-scene")
			.extend(withVersion)
			.step("message", async (ctx) => {
				values.push(ctx.version);
				if (ctx.scene.step.firstTime) return ctx.send("step 0");
				return ctx.scene.update({});
			})
			.step("message", (ctx) => {
				values.push(ctx.version);
				if (ctx.scene.step.firstTime) return ctx.send("step 1");
				return ctx.scene.exit();
			});

		const env = makeEnv([testScene], async (ctx) => ctx.scene.enter(testScene));
		const user = env.createUser();

		await user.sendMessage("enter");   // step 0, firstTime=true
		await user.sendMessage("advance"); // step 0 false → update → step 1 firstTime=true
		await user.sendMessage("finish");  // step 1 false → exit

		expect(values.every((v) => v === 7)).toBe(true);
		expect(values.length).toBeGreaterThan(0);
	});
});

describe("Scene.extend() — runtime: deduplication within a scene chain", () => {
	it("same named Composer extended twice runs only once per scene invocation", async () => {
		let callCount = 0;

		const withCounter = new Composer({ name: "rt-dedup-counter" })
			.derive(() => {
				callCount++;
				return {};
			})
			.as("scoped");

		const testScene = new Scene("rt-dedup-scene")
			.extend(withCounter) // first
			.extend(withCounter) // duplicate — deduped by name
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			});

		const env = makeEnv([testScene], async (ctx) => ctx.scene.enter(testScene));
		await env.createUser().sendMessage("trigger");

		expect(callCount).toBe(1);
	});

	it("anonymous Composers (no name) bypass deduplication", async () => {
		let callCount = 0;

		const anonymous = new Composer()
			.derive(() => {
				callCount++;
				return {};
			})
			.as("scoped");

		const testScene = new Scene("rt-anon-scene")
			.extend(anonymous)
			.extend(anonymous) // no name → not deduplicated
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			});

		const env = makeEnv([testScene], async (ctx) => ctx.scene.enter(testScene));
		await env.createUser().sendMessage("hi");

		expect(callCount).toBe(2);
	});

	it("shared Composer extended into two independent scenes runs per-scene", async () => {
		const counters = { A: 0, B: 0 };

		const shared = new Composer({ name: "rt-shared" })
			.derive(() => ({ sharedValue: "ok" }))
			.as("scoped");

		const sceneA = new Scene("rt-shared-A")
			.extend(shared)
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					counters.A++;
					return ctx.send("a");
				}
			});

		const sceneB = new Scene("rt-shared-B")
			.extend(shared)
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					counters.B++;
					return ctx.send("b");
				}
			});

		const envA = makeEnv([sceneA, sceneB], async (ctx) =>
			ctx.scene.enter(sceneA),
		);
		const envB = makeEnv([sceneA, sceneB], async (ctx) =>
			ctx.scene.enter(sceneB),
		);

		await envA.createUser().sendMessage("a");
		await envB.createUser().sendMessage("b");

		// each scene's chain runs the middleware independently
		expect(counters.A).toBe(1);
		expect(counters.B).toBe(1);
	});
});

// ─── The common case: Bot.extend(withUser) + scene.extend(withUser) ──────────

describe("Scene.extend() — runtime: bot-level vs scene-level (common pattern)", () => {
	/**
	 * The canonical "sharing context" pattern from the docs:
	 *
	 *   const bot = new Bot(TOKEN)
	 *     .extend(withUser)       // ← runs in bot's main chain
	 *     .extend(scenes([scene.extend(withUser)]))
	 *
	 * scene.compose() checks context.bot.updates.composer["~"].extended before
	 * running its internal chain and skips any middleware whose plugin name is
	 * already in that set — so withUser runs exactly once per request.
	 */
	it("withUser in bot chain AND in scene chain → runs once (cross-chain dedup)", async () => {
		let callCount = 0;

		const withUser = new Composer({ name: "rt-bot+scene-dedup" })
			.derive(() => {
				callCount++;
				return { user: { id: 1 } };
			})
			.as("scoped");

		const testScene = new Scene("rt-bot-scene-scene")
			.extend(withUser) // ← scene-level: adds withUser to scene's internal chain
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			});

		// Bot also extends withUser at the top level
		const bot = new Bot("test_token")
			.extend(withUser) // ← bot-level: adds withUser to bot's main chain
			.extend(scenes([testScene]))
			.on("message", async (ctx: any) => ctx.scene.enter(testScene));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("start");

		// Cross-chain dedup: scene.compose() detects withUser was already applied
		// in the bot chain and skips it → withUser runs exactly once.
		expect(callCount).toBe(1);
	});

	/**
	 * Recommended pattern to avoid double execution:
	 * Extend withUser ONLY at bot level. Scene handlers still access ctx.user
	 * because scene.run() receives the same context object that the bot's
	 * chain already mutated via Object.assign.
	 */
	it("withUser ONLY in bot chain → runs once, scene handler still sees ctx.user", async () => {
		let callCount = 0;
		let capturedUser: { id: number } | undefined;

		const withUser = new Composer({ name: "rt-bot-only" })
			.derive(() => {
				callCount++;
				return { user: { id: 42 } };
			})
			.as("scoped");

		// Scene does NOT extend withUser — no scene-level extend
		const testScene = new Scene("rt-bot-only-scene").step(
			"message",
			(ctx) => {
				if (ctx.scene.step.firstTime) {
					capturedUser = (ctx as any).user; // set by bot's withUser
					return ctx.send("ok");
				}
			},
		);

		const bot = new Bot("test_token")
			.extend(withUser) // bot-level only
			.extend(scenes([testScene]))
			.on("message", async (ctx: any) => ctx.scene.enter(testScene));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("start");

		// withUser ran exactly once (bot chain)
		expect(callCount).toBe(1);
		// The same context object is passed to scene.run(), so ctx.user is present
		expect(capturedUser).toEqual({ id: 42 });
	});

	/**
	 * Alternative: extend withUser ONLY in the scene.
	 * Bot's main chain knows nothing about ctx.user; it's set only inside scene.
	 */
	it("withUser ONLY in scene chain → runs once, only available inside scene", async () => {
		let callCount = 0;

		const withUser = new Composer({ name: "rt-scene-only" })
			.derive(() => {
				callCount++;
				return { user: { id: 7 } };
			})
			.as("scoped");

		let capturedUser: { id: number } | undefined;

		const testScene = new Scene("rt-scene-only-scene")
			.extend(withUser) // scene-level only
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					capturedUser = ctx.user;
					return ctx.send("ok");
				}
			});

		const env = makeEnv([testScene], async (ctx) => ctx.scene.enter(testScene));
		await env.createUser().sendMessage("start");

		expect(callCount).toBe(1);
		expect(capturedUser).toEqual({ id: 7 });
	});
});

describe("Scene.extend() — runtime: AnyPlugin", () => {
	it("Plugin derive is available in scene step handler", async () => {
		let capturedPluginData: string | undefined;

		const plugin = new Plugin("rt-test-plugin").derive(() => ({
			pluginData: "from-plugin",
		}));

		const testScene = new Scene("rt-plugin-scene")
			.extend(plugin)
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					capturedPluginData = (ctx as any).pluginData;
					return ctx.send("ok");
				}
			});

		const env = makeEnv([testScene], async (ctx) => ctx.scene.enter(testScene));
		await env.createUser().sendMessage("start");

		expect(capturedPluginData).toBe("from-plugin");
	});
});

describe("Scene.extend() — runtime: scope isolation", () => {
	it("derive WITHOUT .as('scoped') runs in isolation — does not write to real ctx", async () => {
		let capturedValue: string | undefined;

		const isolated = new Composer({ name: "rt-isolated" }).derive(
			() => ({ isolatedProp: "secret" }),
		); // no .as("scoped")

		const testScene = new Scene("rt-isolated-scene")
			.extend(isolated)
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					capturedValue = (ctx as any).isolatedProp;
					return ctx.send("ok");
				}
			});

		const env = makeEnv([testScene], async (ctx) => ctx.scene.enter(testScene));
		await env.createUser().sendMessage("hi");

		// Local (isolated) scope → derive writes to a copy, not the real context
		expect(capturedValue).toBeUndefined();
	});

	it("derive WITH .as('scoped') writes directly to real ctx", async () => {
		let capturedValue: string | undefined;

		const scoped = new Composer({ name: "rt-scoped" })
			.derive(() => ({ scopedProp: "visible" }))
			.as("scoped");

		const testScene = new Scene("rt-scoped-scene")
			.extend(scoped)
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					capturedValue = ctx.scopedProp;
					return ctx.send("ok");
				}
			});

		const env = makeEnv([testScene], async (ctx) => ctx.scene.enter(testScene));
		await env.createUser().sendMessage("hi");

		expect(capturedValue).toBe("visible");
	});
});

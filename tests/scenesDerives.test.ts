import { describe, expect, it } from "bun:test";
import { inMemoryStorage } from "@gramio/storage";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import { Scene, scenes, scenesDerives } from "../src/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeStorage() {
	return inMemoryStorage();
}

// ─── scenesDerives basic functionality ───────────────────────────────────────

describe("scenesDerives — context.scene is defined", () => {
	it("context.scene is available in .on() handler when scenesDerives is used before scenes", async () => {
		const storage = makeStorage();
		let sceneValue: unknown = "NOT_SET";

		const testScene = new Scene("test-derives-basic").step(
			"message",
			(ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("Step 0");
			},
		);

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([testScene], { storage, withCurrentScene: true }),
			)
			.on("message", (context, next) => {
				sceneValue = context.scene;
				return next();
			})
			.extend(scenes([testScene], { storage }));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("hi");

		expect(sceneValue).toBeDefined();
		expect(sceneValue).not.toBeUndefined();
		expect(typeof sceneValue).toBe("object");
	});

	it("context.scene.enter is a function when scenesDerives is used", async () => {
		const storage = makeStorage();
		let enterType: string | undefined;

		const testScene = new Scene("test-derives-enter-fn").step(
			"message",
			(ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			},
		);

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([testScene], { storage, withCurrentScene: true }),
			)
			.on("message", (context, next) => {
				enterType = typeof context.scene?.enter;
				return next();
			})
			.extend(scenes([testScene], { storage }));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("hi");

		expect(enterType).toBe("function");
	});

	it("context.scene.exit is a function when scenesDerives is used", async () => {
		const storage = makeStorage();
		let exitType: string | undefined;

		const testScene = new Scene("test-derives-exit-fn").step(
			"message",
			(ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			},
		);

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([testScene], { storage, withCurrentScene: true }),
			)
			.on("message", (context, next) => {
				exitType = typeof context.scene?.exit;
				return next();
			})
			.extend(scenes([testScene], { storage }));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("hi");

		expect(exitType).toBe("function");
	});
});

// ─── scenesDerives with enter/exit ────────────────────────────────────────────

describe("scenesDerives — enter and exit via derived context", () => {
	it("can enter a scene using context.scene.enter from scenesDerives", async () => {
		const storage = makeStorage();
		let stepReached = false;

		const testScene = new Scene("test-derives-can-enter").step(
			"message",
			(ctx) => {
				if (ctx.scene.step.firstTime) {
					stepReached = true;
					return ctx.send("In scene");
				}
			},
		);

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([testScene], { storage, withCurrentScene: true }),
			)
			.extend(scenes([testScene], { storage }))
			.on("message", async (ctx: any) => {
				await ctx.scene.enter(testScene);
			});

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("start");

		expect(stepReached).toBe(true);
	});

	it("can exit a scene using context.scene.exit from scenesDerives", async () => {
		const storage = makeStorage();
		let exitCalled = false;

		const testScene = new Scene("test-derives-can-exit").step(
			"message",
			async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("In scene");
				exitCalled = true;
				return ctx.scene.exit();
			},
		);

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([testScene], { storage, withCurrentScene: true }),
			)
			.extend(scenes([testScene], { storage }))
			.on("message", async (ctx: any) => {
				await ctx.scene.enter(testScene);
			});

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendMessage("start");
		await user.sendMessage("exit");

		expect(exitCalled).toBe(true);
	});
});

// ─── scenesDerives withCurrentScene ──────────────────────────────────────────

describe("scenesDerives — withCurrentScene option", () => {
	it("context.scene.current is undefined when no scene is active", async () => {
		const storage = makeStorage();
		let currentScene: unknown = "NOT_SET";

		const testScene = new Scene("test-derives-no-current").step(
			"message",
			(ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			},
		);

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([testScene], { storage, withCurrentScene: true }),
			)
			.on("message", (context, next) => {
				currentScene = (context.scene as any)?.current;
				return next();
			})
			.extend(scenes([testScene], { storage }));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("hi");

		expect(currentScene).toBeUndefined();
	});

	it("context.scene.current is defined when a scene is active", async () => {
		const storage = makeStorage();
		let currentScene: unknown;

		const testScene = new Scene("test-derives-with-current").step(
			"message",
			(ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			},
		);

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([testScene], { storage, withCurrentScene: true }),
			)
			.on("message", (context, next) => {
				currentScene = (context.scene as any)?.current;
				return next();
			})
			.extend(scenes([testScene], { storage }));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		// First: enter the scene
		bot.on("message", async (ctx: any) => {
			if (!currentScene) await ctx.scene.enter(testScene);
		});

		await user.sendMessage("enter");
		// Second message: scene is active, scenesDerives should see it
		currentScene = undefined;
		await user.sendMessage("check");

		expect(currentScene).toBeDefined();
	});

	it("throws when withCurrentScene is true but no scenes are provided", () => {
		const storage = makeStorage();

		expect(() =>
			scenesDerives({ storage, withCurrentScene: true }),
		).toThrow("scenes is required when withCurrentScene is true");
	});
});

// ─── scenesDerives without withCurrentScene ──────────────────────────────────

describe("scenesDerives — without withCurrentScene", () => {
	it("context.scene provides enter/exit even without withCurrentScene", async () => {
		const storage = makeStorage();
		let hasEnter = false;
		let hasExit = false;

		const testScene = new Scene("test-derives-no-wcs").step(
			"message",
			(ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			},
		);

		const bot = new Bot("test_token")
			.extend(scenesDerives([testScene], { storage }))
			.on("message", (context, next) => {
				hasEnter = typeof (context as any).scene?.enter === "function";
				hasExit = typeof (context as any).scene?.exit === "function";
				return next();
			})
			.extend(scenes([testScene], { storage }));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("hi");

		expect(hasEnter).toBe(true);
		expect(hasExit).toBe(true);
	});
});

// ─── scenesDerives with object options (single-arg form) ─────────────────────

describe("scenesDerives — single-argument (options object) form", () => {
	it("works with single options argument containing scenes array", async () => {
		const storage = makeStorage();
		let sceneValue: unknown = "NOT_SET";

		const testScene = new Scene("test-derives-single-arg").step(
			"message",
			(ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			},
		);

		const bot = new Bot("test_token")
			.extend(
				scenesDerives({
					scenes: [testScene],
					storage,
					withCurrentScene: true,
				}),
			)
			.on("message", (context, next) => {
				sceneValue = context.scene;
				return next();
			})
			.extend(scenes([testScene], { storage }));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("hi");

		expect(sceneValue).toBeDefined();
		expect(sceneValue).not.toBeUndefined();
	});
});

// ─── scenesDerives duplicate scene validation ────────────────────────────────

describe("scenesDerives — validation", () => {
	it("throws on duplicate scene names", () => {
		const storage = makeStorage();
		const a = new Scene("dup-derives");
		const b = new Scene("dup-derives");

		expect(() =>
			scenesDerives([a, b] as any[], { storage, withCurrentScene: true }),
		).toThrow();
	});
});

// ─── scenesDerives works on multiple event types ─────────────────────────────

describe("scenesDerives — multiple message events", () => {
	it("context.scene is defined across multiple message events", async () => {
		const storage = makeStorage();
		const sceneValues: unknown[] = [];

		const testScene = new Scene("test-derives-multi-msg").step(
			"message",
			(ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			},
		);

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([testScene], { storage, withCurrentScene: true }),
			)
			.on("message", (context, next) => {
				sceneValues.push(context.scene);
				return next();
			})
			.extend(scenes([testScene], { storage }));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();
		await user.sendMessage("first");
		await user.sendMessage("second");

		expect(sceneValues.length).toBe(2);
		expect(sceneValues[0]).toBeDefined();
		expect(sceneValues[1]).toBeDefined();
	});
});

// ─── scenesDerives shared storage with scenes ────────────────────────────────

describe("scenesDerives — shared storage with scenes plugin", () => {
	it("scenesDerives and scenes share storage correctly for scene navigation", async () => {
		const storage = makeStorage();
		const stepsReached: number[] = [];

		const testScene = new Scene("test-derives-shared-storage")
			.step("message", async (ctx) => {
				stepsReached.push(0);
				if (ctx.scene.step.firstTime) return ctx.send("Step 0");
				return ctx.scene.update({});
			})
			.step("message", (ctx) => {
				stepsReached.push(1);
				if (ctx.scene.step.firstTime) return ctx.send("Step 1");
			});

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([testScene], { storage, withCurrentScene: true }),
			)
			.extend(scenes([testScene], { storage }))
			.on("message", async (ctx: any) => {
				await ctx.scene.enter(testScene);
			});

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendMessage("enter");
		await user.sendMessage("advance");

		expect(stepsReached).toContain(0);
		expect(stepsReached).toContain(1);
	});

	it("scene entered via scenesDerives handler, multi-step flow works", async () => {
		const storage = makeStorage();
		let finalState: any;

		const testScene = new Scene("test-derives-multi-step")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("Enter name:");
				return ctx.scene.update({ name: "Alice" });
			})
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("Enter age:");
				return ctx.scene.update({ age: 30 });
			})
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					finalState = ctx.scene.state;
					return ctx.send("Done");
				}
			});

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([testScene], { storage, withCurrentScene: true }),
			)
			.extend(scenes([testScene], { storage }))
			.on("message", async (ctx: any) => {
				await ctx.scene.enter(testScene);
			});

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendMessage("start");
		await user.sendMessage("Alice");
		await user.sendMessage("30");

		expect(finalState).toMatchObject({ name: "Alice", age: 30 });
	});
});

// ─── Exact bug reproduction from issue #5 ────────────────────────────────────

describe("Issue #5 — scenesDerives context.scene is undefined", () => {
	it("reproduces the exact bug scenario from the issue", async () => {
		const storage = makeStorage();
		let sceneFromMiddleware: unknown = "NOT_SET";

		const testScene = new Scene("test").step("message", (context) =>
			context.send("Step 0"),
		);

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([testScene], { storage, withCurrentScene: true }),
			)
			.on("message", (context, next) => {
				sceneFromMiddleware = context.scene;
				return next();
			})
			.extend(scenes([testScene], { storage }))
			.command("start", async (context: any) =>
				context.scene.enter(testScene),
			);

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("hi");

		expect(sceneFromMiddleware).toBeDefined();
		expect(sceneFromMiddleware).not.toBeUndefined();
		expect(typeof sceneFromMiddleware).toBe("object");
		expect(typeof (sceneFromMiddleware as any).enter).toBe("function");
		expect(typeof (sceneFromMiddleware as any).exit).toBe("function");
	});
});

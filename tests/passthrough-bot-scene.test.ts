import { describe, expect, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import { Scene, scenes, scenesDerives } from "../src/index.js";

describe("passthrough: ctx.scene in bot-level handlers", () => {
	it("global command exits the scene and fires onExit", async () => {
		const events: string[] = [];

		const scene = new Scene("passthrough-exit")
			.onEnter(() => events.push("enter"))
			.onExit(() => events.push("exit"))
			.step("only", (c) =>
				c
					.enter((ctx) => ctx.send("hi"))
					// only claims callback_query — text messages fall through
					.on("callback_query", (ctx) => ctx.answerCallbackQuery()),
			);

		const bot = new Bot("test_token")
			.extend(scenes([scene] as any[]))
			.command("start", (ctx) => ctx.scene.enter(scene))
			.command("cancel", (ctx) => ctx.scene.exit())
			.on("message", () => events.push("outside"));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendCommand("cancel");
		// scene is really gone: the next message reaches the global handler
		await user.sendMessage("after");

		expect(events).toEqual(["enter", "exit", "outside"]);
	});

	it("keeps the active-scene handler (state/params/step) on the context", async () => {
		let seen: unknown;

		const scene = new Scene("passthrough-state")
			.params<{ id: number }>()
			.step("only", (c) =>
				c
					.enter((ctx) => ctx.scene.update({ typed: 1 }, {}))
					.on("callback_query", (ctx) => ctx.answerCallbackQuery()),
			);

		const bot = new Bot("test_token")
			.extend(scenes([scene] as any[]))
			.command("start", (ctx) => ctx.scene.enter(scene, { id: 7 }))
			.command("peek", (ctx) => {
				const s = ctx.scene as any;
				seen = { params: s.params, state: s.state, step: s.step?.id };
			});

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendCommand("peek");

		expect(seen).toEqual({
			params: { id: 7 },
			state: { typed: 1 },
			step: "only",
		});
	});

	it("exit() outside a scene is a no-op and does not throw", async () => {
		let result: unknown = "untouched";

		const scene = new Scene("never-entered").step("only", (c) =>
			c.on("message", (ctx) => ctx.send("hi")),
		);

		const bot = new Bot("test_token")
			.extend(scenes([scene] as any[]))
			.command("cancel", async (ctx) => {
				result = await ctx.scene.exit();
			});

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendCommand("cancel");

		expect(result).toBe(false);
	});

	it("scenesDerives: exit() fires onExit of the active scene", async () => {
		const events: string[] = [];

		const scene = new Scene("derives-exit")
			.onExit(() => events.push("exit"))
			.step("only", (c) =>
				c
					.enter((ctx) => ctx.send("hi"))
					.on("callback_query", (ctx) => ctx.answerCallbackQuery()),
			);

		const storage = (await import("@gramio/storage")).inMemoryStorage();

		const bot = new Bot("test_token")
			.extend(scenes([scene] as any[], { storage }))
			.extend(scenesDerives([scene] as any[], { storage }))
			.command("start", (ctx) => ctx.scene.enter(scene))
			.command("cancel", (ctx) => ctx.scene.exit());

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendCommand("cancel");

		expect(events).toEqual(["exit"]);
	});
});

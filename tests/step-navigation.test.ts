import { describe, expect, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import { Scene, scenes } from "../src/index.js";

describe("scene.step.next/previous/go — navigation", () => {
	it("step.next() advances by one in the sceneSteps array (named ids)", async () => {
		const log: string[] = [];

		const flow = new Scene("flow")
			.step("a", (c) =>
				c
					.enter((ctx) => {
						log.push("a:enter");
						return ctx.send("a");
					})
					.on("message", (ctx) => ctx.scene.step.next()),
			)
			.step("b", (c) =>
				c
					.enter((ctx) => {
						log.push("b:enter");
						return ctx.send("b");
					})
					.on("message", (ctx) => ctx.scene.step.next()),
			)
			.step("c", (c) =>
				c.enter((ctx) => {
					log.push("c:enter");
					return ctx.send("c");
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("→");
		await user.sendMessage("→");

		expect(log).toEqual(["a:enter", "b:enter", "c:enter"]);
	});

	it("step.previous() walks backward in the sceneSteps array", async () => {
		const log: string[] = [];

		const flow = new Scene("flow")
			.step("a", (c) =>
				c
					.enter((ctx) => {
						log.push(`a:enter:${ctx.scene.step.firstTime}`);
						return ctx.send("a");
					})
					.on("message", (ctx) => ctx.scene.step.next()),
			)
			.step("b", (c) =>
				c
					.enter(() => log.push("b:enter"))
					.on("message", (ctx) => ctx.scene.step.previous()),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start"); // a:enter:true
		await user.sendMessage("→"); // b:enter
		await user.sendMessage("←"); // a:enter:true (re-enters with firstTime=true by default in go)

		expect(log).toEqual(["a:enter:true", "b:enter", "a:enter:true"]);
	});

	it("step.go(name) jumps to a named step by id", async () => {
		const log: string[] = [];

		const flow = new Scene("flow")
			.step("a", (c) =>
				c
					.enter(() => log.push("a:enter"))
					.on("message", (ctx) => ctx.scene.step.go("c")),
			)
			.step("b", (c) => c.enter(() => log.push("b:enter")))
			.step("c", (c) =>
				c.enter((ctx) => {
					log.push("c:enter");
					return ctx.send("c");
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("→");

		expect(log).toEqual(["a:enter", "c:enter"]);
	});

	it("step.go(N) accepts numeric ids alongside string ones", async () => {
		const log: string[] = [];

		const flow = new Scene("flow")
			.step((c) =>
				c
					.enter(() => log.push("0:enter"))
					.on("message", (ctx) => ctx.scene.step.go(2)),
			)
			.step((c) => c.enter(() => log.push("1:enter")))
			.step((c) =>
				c.enter((ctx) => {
					log.push("2:enter");
					return ctx.send("at 2");
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("jump");

		expect(log).toEqual(["0:enter", "2:enter"]);
	});

	it("step.next() throws when there is no next step", async () => {
		let caught: Error | null = null;

		const flow = new Scene("flow").step("only", (c) =>
			c.enter((ctx) => ctx.send("a")).on("message", async (ctx) => {
				try {
					await ctx.scene.step.next();
				} catch (e) {
					caught = e as Error;
				}
			}),
		);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("oops");

		expect(caught).toBeInstanceOf(Error);
		expect(caught!.message).toMatch(/no next step/);
	});

	it("step.previous() throws on the first step", async () => {
		let caught: Error | null = null;

		const flow = new Scene("flow")
			.step("only", (c) =>
				c.enter((ctx) => ctx.send("a")).on("message", async (ctx) => {
					try {
						await ctx.scene.step.previous();
					} catch (e) {
						caught = e as Error;
					}
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("←");

		expect(caught).toBeInstanceOf(Error);
		expect(caught!.message).toMatch(/no previous step/);
	});

	it("step.id and step.previousId are tracked through transitions", async () => {
		const log: Array<[unknown, unknown]> = [];

		const flow = new Scene("flow")
			.step("first", (c) =>
				c
					.enter((ctx) => {
						log.push([ctx.scene.step.previousId, ctx.scene.step.id]);
						return ctx.send("a");
					})
					.on("message", (ctx) => ctx.scene.step.go("second")),
			)
			.step("second", (c) =>
				c.enter((ctx) => {
					log.push([ctx.scene.step.previousId, ctx.scene.step.id]);
					return ctx.send("b");
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("→");

		expect(log).toEqual([
			["first", "first"], // initial entry — previous == current
			["first", "second"],
		]);
	});
});

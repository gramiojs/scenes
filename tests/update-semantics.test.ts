import { describe, expect, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import { Scene, scenes } from "../src/index.js";

describe("ctx.scene.update() — auto-advance and explicit options", () => {
	it("update({...}) auto-advances to next named builder step", async () => {
		const log: string[] = [];

		const flow = new Scene("flow")
			.step("review", (c) =>
				c
					.enter((ctx) => {
						log.push("review:enter");
						return ctx.send("Order ok?");
					})
					.on("message", (ctx) => {
						log.push("review:msg");
						return ctx.scene.update({ ack: true });
					}),
			)
			.step("complete", (c) =>
				c.enter((ctx) => {
					log.push("complete:enter");
					log.push(`state:${JSON.stringify(ctx.scene.state)}`);
					return ctx.send("Done!");
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("ok");

		expect(log).toEqual([
			"review:enter",
			"review:msg",
			"complete:enter",
			'state:{"ack":true}',
		]);
	});

	it("update({...}) bridges across .extend(otherScene) merged steps", async () => {
		const log: string[] = [];

		// Reusable "confirm" module
		const confirm = new Scene().step("confirm", (c) =>
			c
				.enter((ctx) => {
					log.push("confirm:enter");
					return ctx.send("Sure?");
				})
				.on("message", (ctx) => ctx.scene.update({ confirmed: true })),
		);

		const checkout = new Scene("checkout")
			.step("review", (c) =>
				c
					.enter((ctx) => {
						log.push("review:enter");
						return ctx.send("review");
					})
					.on("message", (ctx) => ctx.scene.update({ ack: true })),
			)
			.extend(confirm)
			.step("complete", (c) =>
				c.enter((ctx) => {
					log.push("complete:enter");
					log.push(JSON.stringify(ctx.scene.state));
					return ctx.send("Done!");
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([checkout] as any[]))
			.command("start", (ctx) => ctx.scene.enter(checkout));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start"); // review:enter
		await user.sendMessage("ok"); // review msg → update → confirm:enter
		await user.sendMessage("yes"); // confirm msg → update → complete:enter

		expect(log).toEqual([
			"review:enter",
			"confirm:enter",
			"complete:enter",
			'{"ack":true,"confirmed":true}',
		]);
	});

	it("update({...}) with explicit step → jumps to that step (named)", async () => {
		const log: string[] = [];

		const flow = new Scene("flow")
			.step("a", (c) =>
				c.enter((ctx) => log.push("a:enter")).on("message", (ctx) =>
					ctx.scene.update({ from: "a" }, { step: "c" }),
				),
			)
			.step("b", (c) =>
				c.enter((ctx) => log.push("b:enter")).on("message", () => undefined),
			)
			.step("c", (c) =>
				c.enter((ctx) => {
					log.push("c:enter");
					return ctx.send("at c");
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("skip-b");

		expect(log).toEqual(["a:enter", "c:enter"]);
	});

	it("update({...}) without step on the LAST step persists state without throwing", async () => {
		const log: string[] = [];
		let savedState: any;

		const flow = new Scene("flow").step("only", (c) =>
			c
				.enter((ctx) => {
					log.push("enter");
					return ctx.send("hi");
				})
				.on("message", async (ctx) => {
					log.push("msg");
					await ctx.scene.update({ touched: true });
					savedState = ctx.scene.state;
				}),
		);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("touch");

		expect(log).toEqual(["enter", "msg"]);
		expect(savedState).toEqual({ touched: true });
	});

	it("update({...}, { step: number }) jumps to numeric step", async () => {
		const log: string[] = [];

		const flow = new Scene("flow")
			.step((c) =>
				c.enter((ctx) => log.push("0:enter")).on("message", (ctx) =>
					ctx.scene.update({}, { step: 2 }),
				),
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

	it("update(state) accumulates state across steps (shallow merge)", async () => {
		let final: any;

		const flow = new Scene("flow")
			.step("first", (c) =>
				c
					.enter((ctx) => ctx.send("a"))
					.on("message", (ctx) =>
						ctx.scene.update({ name: "Alice", age: 30 }),
					),
			)
			.step("second", (c) =>
				c
					.enter((ctx) => ctx.send("b"))
					.on("message", (ctx) =>
						ctx.scene.update({ city: "NYC", age: 31 }),
					),
			)
			.step("third", (c) =>
				c.enter((ctx) => {
					final = { ...ctx.scene.state };
					return ctx.send("done");
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("a");
		await user.sendMessage("b");

		// age overwritten, name kept, city added
		expect(final).toEqual({ name: "Alice", age: 31, city: "NYC" });
	});

	it("update({}, { firstTime: false }) suppresses the next step's enter hook", async () => {
		const log: string[] = [];

		const flow = new Scene("flow")
			.step("a", (c) =>
				c
					.enter(() => log.push("a:enter"))
					.on("message", (ctx) =>
						ctx.scene.update({}, { step: "b", firstTime: false }),
					),
			)
			.step("b", (c) =>
				c
					.enter(() => log.push("b:enter")) // should NOT fire
					.on("message", (ctx) => {
						log.push("b:msg");
						return ctx.scene.exit();
					}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("go");
		await user.sendMessage("hit b");

		expect(log).toEqual(["a:enter", "b:msg"]);
	});
});

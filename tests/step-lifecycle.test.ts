import { describe, expect, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import { Scene, scenes } from "../src/index.js";

describe("StepComposer lifecycle hooks (.enter / .message / .fallback)", () => {
	it(".enter() runs once on firstTime, never again on the same step", async () => {
		let enterCount = 0;
		let msgCount = 0;

		const flow = new Scene("flow").step("only", (c) =>
			c
				.enter((ctx) => {
					enterCount++;
					return ctx.send("hi");
				})
				.on("message", (ctx) => {
					msgCount++;
					if (msgCount >= 3) return ctx.scene.exit();
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
		await user.sendMessage("c");

		expect(enterCount).toBe(1);
		expect(msgCount).toBe(3);
	});

	it(".message(text) sends text on first entry; same as .enter(ctx => ctx.send(text))", async () => {
		const flow = new Scene("flow").step("only", (c) =>
			c.message("welcome").on("message", (ctx) => ctx.scene.exit()),
		);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "welcome",
		});
	});

	it(".message(factory) receives ctx and returns dynamic text", async () => {
		const flow = new Scene("greet")
			.params<{ name: string }>()
			.step("only", (c) =>
				c
					.message(
						(ctx: any) => `hello ${(ctx.scene.params as { name: string }).name}!`,
					)
					.on("message", (ctx) => ctx.scene.exit()),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow, { name: "Alice" }));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "hello Alice!",
		});
	});

	it(".message + .enter both run if both declared (.message first, .enter after)", async () => {
		const log: string[] = [];

		const flow = new Scene("flow").step("only", (c) =>
			c
				.message("greeting")
				.enter((ctx) => {
					log.push("enter");
					return ctx.send("follow-up");
				})
				.on("message", (ctx) => ctx.scene.exit()),
		);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");

		const calls = env.apiCalls.filter((c) => c.method === "sendMessage");
		expect(calls.map((c: any) => c.params.text)).toEqual([
			"greeting",
			"follow-up",
		]);
		expect(log).toEqual(["enter"]);
	});

	it(".fallback() fires when no .on/.command/.callbackQuery matched", async () => {
		const log: string[] = [];

		const flow = new Scene("flow").step("only", (c) =>
			c
				.enter((ctx) => ctx.send("send 'go'"))
				.command("go", (ctx) => {
					log.push("matched:go");
					return ctx.scene.exit();
				})
				.fallback((ctx) => {
					log.push(`fallback:${(ctx as any).text}`);
				}),
		);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("nope"); // no match → fallback
		await user.sendMessage("also nope"); // fallback again
		await user.sendCommand("go"); // matched → exit

		expect(log).toEqual(["fallback:nope", "fallback:also nope", "matched:go"]);
	});

	it(".command() inside step builder is scoped to the step (not global)", async () => {
		const log: string[] = [];

		const flow = new Scene("flow")
			.step("first", (c) =>
				c
					.enter((ctx) => ctx.send("step 1, send /skip"))
					.command("skip", (ctx) => {
						log.push("first:skip");
						return ctx.scene.step.next();
					}),
			)
			.step("second", (c) =>
				c
					.enter((ctx) => ctx.send("step 2"))
					.command("skip", () => log.push("second:skip"))
					.on("message", (ctx) => ctx.scene.exit()),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendCommand("skip"); // first:skip → next
		await user.sendCommand("skip"); // second:skip
		await user.sendMessage("done");

		expect(log).toEqual(["first:skip", "second:skip"]);
	});

	it("scene-level .command works as escape hatch from any builder step", async () => {
		const log: string[] = [];

		const flow = new Scene("flow")
			.command("cancel", (ctx) => {
				log.push("cancel");
				return ctx.scene.exit();
			})
			.step("first", (c) =>
				c
					.enter(() => log.push("first:enter"))
					.on("message", (ctx) => ctx.scene.step.next()),
			)
			.step("second", (c) =>
				c
					.enter(() => log.push("second:enter"))
					.on("message", (ctx) => ctx.scene.step.next()),
			)
			.step("third", (c) => c.enter(() => log.push("third:enter")));

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("a");
		await user.sendCommand("cancel"); // global escape from second

		expect(log).toEqual(["first:enter", "second:enter", "cancel"]);
	});

	it("scene-level .derive() values flow into step's .enter handler on firstTime", async () => {
		const seen: string[] = [];

		const flow = new Scene("flow")
			.derive(() => ({ stamp: "X" }))
			.step("only", (c) =>
				c
					.enter((ctx: any) => {
						seen.push(`enter:${ctx.stamp}`);
						return ctx.send("hi");
					})
					.on("message", (ctx) => ctx.scene.exit()),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("end");

		expect(seen).toEqual(["enter:X"]);
	});

	it("step-local .derive() values flow into step's .enter and .on handlers", async () => {
		const seen: string[] = [];

		const flow = new Scene("flow").step("only", (c) =>
			c
				.derive(() => ({ stepLocalId: 42 }))
				.enter((ctx: any) => {
					seen.push(`enter:${ctx.stepLocalId}`);
					return ctx.send("hi");
				})
				.on("message", (ctx: any) => {
					seen.push(`msg:${ctx.stepLocalId}`);
					return ctx.scene.exit();
				}),
		);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("end");

		expect(seen).toEqual(["enter:42", "msg:42"]);
	});
});

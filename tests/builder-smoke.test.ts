import { describe, expect, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import { Scene, scenes } from "../src/index.js";

describe("step builder API (smoke)", () => {
	it("c.enter() runs once on firstTime, then c.on() handles subsequent input", async () => {
		const seen: string[] = [];

		const greeting = new Scene("greeting").step("intro", (c) =>
			c
				.enter((ctx) => {
					seen.push("enter");
					return ctx.send("hi! what's your name?");
				})
				.on("message", (ctx) => {
					seen.push(`msg:${ctx.text}`);
					return ctx.scene.exit();
				}),
		);

		const bot = new Bot("test_token")
			.extend(scenes([greeting] as any[]))
			.command("start", (ctx) => ctx.scene.enter(greeting));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("Alice");

		expect(seen).toEqual(["enter", "msg:Alice"]);
	});

	it("c.message(text) is sugar over c.enter(ctx => ctx.send(text))", async () => {
		const greeting = new Scene("hello").step("hi", (c) =>
			c.message("hello!").on("message", (ctx) => ctx.scene.exit()),
		);

		const bot = new Bot("test_token")
			.extend(scenes([greeting] as any[]))
			.command("start", (ctx) => ctx.scene.enter(greeting));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");

		const last = env.lastApiCall("sendMessage");
		expect(last?.params).toMatchObject({ text: "hello!" });
	});

	it("named step navigation: scene.step.next() walks the steps array", async () => {
		const flow = new Scene("flow")
			.step("first", (c) =>
				c
					.enter((ctx) => ctx.send("step 1"))
					.on("message", (ctx) => ctx.scene.step.next()),
			)
			.step("second", (c) =>
				c
					.enter((ctx) => ctx.send("step 2"))
					.on("message", (ctx) => ctx.scene.exit()),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "step 1",
		});

		await user.sendMessage("ok"); // first.on → step.next() → enter step 2
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "step 2",
		});
	});

	it("legacy step('message', handler) form still works alongside builder", async () => {
		const seen: string[] = [];
		const legacy = new Scene("legacy").step("message", (ctx) => {
			if (ctx.scene.step.firstTime) return; // skip entry message — legacy convention
			seen.push(ctx.text ?? "");
			return ctx.scene.exit();
		});

		const bot = new Bot("test_token")
			.extend(scenes([legacy] as any[]))
			.command("start", (ctx) => ctx.scene.enter(legacy));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("hi");

		expect(seen).toEqual(["hi"]);
	});

	it("scene-level .command works inside a builder step (escape hatch)", async () => {
		const events: string[] = [];

		const flow = new Scene("flow")
			.command("cancel", (ctx) => {
				events.push("cancel");
				return ctx.scene.exit();
			})
			.step("only", (c) =>
				c
					.enter((ctx) => ctx.send("send anything"))
					.on("message", (ctx) => {
						events.push(`msg:${ctx.text}`);
					}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendCommand("cancel");

		expect(events).toContain("cancel");
	});

	it("named-step collision throws", () => {
		expect(() => {
			new Scene("dup")
				.step("foo", (c) => c.message("a"))
				.step("foo", (c) => c.message("b"));
		}).toThrow(/already exists/);
	});

	it("step number assignment is sequential for unnamed builder steps", async () => {
		const flow = new Scene("nums")
			.step((c) =>
				c
					.enter((ctx) => ctx.send("a"))
					.on("message", (ctx) => ctx.scene.step.next()),
			)
			.step((c) =>
				c.enter((ctx) => ctx.send("b")).on("message", (ctx) => ctx.scene.exit()),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({ text: "a" });

		await user.sendMessage("ok");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({ text: "b" });
	});
});

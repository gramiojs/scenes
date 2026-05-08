import { describe, expect, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot, Plugin } from "gramio";
import { Scene, scenes } from "../src/index.js";

describe("Scene IS an EventComposer — full DSL on Scene", () => {
	it("scene.derive() values flow into every step's handlers (subsequent updates)", async () => {
		const seen: string[] = [];

		const flow = new Scene("flow")
			.derive(() => ({ stamp: "X" }))
			.step("only", (c) =>
				c
					.enter((ctx: any) => {
						seen.push(`enter:${ctx.stamp}`);
						return ctx.send("hi");
					})
					.on("message", (ctx: any) => {
						seen.push(`msg:${ctx.stamp}`);
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

		expect(seen).toEqual(["enter:X", "msg:X"]);
	});

	it("scene.decorate() adds static deps to ctx", async () => {
		const seen: string[] = [];

		const config = { tier: "premium" };

		const flow = new Scene("flow")
			.decorate({ config })
			.step("only", (c) =>
				c.enter((ctx: any) => {
					seen.push(`tier:${ctx.config.tier}`);
					return ctx.scene.exit();
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendCommand("start");

		expect(seen).toEqual(["tier:premium"]);
	});

	it("scene-level .callbackQuery(string) handles button click while in a builder step", async () => {
		const seen: string[] = [];

		const flow = new Scene("flow")
			.callbackQuery("yes", (ctx) => {
				seen.push("scene-cb:yes");
				return ctx.scene.exit();
			})
			.step("only", (c) =>
				c.enter((ctx: any) =>
					ctx.send("press a button", {
						reply_markup: {
							inline_keyboard: [[{ text: "Yes", callback_data: "yes" }]],
						},
					}),
				),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.click("yes");

		expect(seen).toEqual(["scene-cb:yes"]);
	});

	it("scene.hears() matches inside any builder step", async () => {
		const seen: string[] = [];

		const flow = new Scene("flow")
			.hears(/^skip$/i, (ctx) => {
				seen.push("hears:skip");
				return ctx.scene.exit();
			})
			.step("only", (c) =>
				c
					.enter((ctx: any) => ctx.send("type 'skip' to bail"))
					.on("message", (ctx) => {
						seen.push(`msg:${ctx.text}`);
					}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("hello"); // → on(message): msg:hello
		await user.sendMessage("SKIP"); // → hears: hears:skip → exit (no msg)

		expect(seen).toEqual(["msg:hello", "hears:skip"]);
	});

	it("scene.guard(pred) gate-mode: predicate false stops the chain (step.enter not called)", async () => {
		const seen: string[] = [];

		const flow = new Scene("admin-only")
			.guard(() => false) // single-arg → gate mode
			.step("only", (c) =>
				c.enter((ctx: any) => {
					seen.push("entered");
					return ctx.scene.exit();
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendCommand("start");

		expect(seen).not.toContain("entered");
	});

	it("scene.guard(pred) gate-mode: predicate true lets step.enter run", async () => {
		const seen: string[] = [];

		const flow = new Scene("admin-only")
			.guard(() => true)
			.step("only", (c) =>
				c.enter((ctx: any) => {
					seen.push("entered");
					return ctx.scene.exit();
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendCommand("start");

		expect(seen).toEqual(["entered"]);
	});

	it("scene.guard(pred, mw) conditional-mode: extra middleware runs only when pred true", async () => {
		const seen: string[] = [];

		// Conditional-middleware form: pred true → run extra mw, then ALWAYS call next.
		const flow = new Scene("flow")
			.guard(
				() => true,
				(ctx, next) => {
					seen.push("extra-mw");
					return next();
				},
			)
			.step("only", (c) =>
				c.enter(() => {
					seen.push("entered");
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendCommand("start");

		expect(seen).toEqual(["extra-mw", "entered"]);
	});

	it("scene.extend(plugin) brings plugin derives into step ctx (firstTime)", async () => {
		const seen: string[] = [];

		const withTag = new Plugin("with-tag").derive(() => ({ tag: "★" }));

		const flow = new Scene("flow")
			.extend(withTag)
			.step("only", (c) =>
				c.enter((ctx: any) => {
					seen.push(`enter:${ctx.tag}`);
					return ctx.scene.exit();
				}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendCommand("start");

		expect(seen).toEqual(["enter:★"]);
	});

	it("scene-level .command runs before step-level handlers (registration order wins)", async () => {
		const seen: string[] = [];

		const flow = new Scene("flow")
			.command("ping", (ctx) => {
				seen.push("scene:ping");
			})
			.step("only", (c) =>
				c
					.enter((ctx: any) => ctx.send("type /ping"))
					.command("ping", (ctx) => {
						seen.push("step:ping");
						return ctx.scene.exit();
					}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendCommand("ping");

		// Scene-level .command runs first (it's part of the outer chain). When
		// it claims the update (no next() call), the step composer never runs.
		// This is the expected "first match wins" behavior.
		expect(seen).toEqual(["scene:ping"]);
	});

	it("step-level .callbackQuery handles button clicks scoped to that step", async () => {
		const seen: string[] = [];

		const flow = new Scene("flow").step("only", (c) =>
			c
				.enter((ctx: any) =>
					ctx.send("press a button", {
						reply_markup: {
							inline_keyboard: [[{ text: "Yes", callback_data: "yes" }]],
						},
					}),
				)
				.callbackQuery("yes", (ctx) => {
					seen.push("step-yes");
					return ctx.scene.exit();
				}),
		);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.click("yes");

		expect(seen).toEqual(["step-yes"]);
	});
});

import { describe, expect, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import { Scene, scenes } from "../src/index.js";

describe("scene.extend(otherScene) merges step modules", () => {
	it("merges named steps from a step module into a named scene", async () => {
		const seen: string[] = [];

		// Step module: no name → cannot be entered directly, only .extend()-ed
		const confirm = new Scene().step("confirm", (c) =>
			c
				.enter((ctx) => {
					seen.push("confirm:enter");
					return ctx.send("Are you sure?");
				})
				.on("message", (ctx) => {
					seen.push(`confirm:reply:${ctx.text}`);
					return ctx.scene.exit();
				}),
		);

		const checkout = new Scene("checkout")
			.step("review", (c) =>
				c
					.enter((ctx) => {
						seen.push("review:enter");
						return ctx.send("Order looks good?");
					})
					.on("message", (ctx) => {
						seen.push("review:reply");
						return ctx.scene.step.next();
					}),
			)
			.extend(confirm);

		const bot = new Bot("test_token")
			.extend(scenes([checkout] as any[]))
			.command("start", (ctx) => ctx.scene.enter(checkout));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");      // → review:enter
		await user.sendMessage("ok");         // → review:reply → step.next() → confirm:enter
		await user.sendMessage("yes");        // → confirm:reply:yes → exit

		expect(seen).toEqual([
			"review:enter",
			"review:reply",
			"confirm:enter",
			"confirm:reply:yes",
		]);
	});

	it("renumbers numeric step ids on merge", async () => {
		const partA = new Scene().step((c) =>
			c.message("a0").on("message", (ctx) => ctx.scene.step.next()),
		);
		const partB = new Scene().step((c) =>
			c.message("b0").on("message", (ctx) => ctx.scene.exit()),
		);

		const merged = new Scene("merged").extend(partA).extend(partB);

		// Numeric ids should be 0 and 1 after renumber
		expect(merged["~scene"].steps.map((s) => s.id)).toEqual([0, 1]);

		const bot = new Bot("test_token")
			.extend(scenes([merged] as any[]))
			.command("start", (ctx) => ctx.scene.enter(merged));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({ text: "a0" });

		await user.sendMessage("next");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({ text: "b0" });
	});

	it("named-step collision across scenes throws on extend()", () => {
		const partA = new Scene().step("foo", (c) => c.message("a"));
		const partB = new Scene().step("foo", (c) => c.message("b"));

		expect(() => new Scene("merged").extend(partA).extend(partB)).toThrow(
			/already exists/,
		);
	});

	it("registering an unnamed Scene throws", () => {
		const moduleOnly = new Scene().step("x", (c) => c.message("hello"));

		expect(() => {
			new Bot("test_token").extend(scenes([moduleOnly] as any[]));
		}).toThrow(/unnamed Scene|step module/);
	});

	it("plugin .extend() path still works (no scene merge)", async () => {
		const seen: string[] = [];

		const scene = new Scene("plugin-extend")
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
			.extend(scenes([scene] as any[]))
			.command("start", (ctx) => ctx.scene.enter(scene));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		expect(seen).toEqual(["enter:X"]);
	});
});

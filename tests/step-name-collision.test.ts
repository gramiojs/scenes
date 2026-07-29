/**
 * Step names that look like Telegram update names.
 *
 * `scene.step(name, builder)` and `scene.step(event, handler)` share a
 * signature, so the first argument is what routes the call. The reserved set
 * is the frozen `events` list in `utils.ts` — NOT the whole `UpdateName`
 * union, which grows with every Bot API release (10.1 added `subscription`).
 * These tests pin the split: a step name that happens to be a newer update
 * name is a plain builder step, at runtime and at the type level alike.
 */

import { describe, expect, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import { Scene, scenes } from "../src/index.js";

describe("step names colliding with the event taxonomy", () => {
	it("an update name outside the reserved list registers as a builder step", async () => {
		const seen: string[] = [];

		// "gift" is a real UpdateName (a MessageEventName) but isn't reserved.
		const flow = new Scene("gifts").step("gift", (c) =>
			c.message("what do you want?").on("message", (ctx) => {
				seen.push(`msg:${ctx.text}`);
				return ctx.scene.exit();
			}),
		);

		const entry = flow["~scene"].steps[0]!;
		expect(entry.id).toBe("gift");
		expect(entry.legacy).toBeUndefined();

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "what do you want?",
		});

		await user.sendMessage("socks");
		expect(seen).toEqual(["msg:socks"]);
	});

	it("step({ name }, builder) forces the builder form for a reserved name", async () => {
		const seen: string[] = [];

		const flow = new Scene("delivery").step({ name: "location" }, (c) =>
			c.message("where to?").on("message", (ctx) => {
				seen.push(`msg:${ctx.text}`);
				return ctx.scene.exit();
			}),
		);

		const entry = flow["~scene"].steps[0]!;
		expect(entry.id).toBe("location");
		expect(entry.legacy).toBeUndefined();

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "where to?",
		});

		await user.sendMessage("home");
		expect(seen).toEqual(["msg:home"]);
	});

	it("step({ name }, builder) rejects an empty name", () => {
		expect(() =>
			new Scene("bad").step({ name: "" } as { name: string }, (c) => c),
		).toThrow(/non-empty string name/);
	});

	it("a reserved event name still registers the legacy step", async () => {
		const seen: string[] = [];

		const flow = new Scene("legacy").step("message", (ctx) => {
			if (ctx.scene.step.firstTime) return ctx.send("name?");
			seen.push(`msg:${ctx.text}`);
			return ctx.scene.exit();
		});

		const entry = flow["~scene"].steps[0]!;
		expect(entry.legacy).toBe(true);

		const bot = new Bot("test_token")
			.extend(scenes([flow] as any[]))
			.command("start", (ctx) => ctx.scene.enter(flow));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("Alice");

		expect(seen).toEqual(["msg:Alice"]);
	});
});

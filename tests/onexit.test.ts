import { describe, expect, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import { Scene, scenes } from "../src/index.js";

describe("scene.onExit hook", () => {
	it("fires on ctx.scene.exit() before storage cleanup", async () => {
		const events: string[] = [];

		const scene = new Scene("with-exit")
			.onEnter(() => events.push("enter"))
			.onExit(() => events.push("exit"))
			.step("only", (c) =>
				c
					.enter((ctx) => ctx.send("hi"))
					.on("message", (ctx) => ctx.scene.exit()),
			);

		const bot = new Bot("test_token")
			.extend(scenes([scene] as any[]))
			.command("start", (ctx) => ctx.scene.enter(scene));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("done");

		expect(events).toEqual(["enter", "exit"]);
	});

	it("fires on ctx.scene.reenter()", async () => {
		const events: string[] = [];

		let count = 0;
		const scene = new Scene("reenter-scene")
			.onEnter(() => events.push(`enter#${++count}`))
			.onExit(() => events.push("exit"))
			.step("only", (c) =>
				c
					.enter((ctx) => ctx.send("hi"))
					.on("message", (ctx) => {
						if (count === 1) return ctx.scene.reenter();
						return ctx.scene.exit();
					}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([scene] as any[]))
			.command("start", (ctx) => ctx.scene.enter(scene));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");      // enter#1
		await user.sendMessage("again");      // exit, enter#2
		await user.sendMessage("bye");        // exit

		expect(events).toEqual(["enter#1", "exit", "enter#2", "exit"]);
	});

	it("fires on ctx.scene.exitSub() before merging back to parent", async () => {
		const events: string[] = [];

		const child = new Scene("child")
			.onEnter(() => events.push("child:enter"))
			.onExit(() => events.push("child:exit"))
			.step("only", (c) =>
				c
					.enter((ctx) => ctx.send("child"))
					.on("message", (ctx) => ctx.scene.exitSub()),
			);

		let parentMsgCount = 0;
		const parent = new Scene("parent")
			.onEnter(() => events.push("parent:enter"))
			.onExit(() => events.push("parent:exit"))
			.step("only", (c) =>
				c
					.enter((ctx) => ctx.send("parent"))
					.on("message", (ctx) => {
						parentMsgCount++;
						if (parentMsgCount === 1) return ctx.scene.enterSub(child);
						return ctx.scene.exit();
					}),
			);

		const bot = new Bot("test_token")
			.extend(scenes([parent, child] as any[]))
			.command("start", (ctx) => ctx.scene.enter(parent));

		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendCommand("start");      // parent:enter
		await user.sendMessage("dive");       // parent's on-msg #1 → enterSub(child) → child:enter
		await user.sendMessage("come back");  // child's on-msg → exitSub → child:exit; parent on-msg #2 → exit → parent:exit

		expect(events).toEqual([
			"parent:enter",
			"child:enter",
			"child:exit",
			"parent:exit",
		]);
	});

	it("scene.extend() copies onExit when target has none", () => {
		let exited = false;
		const m = new Scene().onExit(() => {
			exited = true;
		});

		const main = new Scene("main").extend(m);
		main["~scene"].exit?.({} as any);

		expect(exited).toBe(true);
	});
});

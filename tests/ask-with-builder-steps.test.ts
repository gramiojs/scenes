import { describe, expect, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import { Scene, scenes } from "../src/index.js";

/** Minimal StandardSchema v1 validator that checks string length. */
const strMin = (min: number) => ({
	"~standard": {
		version: 1 as const,
		vendor: "test",
		validate: (v: unknown) =>
			typeof v === "string" && v.length >= min
				? { value: v as string }
				: { issues: [{ message: `Need ≥${min} chars` }] },
	},
});

function makeEnv(sceneList: Scene<any, any, any, any>[], scene: any) {
	const bot = new Bot("test_token")
		.extend(scenes(sceneList as any[]))
		.command("start", (ctx) => ctx.scene.enter(scene));
	return new TelegramTestEnvironment(bot as any);
}

// `.ask()` is sugar over a legacy event-filtered step. Legacy steps used to be
// absent from `~scene.steps`, so any scene mixing `.ask()` with builder steps
// walked right past the ask.
describe(".ask() mixed with builder steps", () => {
	it("ask registered first is entered first, not the following builder step", async () => {
		const seen: string[] = [];

		const scene = new Scene("ask-first")
			.ask("lastName", strMin(2), "Last name:")
			.step("done", (c) =>
				c.enter((ctx) => {
					seen.push(`done:${(ctx as any).scene.state.lastName}`);
					return ctx.send("thanks");
				}),
			);

		const env = makeEnv([scene], scene);
		const user = env.createUser();

		await user.sendCommand("start");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "Last name:",
		});
		expect(seen).toEqual([]);

		await user.sendMessage("Ivanov");
		expect(seen).toEqual(["done:Ivanov"]);
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "thanks",
		});
	});

	it("step.next() into an ask sitting between two builder steps", async () => {
		const seen: string[] = [];

		const scene = new Scene("ask-middle")
			.step("intro", (c) =>
				c
					.enter((ctx) => ctx.send("press go"))
					.on("message", (ctx) => ctx.scene.step.next()),
			)
			.ask("lastName", strMin(2), "Last name:")
			.step("done", (c) =>
				c.enter((ctx) => {
					seen.push(`done:${(ctx as any).scene.state.lastName}`);
					return ctx.send("thanks");
				}),
			);

		const env = makeEnv([scene], scene);
		const user = env.createUser();

		await user.sendCommand("start");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "press go",
		});

		await user.sendMessage("go");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "Last name:",
		});
		expect(seen).toEqual([]);

		await user.sendMessage("Ivanov");
		expect(seen).toEqual(["done:Ivanov"]);
	});

	it("invalid input keeps the user on the ask instead of advancing", async () => {
		const seen: string[] = [];

		const scene = new Scene("ask-invalid")
			.ask("lastName", strMin(3), "Last name:")
			.step("done", (c) =>
				c.enter((ctx) => {
					seen.push("done");
					return ctx.send("thanks");
				}),
			);

		const env = makeEnv([scene], scene);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("x");

		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "Need ≥3 chars",
		});
		expect(seen).toEqual([]);

		await user.sendMessage("Ivanov");
		expect(seen).toEqual(["done"]);
	});

	it("consecutive asks between builder steps each get their turn", async () => {
		const seen: string[] = [];

		const scene = new Scene("ask-chain")
			.ask("first", strMin(2), "First name:")
			.ask("last", strMin(2), "Last name:")
			.step("done", (c) =>
				c.enter((ctx) => {
					const state = (ctx as any).scene.state;
					seen.push(`${state.first} ${state.last}`);
					return ctx.send("thanks");
				}),
			);

		const env = makeEnv([scene], scene);
		const user = env.createUser();

		await user.sendCommand("start");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "First name:",
		});

		await user.sendMessage("Ivan");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "Last name:",
		});

		await user.sendMessage("Ivanov");
		expect(seen).toEqual(["Ivan Ivanov"]);
	});

	it("step.previous() from a builder step lands back on the ask", async () => {
		const scene = new Scene("ask-back")
			.ask("lastName", strMin(2), "Last name:")
			.step("confirm", (c) =>
				c
					.enter((ctx) => ctx.send("confirm?"))
					.on("message", (ctx) => ctx.scene.step.previous()),
			);

		const env = makeEnv([scene], scene);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("Ivanov");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "confirm?",
		});

		await user.sendMessage("no");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "Last name:",
		});
	});

	it("legacy step('message', …) between builder steps is not skipped either", async () => {
		const seen: string[] = [];

		const scene = new Scene("legacy-middle")
			.step("intro", (c) =>
				c
					.enter((ctx) => ctx.send("press go"))
					.on("message", (ctx) => ctx.scene.step.next()),
			)
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("legacy prompt");
				seen.push(`legacy:${ctx.text}`);
				return ctx.scene.step.next();
			})
			.step("done", (c) => c.enter((ctx) => ctx.send("thanks")));

		const env = makeEnv([scene], scene);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("go");
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "legacy prompt",
		});

		await user.sendMessage("hi");
		expect(seen).toEqual(["legacy:hi"]);
		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "thanks",
		});
	});

	it("~scene.steps keeps every step in registration order", () => {
		const scene = new Scene("registry")
			.step("intro", (c) => c.message("a"))
			.ask("lastName", strMin(2), "Last name:")
			.step((c) => c.message("b"))
			.step("message", () => {})
			.step("outro", (c) => c.message("c"));

		// Named builder steps keep their name; numeric ids autoincrement and are
		// shared between builder and legacy (`.ask` / `.step(event, …)`) steps.
		expect(scene["~scene"].steps.map((s) => s.id)).toEqual([
			"intro",
			0,
			1,
			2,
			"outro",
		]);
		expect(scene["~scene"].steps.map((s) => s.legacy === true)).toEqual([
			false,
			true,
			false,
			true,
			false,
		]);
	});

	it("scene.step.go(id) reaches an ask registered after builder steps", async () => {
		const scene = new Scene("ask-go")
			.step("intro", (c) =>
				c
					.enter((ctx) => ctx.send("press go"))
					// the ask is the first *numbered* step — named builder steps
					// don't consume a number
					.on("message", (ctx) => ctx.scene.step.go(0)),
			)
			.ask("lastName", strMin(2), "Last name:");

		const env = makeEnv([scene], scene);
		const user = env.createUser();

		await user.sendCommand("start");
		await user.sendMessage("go");

		expect(env.lastApiCall("sendMessage")?.params).toMatchObject({
			text: "Last name:",
		});
	});
});

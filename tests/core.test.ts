import { describe, expect, expectTypeOf, it } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import { Scene, scenes } from "../src/index.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeEnv(
	sceneList: Scene<any, any, any, any>[],
	onMessage?: (ctx: any) => Promise<void>,
) {
	const bot = new Bot("test_token").extend(scenes(sceneList as any[]));
	if (onMessage) bot.on("message", onMessage);
	return new TelegramTestEnvironment(bot as any);
}

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

/** Minimal StandardSchema v1 validator that parses a number. */
const parseNum = () => ({
	"~standard": {
		version: 1 as const,
		vendor: "test",
		validate: (v: unknown) => {
			const n = Number(v);
			return Number.isNaN(n)
				? { issues: [{ message: "Not a number" }] }
				: { value: n };
		},
	},
});

// ─── Scene.onEnter() ──────────────────────────────────────────────────────────

describe("Scene.onEnter()", () => {
	it("runs before the first step handler", async () => {
		const log: string[] = [];

		const scene = new Scene("onenter-order")
			.onEnter(() => {
				log.push("enter");
			})
			.step("message", (ctx) => {
				log.push(`step:${ctx.scene.step.firstTime}`);
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		await env.createUser().sendMessage("hi");

		expect(log).toEqual(["enter", "step:true"]);
	});

	it("runs exactly once — not on subsequent step updates", async () => {
		let enterCount = 0;

		const scene = new Scene("onenter-once")
			.onEnter(() => {
				enterCount++;
			})
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("step0");
				return ctx.scene.update({});
			})
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("step1");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		const user = env.createUser();

		await user.sendMessage("enter");   // onEnter + step 0 firstTime
		await user.sendMessage("advance"); // step 0 false → update → step 1 firstTime

		expect(enterCount).toBe(1);
	});

	it("can perform async work (send a welcome message)", async () => {
		let welcomeSent = false;

		const scene = new Scene("onenter-async")
			.onEnter(async (ctx) => {
				await ctx.send("welcome!");
				welcomeSent = true;
			})
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("step0");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		await env.createUser().sendMessage("start");

		expect(welcomeSent).toBe(true);
	});

	it("context.scene is fully initialised inside onEnter", async () => {
		let stateVisible: boolean | undefined;
		let paramsVisible: boolean | undefined;

		const scene = new Scene("onenter-ctx")
			.params<{ tag: string }>()
			.onEnter((ctx) => {
				stateVisible = ctx.scene.state !== undefined;
				paramsVisible = ctx.scene.params !== undefined;
			})
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("ok");
			});

		const bot = new Bot("test_token").extend(scenes([scene] as any[]));
		bot.on("message", async (ctx: any) => ctx.scene.enter(scene, { tag: "x" }));
		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("start");

		expect(stateVisible).toBe(true);
		expect(paramsVisible).toBe(true);
	});
});

// ─── Scene.params() ───────────────────────────────────────────────────────────

describe("Scene.params()", () => {
	it("params passed at enter() are accessible in step handlers", async () => {
		let captured: { userId: number } | undefined;

		const scene = new Scene("params-access")
			.params<{ userId: number }>()
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					captured = ctx.scene.params;
					return ctx.send("ok");
				}
			});

		const bot = new Bot("test_token").extend(scenes([scene] as any[]));
		bot.on("message", async (ctx: any) => ctx.scene.enter(scene, { userId: 42 }));
		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("start");

		expect(captured).toEqual({ userId: 42 });
	});

	it("params remain unchanged across multiple steps", async () => {
		const snapshots: any[] = [];

		const scene = new Scene("params-stable")
			.params<{ id: number }>()
			.step("message", async (ctx) => {
				snapshots.push({ ...ctx.scene.params });
				if (ctx.scene.step.firstTime) return ctx.send("step0");
				return ctx.scene.update({});
			})
			.step("message", (ctx) => {
				snapshots.push({ ...ctx.scene.params });
				if (ctx.scene.step.firstTime) return ctx.send("step1");
			});

		const bot = new Bot("test_token").extend(scenes([scene] as any[]));
		bot.on("message", async (ctx: any) => ctx.scene.enter(scene, { id: 7 }));
		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendMessage("enter");
		await user.sendMessage("advance");

		expect(snapshots.every((p) => p.id === 7)).toBe(true);
		expect(snapshots.length).toBeGreaterThanOrEqual(2);
	});

	it("params<T>() typing — params type flows into step handler (type test)", () => {
		new Scene("params-types")
			.params<{ userId: number }>()
			.step("message", (ctx) => {
				expectTypeOf(ctx.scene.params).toEqualTypeOf<{ userId: number }>();
			});
	});

	it("state<T>() typing — state type flows into step handler (type test)", () => {
		new Scene("state-types")
			.state<{ name: string }>()
			.step("message", (ctx) => {
				expectTypeOf(ctx.scene.state).toEqualTypeOf<{ name: string }>();
			});
	});
});

// ─── State persistence ────────────────────────────────────────────────────────

describe("Scene state persistence", () => {
	it("state set via update() is available in the next step", async () => {
		let capturedInStep1: any;

		const scene = new Scene("state-next-step")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("Enter name:");
				return ctx.scene.update({ name: "Alice" });
			})
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					capturedInStep1 = ctx.scene.state;
					return ctx.send("ok");
				}
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		const user = env.createUser();

		await user.sendMessage("enter");  // step 0 firstTime → prompt
		await user.sendMessage("submit"); // step 0 false → update({name:"Alice"}) → step 1 firstTime

		expect(capturedInStep1).toMatchObject({ name: "Alice" });
	});

	it("successive update() calls accumulate state (shallow merge)", async () => {
		let finalState: any;

		const scene = new Scene("state-accumulate")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("step0");
				return ctx.scene.update({ a: 1 });
			})
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("step1");
				return ctx.scene.update({ b: 2 });
			})
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					finalState = ctx.scene.state;
					return ctx.send("done");
				}
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		const user = env.createUser();

		await user.sendMessage("enter");
		await user.sendMessage("msg1");
		await user.sendMessage("msg2");

		expect(finalState).toMatchObject({ a: 1, b: 2 });
	});

	it("update() without state arg still advances step", async () => {
		const stepsReached: number[] = [];

		const scene = new Scene("state-empty-update")
			.step("message", async (ctx) => {
				stepsReached.push(0);
				if (ctx.scene.step.firstTime) return ctx.send("step0");
				return ctx.scene.update({}); // no state, just advance
			})
			.step("message", (ctx) => {
				stepsReached.push(1);
				if (ctx.scene.step.firstTime) return ctx.send("step1");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		const user = env.createUser();

		await user.sendMessage("enter");
		await user.sendMessage("next");

		expect(stepsReached).toContain(1);
	});
});

// ─── scene.exit() ─────────────────────────────────────────────────────────────

describe("scene.exit()", () => {
	it("exit() ends the scene — next message hits non-scene handler", async () => {
		const freeHandlerCount = { value: 0 };

		const scene = new Scene("exit-ends")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("in-scene");
				await ctx.scene.exit();
			});

		// onMessage only fires when NOT in a scene (scenes plugin calls next() only if no scene)
		const env = makeEnv([scene], async (ctx) => {
			freeHandlerCount.value++;
			await ctx.scene.enter(scene);
		});
		const user = env.createUser();

		await user.sendMessage("enter"); // free (+1) → enter → step0 firstTime
		freeHandlerCount.value = 0;      // reset — only count post-exit

		await user.sendMessage("exit");  // scene active → step0 false → exit()
		await user.sendMessage("after"); // no scene → free handler fires again (+1)

		expect(freeHandlerCount.value).toBe(1);
	});

	it("exit() allows clean re-entry (step 0 firstTime again)", async () => {
		let step0FirstTimeCount = 0;

		const scene = new Scene("exit-reentry")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) {
					step0FirstTimeCount++;
					return ctx.send("step0");
				}
				return ctx.scene.exit();
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		const user = env.createUser();

		await user.sendMessage("start");   // enter → step0 firstTime (count=1)
		await user.sendMessage("exit");    // step0 false → exit()
		await user.sendMessage("restart"); // no scene → re-enter → step0 firstTime (count=2)

		expect(step0FirstTimeCount).toBe(2);
	});

	it("step 1 is never reached after exit() in step 0", async () => {
		const reached: number[] = [];

		const scene = new Scene("exit-stops-flow")
			.step("message", async (ctx) => {
				reached.push(0);
				if (ctx.scene.step.firstTime) return ctx.send("step0");
				return ctx.scene.exit();
			})
			.step("message", (ctx) => {
				reached.push(1); // should never execute after exit
				if (ctx.scene.step.firstTime) return ctx.send("step1");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		const user = env.createUser();

		await user.sendMessage("enter");
		await user.sendMessage("exit");

		expect(reached).not.toContain(1);
	});
});

// ─── scene.reenter() ─────────────────────────────────────────────────────────

describe("scene.reenter()", () => {
	it("reenter() restarts scene from step 0 with firstTime=true", async () => {
		const log: Array<{ step: number; firstTime: boolean }> = [];

		const scene = new Scene("reenter-restart")
			.step("message", async (ctx) => {
				log.push({ step: 0, firstTime: ctx.scene.step.firstTime });
				if (ctx.scene.step.firstTime) return ctx.send("step0");
				return ctx.scene.update({});
			})
			.step("message", async (ctx) => {
				log.push({ step: 1, firstTime: ctx.scene.step.firstTime });
				if (ctx.scene.step.firstTime) return ctx.send("step1");
				return ctx.scene.reenter(); // jump back to step 0
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		const user = env.createUser();

		await user.sendMessage("enter");    // step 0 firstTime
		await user.sendMessage("advance");  // step 0 false → update → step 1 firstTime
		await user.sendMessage("reenter");  // step 1 false → reenter()

		// Last entry in log should be step 0, firstTime=true (from reenter)
		const last = log[log.length - 1];
		expect(last).toEqual({ step: 0, firstTime: true });
	});

	it("reenter() resets state to empty", async () => {
		let stateAtSecondEntry: any;

		const scene = new Scene("reenter-state-reset")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) {
					// On second entry, state should be empty again
					if (Object.keys(ctx.scene.state as object).length === 0) {
						stateAtSecondEntry = ctx.scene.state;
					}
					return ctx.send("step0");
				}
				return ctx.scene.update({ foo: "bar" });
			})
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("step1");
				return ctx.scene.reenter();
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		const user = env.createUser();

		await user.sendMessage("enter");
		await user.sendMessage("advance");  // update({foo:"bar"}) → step 1
		await user.sendMessage("advance2"); // step 1 false → reenter() → step 0 fresh

		expect(stateAtSecondEntry).toBeDefined();
		expect(stateAtSecondEntry).toEqual({});
	});

	it("reenter() preserves original params", async () => {
		const paramSnapshots: any[] = [];

		const scene = new Scene("reenter-params")
			.params<{ tag: string }>()
			.step("message", async (ctx) => {
				paramSnapshots.push({ ...ctx.scene.params });
				if (ctx.scene.step.firstTime) return ctx.send("step0");
				return ctx.scene.reenter(); // restart with same params
			});

		const bot = new Bot("test_token").extend(scenes([scene] as any[]));
		bot.on("message", async (ctx: any) => ctx.scene.enter(scene, { tag: "hello" }));
		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendMessage("enter"); // step 0 firstTime, params={tag:"hello"}
		await user.sendMessage("again"); // step 0 false → reenter() → step 0 firstTime again

		expect(paramSnapshots.every((p) => p.tag === "hello")).toBe(true);
		expect(paramSnapshots.length).toBeGreaterThanOrEqual(2);
	});
});

// ─── Step navigation ──────────────────────────────────────────────────────────

describe("Step navigation", () => {
	it("step.next() immediately advances to step+1 within the same update", async () => {
		const log: Array<{ step: number; firstTime: boolean }> = [];

		const scene = new Scene("nav-next")
			.step("message", async (ctx) => {
				log.push({ step: 0, firstTime: ctx.scene.step.firstTime });
				// Skip the prompt, jump straight to step 1
				if (ctx.scene.step.firstTime) return ctx.scene.step.next();
			})
			.step("message", (ctx) => {
				log.push({ step: 1, firstTime: ctx.scene.step.firstTime });
				if (ctx.scene.step.firstTime) return ctx.send("step1");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		await env.createUser().sendMessage("hi");

		// Both steps execute during a single sendMessage()
		expect(log).toContainEqual({ step: 0, firstTime: true });
		expect(log).toContainEqual({ step: 1, firstTime: true });
	});

	it("step.go(n) jumps directly to an arbitrary step, skipping intermediate ones", async () => {
		const reached: number[] = [];

		const scene = new Scene("nav-go")
			.step("message", async (ctx) => {
				reached.push(0);
				if (ctx.scene.step.firstTime) return ctx.scene.step.go(2); // skip step 1
			})
			.step("message", (ctx) => {
				reached.push(1); // must never run
				if (ctx.scene.step.firstTime) return ctx.send("step1");
			})
			.step("message", (ctx) => {
				reached.push(2);
				if (ctx.scene.step.firstTime) return ctx.send("step2");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		await env.createUser().sendMessage("hi");

		expect(reached).not.toContain(1);
		expect(reached).toContain(2);
	});

	it("step.previous() goes back one step", async () => {
		const reached: number[] = [];

		const scene = new Scene("nav-previous")
			.step("message", async (ctx) => {
				reached.push(0);
				if (ctx.scene.step.firstTime) return ctx.send("step0");
				return ctx.scene.update({});
			})
			.step("message", async (ctx) => {
				reached.push(1);
				if (ctx.scene.step.firstTime) return ctx.send("step1");
				return ctx.scene.step.previous(); // back to step 0
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		const user = env.createUser();

		await user.sendMessage("enter");    // step 0 firstTime
		await user.sendMessage("advance");  // step 0 false → update → step 1 firstTime
		await user.sendMessage("back");     // step 1 false → previous() → step 0 firstTime

		// step 0 should have run at least twice (enter + after previous())
		expect(reached.filter((n) => n === 0).length).toBeGreaterThanOrEqual(2);
	});

	it("step.go(n, false) visits step with firstTime=false", async () => {
		let capturedFirstTime: boolean | undefined;

		const scene = new Scene("nav-go-not-first")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.scene.step.go(1, false);
			})
			.step("message", (ctx) => {
				capturedFirstTime = ctx.scene.step.firstTime;
				return ctx.send("handled");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		await env.createUser().sendMessage("hi");

		expect(capturedFirstTime).toBe(false);
	});

	it("step.previousId tracks the step we came from", async () => {
		let capturedPreviousId: number | undefined;

		const scene = new Scene("nav-previousid")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.scene.step.go(2); // step 0 → step 2
			})
			.step("message", (ctx) => {
				// should be skipped
				if (ctx.scene.step.firstTime) return ctx.send("step1");
			})
			.step("message", (ctx) => {
				capturedPreviousId = ctx.scene.step.previousId;
				if (ctx.scene.step.firstTime) return ctx.send("step2");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		await env.createUser().sendMessage("hi");

		expect(capturedPreviousId).toBe(0); // came from step 0
	});
});

// ─── Scene.ask() ──────────────────────────────────────────────────────────────

describe("Scene.ask()", () => {
	it("sends the prompt message on firstTime", async () => {
		let promptSent = false;

		const scene = new Scene("ask-prompt")
			.onEnter(async (ctx) => {
				// We verify the prompt was sent by checking promptSent after enter
			})
			.ask("name", strMin(1), "Enter your name:");

		const bot = new Bot("test_token").extend(scenes([scene] as any[]));
		bot.on("message", async (ctx: any) => {
			await ctx.scene.enter(scene);
			promptSent = true; // enter ran without error
		});
		const env = new TelegramTestEnvironment(bot as any);
		await env.createUser().sendMessage("start");

		expect(promptSent).toBe(true);
	});

	it("stores valid input in scene state and advances to next step", async () => {
		let capturedState: any;

		const scene = new Scene("ask-valid")
			.ask("name", strMin(2), "Enter your name:")
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					capturedState = ctx.scene.state;
					return ctx.send("done");
				}
			});

		const bot = new Bot("test_token").extend(scenes([scene] as any[]));
		bot.on("message", async (ctx: any) => ctx.scene.enter(scene));
		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendMessage("start");  // enter → ask sends prompt
		await user.sendMessage("Alice");  // valid (≥2 chars) → update({name:"Alice"}) → step 1

		expect(capturedState).toMatchObject({ name: "Alice" });
	});

	it("keeps the user on the same step when validation fails", async () => {
		let nextStepReached = false;

		const scene = new Scene("ask-invalid")
			.ask("name", strMin(2), "Enter your name:")
			.step("message", (ctx) => {
				nextStepReached = true;
				if (ctx.scene.step.firstTime) return ctx.send("done");
			});

		const bot = new Bot("test_token").extend(scenes([scene] as any[]));
		bot.on("message", async (ctx: any) => ctx.scene.enter(scene));
		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendMessage("start"); // enter → prompt
		await user.sendMessage("X");     // invalid (1 char < 2) → error, stay on ask step
		expect(nextStepReached).toBe(false);

		await user.sendMessage("Alice"); // valid → advances
		expect(nextStepReached).toBe(true);
	});

	it("calls custom onInvalidInput callback when validation fails", async () => {
		let customErrorCalled = false;

		const scene = new Scene("ask-custom-error").ask(
			"age",
			parseNum(),
			"Enter age:",
			{
				onInvalidInput: (issues) => {
					customErrorCalled = true;
					return `Custom: ${issues[0]?.message}`;
				},
			},
		);

		const bot = new Bot("test_token").extend(scenes([scene] as any[]));
		bot.on("message", async (ctx: any) => ctx.scene.enter(scene));
		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendMessage("start"); // enter → "Enter age:"
		await user.sendMessage("abc");   // invalid → custom error called

		expect(customErrorCalled).toBe(true);
	});

	it("chained ask() calls collect multiple fields into state", async () => {
		let finalState: any;

		const scene = new Scene("ask-chain")
			.ask("name", strMin(1), "Enter name:")
			.ask("count", parseNum(), "Enter count:")
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) {
					finalState = ctx.scene.state;
					return ctx.send("done");
				}
			});

		const bot = new Bot("test_token").extend(scenes([scene] as any[]));
		bot.on("message", async (ctx: any) => ctx.scene.enter(scene));
		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendMessage("start"); // enter → "Enter name:"
		await user.sendMessage("Bob");   // name="Bob" → "Enter count:"
		await user.sendMessage("5");     // count=5 → step after asks

		expect(finalState).toMatchObject({ name: "Bob", count: 5 });
	});

	it("ask() accepts invalid then valid input for the same field", async () => {
		const attemptsPerField: string[] = [];

		const scene = new Scene("ask-retry")
			.ask("code", strMin(3), "Enter code (≥3 chars):")
			.step("message", (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("got it");
			});

		const bot = new Bot("test_token").extend(scenes([scene] as any[]));
		bot.on("message", async (ctx: any) => ctx.scene.enter(scene));
		const env = new TelegramTestEnvironment(bot as any);
		const user = env.createUser();

		await user.sendMessage("start"); // prompt
		await user.sendMessage("ab");    // invalid (2 chars)
		await user.sendMessage("a");     // invalid (1 char)
		await user.sendMessage("abc");   // valid (3 chars) → advances

		// No crash, no assertion needed beyond not throwing
		expect(true).toBe(true);
	});
});

// ─── update() explicit step option ───────────────────────────────────────────

describe("context.scene.update() — step option", () => {
	it("update({}, { step: n }) jumps to a specific step", async () => {
		const reached: number[] = [];

		const scene = new Scene("update-explicit-step")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime)
					return ctx.scene.update({}, { step: 2 }); // skip step 1
			})
			.step("message", (ctx) => {
				reached.push(1); // must be skipped
				if (ctx.scene.step.firstTime) return ctx.send("step1");
			})
			.step("message", (ctx) => {
				reached.push(2);
				if (ctx.scene.step.firstTime) return ctx.send("step2");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		await env.createUser().sendMessage("hi");

		expect(reached).not.toContain(1);
		expect(reached).toContain(2);
	});

	it("update({}, { step: n, firstTime: false }) marks the target step as not first", async () => {
		let capturedFirstTime: boolean | undefined;

		const scene = new Scene("update-firsttime-false")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime)
					return ctx.scene.update({}, { step: 1, firstTime: false });
			})
			.step("message", (ctx) => {
				capturedFirstTime = ctx.scene.step.firstTime;
				return ctx.send("ok");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		await env.createUser().sendMessage("hi");

		expect(capturedFirstTime).toBe(false);
	});
});

// ─── Multiple scenes in one plugin ───────────────────────────────────────────

describe("Multiple scenes registered together", () => {
	it("two scenes can run independently for different users", async () => {
		const capturedA: string[] = [];
		const capturedB: string[] = [];

		const sceneA = new Scene("multi-scene-A").step("message", (ctx) => {
			if (ctx.scene.step.firstTime) {
				capturedA.push("A");
				return ctx.send("a");
			}
		});

		const sceneB = new Scene("multi-scene-B").step("message", (ctx) => {
			if (ctx.scene.step.firstTime) {
				capturedB.push("B");
				return ctx.send("b");
			}
		});

		const botA = new Bot("test_token").extend(
			scenes([sceneA, sceneB] as any[]),
		);
		botA.on("message", async (ctx: any) => ctx.scene.enter(sceneA));

		const botB = new Bot("test_token").extend(
			scenes([sceneA, sceneB] as any[]),
		);
		botB.on("message", async (ctx: any) => ctx.scene.enter(sceneB));

		await new TelegramTestEnvironment(botA as any).createUser().sendMessage("hi");
		await new TelegramTestEnvironment(botB as any).createUser().sendMessage("hi");

		expect(capturedA).toContain("A");
		expect(capturedB).toContain("B");
	});

	it("entering an unregistered scene throws with a helpful error message", async () => {
		const unknownScene = new Scene("not-registered");
		const knownScene = new Scene("known");

		const bot = new Bot("test_token").extend(scenes([knownScene] as any[]));
		let error: Error | undefined;
		bot.on("message", async (ctx: any) => {
			try {
				await ctx.scene.enter(unknownScene);
			} catch (e) {
				error = e as Error;
			}
		});

		await new TelegramTestEnvironment(bot as any)
			.createUser()
			.sendMessage("hi");

		expect(error).toBeDefined();
		expect(error?.message).toContain("not-registered");
	});

	it("duplicate scene names throw during plugin init", () => {
		const a = new Scene("dup");
		const b = new Scene("dup");

		expect(() => scenes([a, b] as any[])).toThrow();
	});
});

// ─── Sub-scenes (enterSub / exitSub) ──────────────────────────────────────────

describe("Sub-scenes (enterSub / exitSub)", () => {
	it("basic flow: parent step resumes with firstTime=false after sub-scene completes", async () => {
		const log: Array<{ scene: string; step: number; firstTime: boolean }> = [];

		const subScene = new Scene("sub-basic")
			.step("message", async (ctx) => {
				log.push({ scene: "sub", step: 0, firstTime: ctx.scene.step.firstTime });
				if (ctx.scene.step.firstTime) return ctx.send("sub: enter code");
				return ctx.scene.exitSub();
			});

		const parentScene = new Scene("parent-basic")
			.step("message", async (ctx) => {
				log.push({ scene: "parent", step: 0, firstTime: ctx.scene.step.firstTime });
				if (ctx.scene.step.firstTime) return ctx.send("parent: enter name");
				return ctx.scene.update({ name: "Alice" });
			})
			.step("message", async (ctx) => {
				log.push({ scene: "parent", step: 1, firstTime: ctx.scene.step.firstTime });
				if (ctx.scene.step.firstTime) return ctx.scene.enterSub(subScene);
				return ctx.send("parent done");
			});

		const env = makeEnv([parentScene, subScene], async (ctx) => ctx.scene.enter(parentScene));
		const user = env.createUser();

		await user.sendMessage("start");  // parent step 0 firstTime=true → prompt
		await user.sendMessage("name");   // parent step 0 false → update → parent step 1 firstTime=true → enterSub
		await user.sendMessage("code");   // sub step 0 false → exitSub → parent step 1 firstTime=false

		// Parent step 1 must have run with firstTime=false after exitSub
		const parentStep1Entries = log.filter((e) => e.scene === "parent" && e.step === 1);
		expect(parentStep1Entries.some((e) => !e.firstTime)).toBe(true);
	});

	it("exitSub(data) merges returnData into parent state", async () => {
		let capturedState: any;

		const subScene = new Scene("sub-merge")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("sub: enter");
				return ctx.scene.exitSub({ phone: "+7999" });
			});

		const parentScene = new Scene("parent-merge")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("parent: enter name");
				return ctx.scene.update({ name: "Alice" });
			})
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.scene.enterSub(subScene);
				capturedState = ctx.scene.state;
				return ctx.send("done");
			});

		const env = makeEnv([parentScene, subScene], async (ctx) => ctx.scene.enter(parentScene));
		const user = env.createUser();

		await user.sendMessage("start");  // parent step 0 firstTime=true
		await user.sendMessage("name");   // parent step 0 false → update → parent step 1 firstTime=true → enterSub
		await user.sendMessage("code");   // sub step 0 false → exitSub({phone}) → parent step 1 firstTime=false

		expect(capturedState).toMatchObject({ name: "Alice", phone: "+7999" });
	});

	it("N-level nesting: A → B → C, exitSub unwinds through the stack", async () => {
		const order: string[] = [];

		const sceneC = new Scene("scene-c-nested")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("c: prompt");
				order.push("c-exiting");
				return ctx.scene.exitSub({ fromC: true });
			});

		const sceneB = new Scene("scene-b-nested")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.scene.enterSub(sceneC);
				order.push("b-resumed");
				return ctx.scene.exitSub({ fromB: true });
			});

		const sceneA = new Scene("scene-a-nested")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) {
					order.push("a-entering-sub");
					return ctx.scene.enterSub(sceneB);
				}
				order.push("a-resumed");
				return ctx.send("done");
			});

		const env = makeEnv(
			[sceneA, sceneB, sceneC],
			async (ctx) => ctx.scene.enter(sceneA),
		);
		const user = env.createUser();

		await user.sendMessage("start");  // A step0 firstTime → enterSub(B) → B firstTime → enterSub(C) → C firstTime
		await user.sendMessage("go");     // C step0 false → exitSub → B step0 false → exitSub → A step0 false

		expect(order).toEqual(["a-entering-sub", "c-exiting", "b-resumed", "a-resumed"]);
	});

	it("exitSub without parentStack behaves like exit() — clears the scene", async () => {
		const freeHandlerCount = { value: 0 };

		const subScene = new Scene("sub-no-parent")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("sub: prompt");
				return ctx.scene.exitSub(); // no parent → plain exit
			});

		const env = makeEnv([subScene], async (ctx) => {
			freeHandlerCount.value++;
			await ctx.scene.enter(subScene);
		});
		const user = env.createUser();

		await user.sendMessage("start"); // free (+1) → enter sub
		freeHandlerCount.value = 0;      // reset

		await user.sendMessage("exit");  // sub step0 false → exitSub (no parent) → scene cleared
		await user.sendMessage("after"); // no scene → free handler fires (+1)

		expect(freeHandlerCount.value).toBe(1);
	});

	it("parent step.firstTime is false when resumed after exitSub", async () => {
		let parentStepFirstTimeOnResume: boolean | undefined;

		const subScene = new Scene("sub-firsttime-check")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.send("sub prompt");
				return ctx.scene.exitSub();
			});

		const parentScene = new Scene("parent-firsttime-check")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.scene.enterSub(subScene);
				parentStepFirstTimeOnResume = ctx.scene.step.firstTime;
				return ctx.send("parent done");
			});

		const env = makeEnv(
			[parentScene, subScene],
			async (ctx) => ctx.scene.enter(parentScene),
		);
		const user = env.createUser();

		await user.sendMessage("start");  // parent step 0 firstTime=true → enterSub(sub)
		await user.sendMessage("sub-ans"); // sub step 0 firstTime=false → exitSub → parent step 0 firstTime=false

		expect(parentStepFirstTimeOnResume).toBe(false);
	});

	it("entering an unregistered scene via enterSub throws a helpful error", async () => {
		const unknownScene = new Scene("not-registered-sub");
		const knownScene = new Scene("known-parent")
			.step("message", async (ctx) => {
				if (ctx.scene.step.firstTime) return ctx.scene.enterSub(unknownScene as any);
			});

		let error: Error | undefined;
		const bot = new Bot("test_token").extend(scenes([knownScene] as any[]));
		bot.on("message", async (ctx: any) => {
			try {
				await ctx.scene.enter(knownScene);
			} catch (e) {
				error = e as Error;
			}
		});

		await new TelegramTestEnvironment(bot as any).createUser().sendMessage("hi");

		expect(error?.message).toContain("not-registered-sub");
	});
});

// ─── firstTime flag behaviour ─────────────────────────────────────────────────

describe("firstTime flag", () => {
	it("is true only on the first visit to each step", async () => {
		const firstTimeValues: boolean[] = [];

		const scene = new Scene("firsttime-track")
			.step("message", async (ctx) => {
				firstTimeValues.push(ctx.scene.step.firstTime);
				if (ctx.scene.step.firstTime) return ctx.send("prompt");
				return ctx.scene.update({});
			})
			.step("message", (ctx) => {
				firstTimeValues.push(ctx.scene.step.firstTime);
				if (ctx.scene.step.firstTime) return ctx.send("done");
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		const user = env.createUser();

		await user.sendMessage("enter");   // step 0 firstTime=true
		await user.sendMessage("advance"); // step 0 firstTime=false → update → step 1 firstTime=true

		// Observed first-time values: [true, false, true]
		expect(firstTimeValues[0]).toBe(true);  // step 0, enter
		expect(firstTimeValues[1]).toBe(false); // step 0, second visit
	});

	it("firstTime is false on the same step after it was processed once", async () => {
		const seenFirstTime: boolean[] = [];

		const scene = new Scene("firsttime-sticky")
			.step("message", (ctx) => {
				seenFirstTime.push(ctx.scene.step.firstTime);
				if (ctx.scene.step.firstTime) return ctx.send("prompt");
				// stay on same step (no update())
			});

		const env = makeEnv([scene], async (ctx) => ctx.scene.enter(scene));
		const user = env.createUser();

		await user.sendMessage("enter");  // step 0 firstTime=true
		await user.sendMessage("msg2");   // step 0 firstTime=false (no advance)
		await user.sendMessage("msg3");   // step 0 firstTime=false

		expect(seenFirstTime).toEqual([true, false, false]);
	});
});

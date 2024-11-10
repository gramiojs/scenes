import { describe, expect, it } from "bun:test";
import { Scene } from "../src";

it("", () => {
	const scene = new Scene("")
		.params<{ some: 1 }>()
		.state<{ some: 1 }>()
		.step("message", async (context) => {
			if (context.scene.step.firstTime) return context.send("ok");
			context.scene.state;
			return context.scene.update({
				somes: 2,
			});
		})
		.step("message", (context) => {
			if (context.scene.step.firstTime) return context.send("ok");
			context.scene.state;
			return context.scene.update({
				somesssssssssss: 22,
			});
		})
		.step("message", (context) => {
			if (context.scene.step.firstTime) return context.send("ok");
			context.scene.state;
			return context.scene.update({
				somesss2: 22,
			});
		})
		.step("message", (context) => {
			if (context.scene.step.firstTime) return context.send("ok");
		});
});

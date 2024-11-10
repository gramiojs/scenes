import { Scene } from "./src";

const testScene = new Scene("test")
	.step("message", async (context) => {
		if (context.scene.step.firstTime || context.text !== "1") {
			await context.send("1");
			return;
		}

		// u can fine type issues with this when returns non update session data but just ignore it for now
		return context.scene.update({
			messageId: context.id,
			some: "hii!" as const,
		});
	})
	.step("message", async (context) => {
		if (context.scene.step.firstTime || context.text !== "2") {
			await context.send("2");
			return 228;
		}

		console.log(context.scene.state.messageId);
		//                           ^?
	});

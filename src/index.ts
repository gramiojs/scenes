import { type Storage, inMemoryStorage } from "@gramio/storage";
import { Plugin } from "gramio";
import type { AnyScene } from "scene";
import { getInActiveSceneHandler, getSceneHandlers } from "utils";

export interface ScenesOptions {
	storage?: Storage;
}

export interface ScenesStorageData {
	name: string;
	params: unknown;
}

export function scenes(scenes: AnyScene[], options?: ScenesOptions) {
	const storage = options?.storage ?? inMemoryStorage();

	return new Plugin("@gramio/scenes")
		.group((bot) =>
			bot.on(["message", "callback_query"], async (context, next) => {
				const key = `@gramio/scenes:${context.from?.id ?? 0}`;
				const sceneData = await storage.get<ScenesStorageData>(key);
				console.log("DATA", sceneData);
				if (!sceneData) return next();

				const scene = scenes.find((x) => x.name === sceneData.name);
				if (!scene) return next();

				// @ts-expect-error
				context.scene = getInActiveSceneHandler(context, storage, sceneData);
				// @ts-expect-error
				return scene.compose(context);
			}),
		)
		.derive(["message", "callback_query"], (context) => {
			return {
				scene: getSceneHandlers(context, storage),
			};
		});
}

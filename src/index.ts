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
	stepId: number;
	firstTime: boolean;
}

export function scenes(scenes: AnyScene[], options?: ScenesOptions) {
	const storage = options?.storage ?? inMemoryStorage();

	return new Plugin("@gramio/scenes")
		.on(["message", "callback_query"], async (context, next) => {
			const key = `@gramio/scenes:${context.from?.id ?? 0}`;
			const sceneData = await storage.get<ScenesStorageData>(key);

			if (!sceneData) return next();

			const scene = scenes.find((x) => x.name === sceneData.name);
			if (!scene) return next();

			// @ts-expect-error
			context.scene = getInActiveSceneHandler(
				context,
				storage,
				sceneData,
				scene,
			);
			// @ts-expect-error
			return scene.compose(context, async () => {
				const sceneData = await storage.get<ScenesStorageData>(key);
				storage.set(key, { ...sceneData, firstTime: false });
			});
		})
		.derive(["message", "callback_query"], (context) => {
			return {
				scene: getSceneHandlers(context, storage),
			};
		});
}

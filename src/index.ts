import { type Storage, inMemoryStorage } from "@gramio/storage";
import { Plugin } from "gramio";
import type { Scene } from "scene";

export interface ScenesOptions {
	storage?: Storage;
}

export function scenes(scenes: Scene[], options?: ScenesOptions) {
	const storage = options?.storage ?? inMemoryStorage();

	return new Plugin("@gramio/scenes")
		.group((bot) =>
			bot.on(["message", "callback_query"], async (context, next) => {
				const key = `@gramio/scenes:${context.from?.id ?? 0}`;
				const sceneName = await storage.get<string>(key);
				if (!sceneName) return next();

				const scene = scenes.find((x) => x.name === sceneName);
				if (!scene) return next();

				// some stuff

				return next();
			}),
		)
		.derive(["message", "callback_query"], (context) => {
			const key = `@gramio/scenes:${context.from?.id ?? 0}`;

			return {
				scene: {
					enter: (scene: Scene) => {
						storage.set(key, scene.name);
					},
					exit: () => {
						storage.delete(key);
					},
				},
			};
		});
}

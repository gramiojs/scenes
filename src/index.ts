import { inMemoryStorage } from "@gramio/storage";
import { Plugin } from "gramio";
import type { AnyScene } from "./scene.js";
import type {
	EnterExit,
	PossibleInUnknownScene,
	ScenesOptions,
	ScenesStorageData,
} from "./types.js";
import { getInActiveSceneHandler, getSceneHandlers } from "./utils.js";

export * from "./scene.js";
export * from "./types.js";

interface ScenesDerivesOptions<WithCurrentScene extends boolean = false>
	extends ScenesOptions {
	withCurrentScene?: WithCurrentScene;

	// TODO: improve typings. withCurrentScene & scenes should be declared at the same time
	scenes?: AnyScene[];
}

export function scenesDerives<WithCurrentScene extends boolean = false>(
	options?: ScenesDerivesOptions<WithCurrentScene>,
) {
	const storage = options?.storage ?? inMemoryStorage();

	return new Plugin("@gramio/scenes:derives").derive(
		// TODO: support more
		["message", "callback_query"],
		async (context) => {
			return {
				scene: (await getSceneHandlers(
					context,
					storage,
					options?.withCurrentScene ?? false,
					options?.scenes ?? [],
				)) as WithCurrentScene extends true
					? PossibleInUnknownScene<any, any>
					: EnterExit,
			};
		},
	);
}

export function scenes(scenes: AnyScene[], options?: ScenesOptions) {
	const storage = options?.storage ?? inMemoryStorage();

	// TODO: optimize storage usage
	return new Plugin("@gramio/scenes")
		.on(["message", "callback_query"], async (context, next) => {
			const key = `@gramio/scenes:${context.from?.id ?? 0}`;
			const sceneData =
				await storage.get<ScenesStorageData<unknown, unknown>>(key);

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
				const sceneData =
					await storage.get<ScenesStorageData<unknown, unknown>>(key);
				await storage.set(key, { ...sceneData, firstTime: false });
			});
		})
		.derive(["message", "callback_query"], (context) => {
			return {
				scene: getSceneHandlers(context, storage),
			};
		});
}

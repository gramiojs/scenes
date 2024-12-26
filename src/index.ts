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
	scenesOrOptions: AnyScene[] | ScenesDerivesOptions<WithCurrentScene>,
	optionsRaw?: ScenesDerivesOptions<WithCurrentScene>,
) {
	const options = Array.isArray(scenesOrOptions) ? optionsRaw : scenesOrOptions;

	const storage = options?.storage ?? inMemoryStorage();
	const scenes = Array.isArray(scenesOrOptions)
		? scenesOrOptions
		: options?.scenes;

	const withCurrentScene = options?.withCurrentScene ?? false;

	if (withCurrentScene && !scenes?.length)
		throw new Error("scenes is required when withCurrentScene is true");

	return new Plugin("@gramio/scenes:derives").derive(
		// TODO: support more
		["message", "callback_query"],
		async (context) => {
			if (withCurrentScene) {
				// TODO: move getSceneHandlers.withCurrentScene here and avoid useless async next
			}

			return {
				scene: (await getSceneHandlers(
					context,
					storage,
					withCurrentScene,
					scenes ?? [],
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
				// @ts-expect-error PRIVATE KEY USAGE
				"scene" in context && "~" in context.scene
					? // @ts-expect-error PRIVATE KEY USAGE
						context.scene["~"]?.data
					: await storage.get<ScenesStorageData<unknown, unknown>>(key);

			if (!sceneData) return next();

			const scene = scenes.find((x) => x.name === sceneData.name);
			if (!scene) return next();

			// @ts-expect-error
			context.scene = getInActiveSceneHandler(
				context,
				storage,
				sceneData,
				scene,
				key,
			);
			// @ts-expect-error
			return scene.run(context, storage, key, sceneData);
		})
		.derive(["message", "callback_query"], async (context) => {
			return {
				scene: await getSceneHandlers(context, storage, false, scenes),
			};
		});
}

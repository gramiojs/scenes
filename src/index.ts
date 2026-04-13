import { type Storage, inMemoryStorage } from "@gramio/storage";
import { Plugin } from "gramio";
import type { AnyScene } from "./scene.js";
import type {
	EnterExit,
	InActiveSceneHandlerReturn,
	PossibleInUnknownScene,
	ScenesOptions,
	ScenesStorageData,
} from "./types.js";
import {
	events,
	getInActiveSceneHandler,
	getSceneHandlers,
	validateScenes,
} from "./utils.js";

export * from "./scene.js";
export * from "./types.js";

interface ScenesDerivesOptions<WithCurrentScene extends boolean = false>
	extends ScenesOptions {
	withCurrentScene?: WithCurrentScene;

	// TODO: improve typings. withCurrentScene & scenes should be declared at the same time
	scenes?: AnyScene[];
	/**
	 * You should use the same storage for scenes and scenesDerives
	 */
	storage: Storage;
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

	if (scenes?.length) validateScenes(scenes);

	const allowedScenes = scenes?.map((x) => x.name) ?? [];

	// Encode scene names + options into the plugin name so that gramio's
	// name-based deduplication correctly identifies identical registrations
	// while allowing distinct scene sets to coexist.
	const sceneSeed = allowedScenes.slice().sort().join("|");
	const pluginName = [
		"@gramio/scenes:derives",
		withCurrentScene && "withCurrentScene",
		sceneSeed && `[${sceneSeed}]`,
	]
		.filter(Boolean)
		.join(":");

	return new Plugin(pluginName).derive(events, async (context) => {
		if (withCurrentScene) {
			// TODO: move getSceneHandlers.withCurrentScene here and avoid useless async next
		}

		return {
			scene: (await getSceneHandlers(
				//@ts-expect-error
				context as typeof context & {
					scene: InActiveSceneHandlerReturn<any, any>;
				},
				storage,
				withCurrentScene,
				scenes ?? [],
				allowedScenes,
			)) as WithCurrentScene extends true
				? PossibleInUnknownScene<any, any>
				: EnterExit,
		};
	});
}

export function scenes(scenes: AnyScene[], options?: ScenesOptions) {
	const storage = options?.storage ?? inMemoryStorage();
	const passthrough = options?.passthrough ?? true;
	validateScenes(scenes);

	const allowedScenes = scenes.map((x) => x.name);

	// Encode registered scene names into the plugin name so gramio's
	// name-based deduplication can distinguish between different scene sets.
	const pluginName = `@gramio/scenes[${allowedScenes.slice().sort().join("|")}]`;

	// TODO: optimize storage usage
	return new Plugin(pluginName)
		.on(events, async (context, next) => {
			const key = `@gramio/scenes:${context.from?.id ?? 0}` as const;
			const sceneData =
				"scene" in context &&
				typeof context.scene === "object" &&
				context.scene &&
				"~" in context.scene &&
				typeof context.scene["~"] === "object" &&
				context.scene["~"] &&
				"data" in context.scene["~"]
					? context.scene["~"].data as ScenesStorageData
					: await storage.get(key);

			// console.log("sceneData", sceneData);

			if (!sceneData) return next();

			const scene = scenes.find((x) => x.name === sceneData.name);
			if (!scene) return next();

			const ctx = context as typeof context & {
				scene: InActiveSceneHandlerReturn<any, any>;
			};

			ctx.scene = getInActiveSceneHandler(
				// @ts-expect-error
				ctx,
				storage,
				sceneData,
				scene,
				key,
				allowedScenes,
				scenes,
			);

			return scene.run(
				// @ts-ignore
				context,
				storage,
				key,
				sceneData,
				passthrough ? next : undefined,
			);
		})
		.derive(["message", "callback_query"], async (context) => {
			return {
				scene: await getSceneHandlers(
					context as typeof context & {
						scene: InActiveSceneHandlerReturn<any, any>;
					},
					storage,
					false,
					scenes,
					allowedScenes,
				),
			} as {
				// TODO: Make it cleaner
				scene: Omit<EnterExit, "exit">;
			};
		});
}

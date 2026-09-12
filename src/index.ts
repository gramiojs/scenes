import { type Storage, inMemoryStorage } from "@gramio/storage";
import { Plugin } from "gramio";
import type { AnyScene } from "./scene.js";
import type {
	EnterExit,
	InActiveSceneHandlerReturn,
	PossibleInUnknownScene,
	ScenesOptions,
	ScenesStorageData,
	ScenesStorageKeyResolver,
} from "./types.js";
import {
	events,
	getInActiveSceneHandler,
	getSceneHandlers,
	isInActiveSceneHandler,
	validateScenes,
} from "./utils.js";

export * from "./scene.js";
export * from "./types.js";

const defaultGetStorageKey: ScenesStorageKeyResolver = (context) =>
	`@gramio/scenes:${context.from?.id ?? 0}`;

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
	const getStorageKey = options?.getStorageKey ?? defaultGetStorageKey;
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
				context as typeof context & {
					scene: InActiveSceneHandlerReturn<any, any>;
				},
				storage,
				withCurrentScene,
				scenes ?? [],
				allowedScenes,
				getStorageKey,
			)) as WithCurrentScene extends true
				? PossibleInUnknownScene<any, any>
				: EnterExit,
		};
	});
}

export function scenes(scenes: AnyScene[], options?: ScenesOptions) {
	const storage = options?.storage ?? inMemoryStorage();
	const getStorageKey = options?.getStorageKey ?? defaultGetStorageKey;
	const passthrough = options?.passthrough ?? true;
	validateScenes(scenes);

	const allowedScenes = scenes.map((x) => x.name);

	// Encode registered scene names into the plugin name so gramio's
	// name-based deduplication can distinguish between different scene sets.
	const pluginName = `@gramio/scenes[${allowedScenes.slice().sort().join("|")}]`;

	// TODO: optimize storage usage
	return new Plugin(pluginName)
		.on(events, async (context, next) => {
			const key = getStorageKey(context);
			const sceneData =
				"scene" in context &&
				typeof context.scene === "object" &&
				context.scene &&
				"~" in context.scene &&
				typeof context.scene["~"] === "object" &&
				context.scene["~"] &&
				"data" in context.scene["~"]
					? (context.scene["~"].data as ScenesStorageData)
					: await storage.get(key);

			// console.log("sceneData", sceneData);

			if (!sceneData) return next();

			const scene = scenes.find((x) => x.name === sceneData.name);
			if (!scene) return next();

			const ctx = context as typeof context & {
				scene: InActiveSceneHandlerReturn<any, any>;
			};

			ctx.scene = getInActiveSceneHandler(
				ctx,
				storage,
				sceneData,
				scene,
				key,
				allowedScenes,
				scenes,
			);

			return scene.dispatchActive(
				context as any,
				storage,
				key,
				sceneData,
				passthrough ? next : undefined,
			);
		})
		.derive(["message", "callback_query"], async (context) => {
			// With `passthrough` an update can reach the outer bot chain while
			// the user is still inside a scene — the `.on` handler above has
			// already installed the full in-scene handler (state/params/step,
			// plus an `exit()` that fires the scene's onExit hook) on the
			// context. Re-deriving here would replace it with the bare
			// enter/exit pair, so keep whatever is already there.
			const active = (context as { scene?: unknown }).scene;
			if (isInActiveSceneHandler(active)) return { scene: active as EnterExit };

			return {
				scene: await getSceneHandlers(
					context as typeof context & {
						scene: InActiveSceneHandlerReturn<any, any>;
					},
					storage,
					false,
					scenes,
					allowedScenes,
					getStorageKey,
				),
			} as {
				// TODO: Make it cleaner
				// `exit` is part of the contract even outside a scene: with
				// `passthrough: true` a global handler (`bot.command("cancel")`)
				// can fire while a scene is active, and exiting from there is
				// the documented way to cancel it.
				scene: EnterExit;
			};
		});
}

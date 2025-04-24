import { type Storage, inMemoryStorage } from "@gramio/storage";
import { Plugin } from "gramio";
import type { AnyScene } from "./scene.js";
import type {
	EnterExit,
	PossibleInUnknownScene,
	ScenesOptions,
	ScenesStorageData,
} from "./types.js";
import {
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

	return new Plugin("@gramio/scenes:derives").derive(
		// TODO: move it to separate array. but for now it casted to just string[] or readonly array (derive won't work with readonly)
		[
			"message",
			"callback_query",
			"channel_post",
			"chat_join_request",
			"chosen_inline_result",
			"inline_query",
			"web_app_data",
			"successful_payment",
			"video_chat_started",
			"video_chat_ended",
			"video_chat_scheduled",
			"video_chat_participants_invited",
			"passport_data",
			"new_chat_title",
			"new_chat_photo",
			"pinned_message",
			// "poll_answer",
			"pre_checkout_query",
			"proximity_alert_triggered",
			"shipping_query",
			"group_chat_created",
			"delete_chat_photo",
			"location",
			"invoice",
			"message_auto_delete_timer_changed",
			"migrate_from_chat_id",
			"migrate_to_chat_id",
			"new_chat_members",
			"chat_shared",
		],
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
	validateScenes(scenes);

	// TODO: optimize storage usage
	return new Plugin("@gramio/scenes")
		.on(
			[
				"message",
				"callback_query",
				"channel_post",
				"chat_join_request",
				"chosen_inline_result",
				"inline_query",
				"web_app_data",
				"successful_payment",
				"video_chat_started",
				"video_chat_ended",
				"video_chat_scheduled",
				"video_chat_participants_invited",
				"passport_data",
				"new_chat_title",
				"new_chat_photo",
				"pinned_message",
				// "poll_answer",
				"pre_checkout_query",
				"proximity_alert_triggered",
				"shipping_query",
				"group_chat_created",
				"delete_chat_photo",
				"location",
				"invoice",
				"message_auto_delete_timer_changed",
				"migrate_from_chat_id",
				"migrate_to_chat_id",
				"new_chat_members",
				"chat_shared",
			],
			async (context, next) => {
				const key = `@gramio/scenes:${context.from?.id ?? 0}`;
				const sceneData =
					// @ts-expect-error PRIVATE KEY USAGE
					"scene" in context && "~" in context.scene
						? // @ts-expect-error PRIVATE KEY USAGE
							context.scene["~"]?.data
						: await storage.get<ScenesStorageData<unknown, unknown>>(key);

				// console.log("sceneData", sceneData);

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
			},
		)
		.derive(["message", "callback_query"], async (context) => {
			return {
				scene: await getSceneHandlers(context, storage, false, scenes),
			} as {
				// TODO: Make it cleaner
				scene: Omit<EnterExit, "exit">;
			};
		});
}
